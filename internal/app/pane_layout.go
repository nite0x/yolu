package app

import (
	"bytes"
	"context"
	"encoding/json"
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

func (a *App) savedPaneLayout(ctx context.Context, ctxName string) string {
	resolved, ok := resolvePaneLayoutContext(ctxName)
	if !ok {
		return ""
	}
	value, err := a.Execution.Store.Setting(ctx, paneLayoutKeyPrefix+resolved)
	if err != nil || !json.Valid([]byte(value)) {
		return ""
	}
	return value
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
			Version int             `json:"version"`
			Context string          `json:"context"`
			Layout  json.RawMessage `json:"layout"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil || envelope.Version < 1 {
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
		if err := a.Execution.Store.SaveSetting(r.Context(), paneLayoutKeyPrefix+targetCtx, string(body)); err != nil {
			httpx.DbError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
