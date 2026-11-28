package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"

	"worktree-hub/internal/httpx"
)

const (
	paneLayoutKeyPrefix     = "pane_layout:v1:"
	defaultPaneLayoutCtx    = "default"
	maxPaneLayoutPayloadLen = 64 * 1024
)

var validPaneLayoutContext = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,64}$`)

func resolvePaneLayoutContext(ctxName string) (string, bool) {
	name := strings.TrimSpace(ctxName)
	if name == "" {
		return defaultPaneLayoutCtx, true
	}
	if !validPaneLayoutContext.MatchString(name) {
		return "", false
	}
	return name, true
}

// Keep the envelope aligned with its storage key while preserving metadata and
// fields written by newer clients. This also repairs historical blank contexts.
func normalizePaneLayoutRecord(raw []byte, ctxName string) (string, error) {
	var record map[string]json.RawMessage
	if err := json.Unmarshal(raw, &record); err != nil {
		return "", err
	}
	if record == nil {
		return "", errors.New("invalid pane layout record")
	}
	record["context"], _ = json.Marshal(ctxName)
	normalized, err := json.Marshal(record)
	return string(normalized), err
}

func (a *App) savedPaneLayout(ctx context.Context, ctxName string) string {
	resolved, ok := resolvePaneLayoutContext(ctxName)
	if !ok {
		return ""
	}
	value, err := a.Execution.Store.Setting(ctx, paneLayoutKeyPrefix+resolved)
	if err != nil {
		return ""
	}
	normalized, err := normalizePaneLayoutRecord([]byte(value), resolved)
	if err != nil {
		return ""
	}
	return normalized
}

func (a *App) paneLayoutHandler(w http.ResponseWriter, r *http.Request) {
	queryCtx := strings.TrimSpace(r.URL.Query().Get("context"))
	resolvedQueryCtx, ok := resolvePaneLayoutContext(queryCtx)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "布局上下文标识无效")
		return
	}

	switch r.Method {
	case http.MethodGet:
		raw := a.savedPaneLayout(r.Context(), resolvedQueryCtx)
		if raw == "" {
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"layout": nil})
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(raw))
	case http.MethodPut:
		body, err := io.ReadAll(io.LimitReader(r.Body, maxPaneLayoutPayloadLen+1))
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "无法读取布局数据")
			return
		}
		if len(body) == 0 || len(body) > maxPaneLayoutPayloadLen {
			httpx.WriteError(w, http.StatusBadRequest, "布局数据大小无效")
			return
		}
		var envelope struct {
			Version   int             `json:"version"`
			Context   string          `json:"context"`
			UpdatedAt float64         `json:"updatedAt"`
			Layout    json.RawMessage `json:"layout"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil || envelope.Version < 1 || envelope.UpdatedAt < 0 {
			httpx.WriteError(w, http.StatusBadRequest, "布局数据格式无效")
			return
		}
		trimmedLayout := bytes.TrimSpace(envelope.Layout)
		if len(trimmedLayout) == 0 || trimmedLayout[0] != '{' {
			httpx.WriteError(w, http.StatusBadRequest, "布局数据格式无效")
			return
		}
		resolvedBodyCtx, bodyCtxValid := resolvePaneLayoutContext(envelope.Context)
		if !bodyCtxValid {
			httpx.WriteError(w, http.StatusBadRequest, "布局上下文标识无效")
			return
		}
		if queryCtx != "" && strings.TrimSpace(envelope.Context) != "" && resolvedQueryCtx != resolvedBodyCtx {
			httpx.WriteError(w, http.StatusBadRequest, "布局上下文标识不匹配")
			return
		}
		targetCtx := resolvedBodyCtx
		if queryCtx != "" {
			targetCtx = resolvedQueryCtx
		}
		normalized, err := normalizePaneLayoutRecord(body, targetCtx)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "布局数据格式无效")
			return
		}
		err = a.Execution.Store.UpdateSetting(r.Context(), paneLayoutKeyPrefix+targetCtx, "", func(previous string) (string, error) {
			var saved struct {
				UpdatedAt float64 `json:"updatedAt"`
			}
			// Compare and replace in one transaction: an older normal request may
			// arrive after a newer pagehide keepalive request. Legacy records use 0.
			if json.Unmarshal([]byte(previous), &saved) == nil && saved.UpdatedAt > 0 && saved.UpdatedAt >= envelope.UpdatedAt {
				return previous, nil
			}
			return normalized, nil
		})
		if err != nil {
			httpx.DbError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
