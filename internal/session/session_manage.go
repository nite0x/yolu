package session

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

func (a *Service) ManageSessionHandler(w http.ResponseWriter, r *http.Request) {
	defer a.invalidateSessionCatalog()
	releaseControl := a.lockSessionControl(r.PathValue("session"))
	defer releaseControl()
	var input struct {
		Action    string `json:"action"`
		Name      string `json:"name"`
		RequestID string `json:"request_id"`
		TurnID    string `json:"turn_id"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	record, ok := a.requestSession(w, r)
	if !ok {
		return
	}
	switch input.Action {
	case "pin", "unpin":
		if err := a.Execution.Store.SetSessionPinned(record.ID, input.Action == "pin"); err != nil {
			httpx.DbError(w, err)
			return
		}
	case "rename", "archive", "restore", "fork":
		input.Name = strings.TrimSpace(input.Name)
		if input.Action == "rename" && (input.Name == "" || len([]rune(input.Name)) > 160) {
			httpx.WriteError(w, 400, "请输入 1–160 字的对话名称")
			return
		}
		if model.NormalizeProvider(record.Provider) != model.ProviderCodex {
			if input.Action == "fork" {
				httpx.WriteError(w, 400, "此对话暂不支持从历史分叉")
				return
			}
			if input.Action == "archive" && a.ChatBusy(record.ID) {
				httpx.WriteError(w, 409, "请等待本轮完成后再归档")
				return
			}
			if input.Action == "rename" {
				if err := a.Execution.Store.SetSessionTitle(record.ID, input.Name, "manual"); err != nil {
					httpx.DbError(w, err)
					return
				}
				if run := a.ChatFor(record.ID); run != nil {
					run.change(func(s *ChatState) { s.SessionName = input.Name })
				}
			}
			if input.Action == "archive" || input.Action == "restore" {
				if err := a.Execution.Store.OrganizeSession(record.ID, record.Pinned, input.Action == "archive"); err != nil {
					httpx.DbError(w, err)
					return
				}
			}
			break
		}
		if input.Action == "archive" || input.Action == "fork" {
			if a.ChatBusy(record.ID) {
				httpx.WriteError(w, 409, "请等待本轮完成后再归档或分叉")
				return
			}
			if err := a.AppTerminalConflict(record.ID, record.Cwd); err != nil {
				httpx.WriteError(w, 409, err.Error())
				return
			}
		}
		c, err := a.openSessions(r.Context())
		if err != nil {
			httpx.WriteError(w, 503, err.Error())
			return
		}
		defer c.Close()
		if input.Action == "archive" || input.Action == "fork" {
			s, err := readSession(c, record.ID)
			if err != nil {
				httpx.WriteError(w, 503, err.Error())
				return
			}
			if s.Status.Type == "active" {
				httpx.WriteError(w, 409, "对话正在其他 Codex 客户端运行，请等待完成")
				return
			}
		}
		params := map[string]any{"threadId": record.ID}
		method := map[string]string{"rename": "thread/name/set", "archive": "thread/archive", "restore": "thread/unarchive", "fork": "thread/fork"}[input.Action]
		if input.Action == "rename" {
			params["name"] = input.Name
		}
		if input.Action == "fork" {
			if input.RequestID == "" || len(input.RequestID) > 100 || len(input.TurnID) > 200 {
				httpx.WriteError(w, 400, "请提供分叉请求标识")
				return
			}
			key := "fork:" + record.ID + ":" + input.RequestID
			var existing, fingerprint string
			err := a.Execution.Store.DB.QueryRow(`SELECT session_id,fingerprint FROM conversation_create_requests WHERE request_id=?`, key).Scan(&existing, &fingerprint)
			if err == nil {
				if fingerprint != input.TurnID {
					httpx.WriteError(w, 409, "分叉请求已用于其他轮次")
					return
				}
				if existing == "" {
					httpx.WriteError(w, 409, "上次分叉结果未确认，请先刷新对话列表检查")
					return
				}
				a.WriteCreatedSession(w, existing, 200)
				return
			}
			if !errors.Is(err, sql.ErrNoRows) {
				httpx.DbError(w, err)
				return
			}
			if _, err := a.Execution.Store.DB.Exec(`INSERT INTO conversation_create_requests(request_id,fingerprint) VALUES(?,?)`, key, input.TurnID); err != nil {
				httpx.DbError(w, err)
				return
			}
			params["excludeTurns"] = true
			params["deferGoalContinuation"] = true
			if input.TurnID != "" {
				params["lastTurnId"] = input.TurnID
			}
			var result struct {
				Thread codex.Session `json:"thread"`
			}
			if err := c.Call(method, params, &result); err != nil || result.Thread.ID == "" {
				httpx.WriteError(w, 503, "分叉结果未确认，请先刷新对话列表检查")
				return
			}
			if result.Thread.ID != record.ID {
				releaseFork := a.lockControlKey("session:" + result.Thread.ID)
				defer releaseFork()
			}
			base := []rune(record.Name)
			if len(base) == 0 {
				base = []rune("对话")
			}
			result.Thread.Name = string(base[:min(155, len(base))]) + " · 分叉"
			if err := c.Call("thread/name/set", map[string]any{"threadId": result.Thread.ID, "name": result.Thread.Name}, &struct{}{}); err != nil {
				result.Thread.Name = ""
			}
			managed, err := a.Execution.Store.SessionBindingsManaged(record.ID)
			if err != nil {
				httpx.DbError(w, err)
				return
			}
			if managed {
				bindings, err := a.Execution.Store.SessionBindings(record.ID)
				if err != nil {
					httpx.DbError(w, err)
					return
				}
				for i := range bindings {
					bindings[i].ID = ""
					bindings[i].SessionID = result.Thread.ID
					bindings[i].CreatedAt, bindings[i].UpdatedAt = 0, 0
				}
				fork := result.Thread
				err = a.Execution.Store.SaveSessionWithBindings(model.Session{
					ID: fork.ID, Name: sessionName(fork), Cwd: fork.Cwd, CreatedAt: fork.CreatedAt, UpdatedAt: fork.UpdatedAt, Source: "workbench", Permission: record.Permission,
				}, bindings)
			} else if err = a.SaveSession(result.Thread, "workbench"); err == nil {
				err = a.Execution.Store.SaveSessionDirectories(result.Thread.ID, record.AdditionalDirectories)
			}
			if err != nil {
				httpx.DbError(w, err)
				return
			}
			if _, err := a.Execution.Store.DB.Exec(`UPDATE conversation_create_requests SET session_id=? WHERE request_id=?`, result.Thread.ID, key); err != nil {
				httpx.DbError(w, err)
				return
			}
			a.WriteCreatedSession(w, result.Thread.ID, 200)
			return
		}
		if err := c.Call(method, params, &struct{}{}); err != nil {
			httpx.WriteError(w, 503, err.Error())
			return
		}
		if input.Action == "rename" {
			if err := a.Execution.Store.SetSessionTitle(record.ID, input.Name, "manual"); err != nil {
				httpx.DbError(w, err)
				return
			}
			if run := a.ChatFor(record.ID); run != nil {
				run.change(func(s *ChatState) { s.SessionName = input.Name })
			}
		}
		if input.Action == "archive" || input.Action == "restore" {
			if err := a.Execution.Store.OrganizeSession(record.ID, record.Pinned, input.Action == "archive"); err != nil {
				httpx.DbError(w, err)
				return
			}
		}
	default:
		httpx.WriteError(w, 400, "不支持的对话操作")
		return
	}
	result, err := a.Execution.Store.Session(record.ID)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, map[string]any{"session": result})
}
