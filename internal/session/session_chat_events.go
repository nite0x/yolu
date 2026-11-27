package session

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
)

func (a *Service) syncSessionName(run *ChatRun, event codex.Event) {
	var p struct {
		ThreadID string `json:"threadId"`
		Name     string `json:"threadName"`
	}
	if json.Unmarshal(event.Params, &p) != nil || p.ThreadID != run.session || strings.TrimSpace(p.Name) == "" {
		return
	}
	name := sessionName(codex.Session{Name: p.Name})
	releaseControl := a.lockSessionControl(run.session)
	defer releaseControl()
	if updated, err := a.Execution.Store.ObserveSessionTitle(run.session, name); err != nil || !updated {
		return
	}
	run.change(func(s *ChatState) { s.SessionName = name })
}

func (run *ChatRun) handle(event codex.Event) bool {
	var p struct {
		ThreadID  string           `json:"threadId"`
		TurnID    string           `json:"turnId"`
		ItemID    string           `json:"itemId"`
		Delta     string           `json:"delta"`
		Item      codexHistoryItem `json:"item"`
		RequestID json.RawMessage  `json:"requestId"`
		WillRetry *bool            `json:"willRetry"`
		Turn      struct {
			ID     string `json:"id"`
			Status string `json:"status"`
			Error  *struct {
				Message string `json:"message"`
			} `json:"error"`
		} `json:"turn"`
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(event.Params, &p); err != nil {
		return false
	}
	if p.ThreadID != run.session {
		return false
	}
	run.mu.Lock()
	turn, retrying := run.state.TurnID, run.state.Retrying
	run.mu.Unlock()
	if p.TurnID != "" && p.TurnID != turn {
		return false
	}
	if len(event.ID) > 0 {
		approval, err := makeChatApproval(event)
		if err != nil {
			// Never auto-approve an interaction we cannot render. Reject it and
			// interrupt only the turn started by this page.
			run.mu.Lock()
			c := run.connection
			run.mu.Unlock()
			_ = c.Reply(event.ID, map[string]any{"decision": "cancel"})
			_ = run.interrupt()
			run.change(func(s *ChatState) { s.Status = "failed"; s.Error = err.Error() })
			return true
		}
		run.change(func(s *ChatState) {
			for _, entry := range s.Entries {
				if entry.ID != p.ItemID || entry.TurnID != turn {
					continue
				}
				if event.Method == "item/fileChange/requestApproval" && entry.Kind == "change" {
					approval.Details += "\n" + entry.Text
				}
				if event.Method == "item/commandExecution/requestApproval" && entry.Kind == "command" {
					approval.Details = entry.Command + "\n" + entry.Cwd + "\n" + approval.Details
					break
				}
			}
			s.Approvals = append(s.Approvals, approval)
			if !run.stopRequested {
				s.Status = "waiting"
			}
		})
		return false
	}
	switch event.Method {
	case "item/started", "item/completed":
		if e, ok := visibleHistoryEntry(codexHistoryEntry{TurnID: p.TurnID, Item: p.Item}); ok {
			if e.Kind == "assistant" || e.Status == "" && e.Kind == "activity" {
				if event.Method == "item/started" {
					e.Status = "inProgress"
				} else {
					e.Status = "completed"
				}
			}
			run.change(func(s *ChatState) {
				if p.Item.Type == "agentMessage" || p.Item.Type == "plan" {
					s.Retrying = ""
				}
				upsertLiveEntry(s, e)
			})
		}
	case "item/agentMessage/delta":
		run.change(func(s *ChatState) {
			if p.Delta != "" {
				s.Retrying = ""
			}
			entry := liveEntry(s, p.ItemID, p.TurnID, "assistant")
			entry.Text = boundedChatText(entry.Text + p.Delta)
		})
	case "item/plan/delta":
		run.change(func(s *ChatState) {
			if p.Delta != "" {
				s.Retrying = ""
			}
			entry := liveEntry(s, p.ItemID, p.TurnID, "activity")
			entry.Tool = "计划"
			entry.Text = boundedChatText(entry.Text + p.Delta)
		})
	case "item/reasoning/summaryTextDelta", "item/reasoning/textDelta":
		// Model progress confirms recovery without exposing raw reasoning.
		if retrying != "" && p.Delta != "" {
			run.change(func(s *ChatState) { s.Retrying = "" })
		}
	case "item/commandExecution/outputDelta":
		run.change(func(s *ChatState) {
			entry := liveEntry(s, p.ItemID, p.TurnID, "command")
			out := ""
			if entry.Output != nil {
				out = *entry.Output
			}
			out = boundedChatText(out + p.Delta)
			entry.Output = &out
		})
	case "item/fileChange/outputDelta": // No terminal text from legacy file-change events.
	case "serverRequest/resolved":
		run.change(func(s *ChatState) {
			pending := []ChatApproval{}
			for _, a := range s.Approvals {
				if string(a.rpcID) != string(p.RequestID) {
					pending = append(pending, a)
				}
			}
			s.Approvals = pending
			if len(pending) == 0 && s.Status == "waiting" {
				s.Status = "running"
			}
		})
	case "turn/completed":
		if p.Turn.ID != turn {
			return false
		}
		run.change(func(s *ChatState) {
			s.Status = p.Turn.Status
			s.Busy = false
			s.Prediction = nil
			s.PredictionPending = p.Turn.Status == "completed"
			s.Approvals = []ChatApproval{}
			s.Retrying = ""
			if p.Turn.Error != nil && p.Turn.Error.Message != "" {
				s.Error = p.Turn.Error.Message
			} else if p.Turn.Status == "completed" {
				s.Error = ""
			} else if p.Turn.Status == "failed" && s.Error == "" {
				s.Error = "本轮未完成，请检查已保存的进展后重试。"
			}
		})
		return true
	case "error":
		if p.Error.Message != "" {
			run.change(func(s *ChatState) {
				s.Retrying = chatRetryNotice(p.Error.Message, p.WillRetry)
				if s.Retrying == "" {
					s.Error = p.Error.Message
				}
			})
		}
	}
	return false
}

var reconnectingMessage = regexp.MustCompile(`(?i)^reconnecting(?:\.{3}|…)?\s*(?:(\d+)\s*/\s*(\d+))?$`)

func chatRetryNotice(message string, willRetry *bool) string {
	match := reconnectingMessage.FindStringSubmatch(strings.TrimSpace(message))
	if willRetry != nil && !*willRetry || willRetry == nil && match == nil {
		return ""
	}
	if match != nil {
		if match[1] != "" {
			return "与模型服务的连接暂时中断，正在重连（" + match[1] + "/" + match[2] + "）…"
		}
		return "与模型服务的连接暂时中断，正在自动重连…"
	}
	return "正在自动重试：" + message
}

func boundedChatText(text string) string {
	const max = 256 * 1024
	if len(text) > max {
		return text[:max] + "\n[实时预览已达 256 KiB，完整内容请在已保存的历史中查看]"
	}
	return text
}
func liveEntry(s *ChatState, id, turn, kind string) *HistoryEntry {
	for i := range s.Entries {
		if s.Entries[i].ID == id && s.Entries[i].TurnID == turn {
			return &s.Entries[i]
		}
	}
	s.Entries = append(s.Entries, HistoryEntry{ID: id, TurnID: turn, Kind: kind, Status: "inProgress"})
	return &s.Entries[len(s.Entries)-1]
}
func upsertLiveEntry(s *ChatState, entry HistoryEntry) {
	if entry.Kind == "command" && entry.Output != nil {
		out := boundedChatText(*entry.Output)
		entry.Output = &out
	}
	entry.Text = boundedChatText(entry.Text)
	old := liveEntry(s, entry.ID, entry.TurnID, entry.Kind)
	// Completion payloads are authoritative; a missing output must not erase
	// output deltas that were already received from this running command.
	if entry.Output == nil && old.Output != nil {
		entry.Output = old.Output
	}
	*old = entry
}
func makeChatApproval(event codex.Event) (ChatApproval, error) {
	var p struct {
		Reason      string            `json:"reason"`
		Command     string            `json:"command"`
		Cwd         string            `json:"cwd"`
		GrantRoot   string            `json:"grantRoot"`
		Permissions json.RawMessage   `json:"permissions"`
		Network     json.RawMessage   `json:"networkApprovalContext"`
		Additional  json.RawMessage   `json:"additionalPermissions"`
		Decisions   []json.RawMessage `json:"availableDecisions"`
		Questions   []ChatQuestion    `json:"questions"`
	}
	if err := json.Unmarshal(event.Params, &p); err != nil {
		return ChatApproval{}, err
	}
	a := ChatApproval{ID: model.NewID(), rpcID: event.ID, method: event.Method, params: event.Params, CanAccept: true}
	switch event.Method {
	case "item/commandExecution/requestApproval":
		a.Kind, a.Title = "decision", "允许执行命令？"
		a.Details = strings.Join([]string{p.Command, p.Cwd, p.Reason}, "\n")
		if len(p.Network) > 0 && string(p.Network) != "null" {
			a.Details += "\n网络请求：" + string(p.Network)
		}
		if len(p.Additional) > 0 && string(p.Additional) != "null" {
			a.Details += "\n附加权限：" + string(p.Additional)
		}
		a.Choices = commandApprovalChoices(p.Decisions)
		a.CanAccept = false
		for _, choice := range a.Choices {
			a.CanAccept = a.CanAccept || choice.Accepts
		}
	case "item/fileChange/requestApproval":
		a.Kind, a.Title = "decision", "允许修改文件？"
		a.Details = p.Reason + "\n" + p.Cwd + "\n" + p.GrantRoot
		a.Choices = commandApprovalChoices([]json.RawMessage{json.RawMessage(`"accept"`), json.RawMessage(`"acceptForSession"`), json.RawMessage(`"decline"`), json.RawMessage(`"cancel"`)})
	case "item/permissions/requestApproval":
		a.Kind, a.Title = "permissions", "允许本轮使用这些权限？"
		a.Details = p.Reason + "\n" + p.Cwd + "\n" + string(p.Permissions)
		a.Choices = []ChatApprovalChoice{{ID: "decline", Label: "拒绝"}, {ID: "accept", Label: "允许本轮", Accepts: true}, {ID: "accept_session", Label: "本对话允许", Accepts: true}}
	case "item/tool/requestUserInput":
		a.Kind, a.Title, a.Questions = "questions", "Codex 需要你的回答", p.Questions
	case "mcpServer/elicitation/request":
		makeElicitation(&a)
	default:
		return a, fmt.Errorf("侧栏暂不支持此交互（%s），已请求停止本轮工作，请在终端继续", event.Method)
	}
	return a, nil
}
