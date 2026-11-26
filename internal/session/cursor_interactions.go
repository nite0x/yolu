package session

import (
	"encoding/json"
	"fmt"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/model"
)

type cursorQuestionRequest struct {
	Title     string `json:"title"`
	Questions []struct {
		ID      string `json:"id"`
		Prompt  string `json:"prompt"`
		Options []struct {
			ID    string `json:"id"`
			Label string `json:"label"`
		} `json:"options"`
		AllowMultiple bool `json:"allowMultiple"`
	} `json:"questions"`
}

func makeCursorApproval(msg acp.Message) (ChatApproval, error) {
	approval := ChatApproval{ID: model.NewID(), rpcID: msg.ID, method: msg.Method, params: msg.Params, CanAccept: true}
	switch msg.Method {
	case "cursor/ask_question":
		var request cursorQuestionRequest
		if err := json.Unmarshal(msg.Params, &request); err != nil {
			return approval, err
		}
		if len(request.Questions) == 0 {
			return approval, fmt.Errorf("Cursor 未提供问题")
		}
		properties := map[string]any{}
		required := []string{}
		for _, q := range request.Questions {
			if q.ID == "" || len(q.Options) == 0 || properties[q.ID] != nil {
				return approval, fmt.Errorf("Cursor 问题格式无效")
			}
			values, labels := []string{}, []string{}
			seen := map[string]bool{}
			for _, o := range q.Options {
				if o.ID == "" || seen[o.ID] {
					return approval, fmt.Errorf("Cursor 问题选项无效")
				}
				seen[o.ID] = true
				values = append(values, o.ID)
				labels = append(labels, o.Label)
			}
			field := map[string]any{"type": "string", "title": q.Prompt, "enum": values, "enumNames": labels}
			if q.AllowMultiple {
				field = map[string]any{"type": "array", "title": q.Prompt, "minItems": 1, "uniqueItems": true, "items": map[string]any{"type": "string", "anyOf": cursorEnumOptions(values, labels)}}
			}
			properties[q.ID] = field
			required = append(required, q.ID)
		}
		synthetic, _ := json.Marshal(map[string]any{"mode": "form", "serverName": "Cursor", "message": request.Title, "requestedSchema": map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}})
		approval.params = synthetic
		makeElicitation(&approval)
		approval.params = msg.Params
		approval.Title = "Cursor 需要你的回答"
	case "cursor/create_plan":
		var request struct {
			Name     string `json:"name"`
			Overview string `json:"overview"`
			Plan     string `json:"plan"`
		}
		if err := json.Unmarshal(msg.Params, &request); err != nil {
			return approval, err
		}
		approval.Kind, approval.Title = "decision", "确认 Cursor 计划"
		if request.Name != "" {
			approval.Title += " · " + request.Name
		}
		approval.Details = request.Overview + "\n\n" + request.Plan
		approval.Choices = []ChatApprovalChoice{{ID: "decline", Label: "拒绝"}, {ID: "cancel", Label: "取消本次交互"}, {ID: "accept", Label: "执行计划", Accepts: true}}
	default:
		return approval, fmt.Errorf("未知 Cursor 交互")
	}
	return approval, nil
}

func (a *Service) handleCursorMessage(run *ChatRun, client acp.Client, msg acp.Message) bool {
	if len(msg.ID) == 0 || (msg.Method != "cursor/ask_question" && msg.Method != "cursor/create_plan") {
		return false
	}
	approval, err := makeCursorApproval(msg)
	if err != nil {
		_ = client.Reply(msg.ID, map[string]any{"outcome": map[string]any{"outcome": "cancelled"}})
		return true
	}
	run.change(func(s *ChatState) { s.Approvals = append(s.Approvals, approval); s.Status = "waiting" })
	return true
}

func cursorApprovalReply(pending *ChatApproval, choice ChatApprovalChoice, content json.RawMessage) (any, error) {
	outcome := map[string]any{}
	if choice.ID == "cancel" {
		outcome["outcome"] = "cancelled"
	} else if pending.method == "cursor/create_plan" {
		if choice.Accepts {
			outcome["outcome"] = "accepted"
		} else {
			outcome["outcome"] = "rejected"
		}
	} else if !choice.Accepts {
		outcome["outcome"] = "skipped"
	} else {
		// Validate against the original server-provided enum schema before returning IDs.
		if _, err := elicitationReply(pending, choice, content); err != nil {
			return nil, err
		}
		var request cursorQuestionRequest
		if err := json.Unmarshal(pending.params, &request); err != nil {
			return nil, err
		}
		var values map[string]json.RawMessage
		if err := json.Unmarshal(content, &values); err != nil {
			return nil, err
		}
		answers := []map[string]any{}
		for _, q := range request.Questions {
			ids := []string{}
			if q.AllowMultiple {
				if err := json.Unmarshal(values[q.ID], &ids); err != nil {
					return nil, err
				}
			} else {
				var id string
				if err := json.Unmarshal(values[q.ID], &id); err != nil {
					return nil, err
				}
				ids = append(ids, id)
			}
			answers = append(answers, map[string]any{"questionId": q.ID, "selectedOptionIds": ids})
		}
		outcome["outcome"], outcome["answers"] = "answered", answers
	}
	return map[string]any{"outcome": outcome}, nil
}

func cursorEnumOptions(ids, labels []string) []map[string]string {
	options := []map[string]string{}
	for i, id := range ids {
		options = append(options, map[string]string{"const": id, "title": labels[i]})
	}
	return options
}
