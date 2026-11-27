package session

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

type ChatApproval struct {
	ID               string                 `json:"id"`
	Kind             string                 `json:"kind"`
	Title            string                 `json:"title"`
	Details          string                 `json:"details"`
	Questions        []ChatQuestion         `json:"questions,omitempty"`
	CanAccept        bool                   `json:"can_accept"`
	Choices          []ChatApprovalChoice   `json:"choices,omitempty"`
	Elicitation      *ChatElicitation       `json:"elicitation,omitempty"`
	ProjectAccess    *projectAccessApproval `json:"project_access,omitempty"`
	directoryBinding *model.SessionProjectBinding
	rpcID            json.RawMessage
	method           string
	params           json.RawMessage
}
type ChatQuestion struct {
	ID       string `json:"id"`
	Header   string `json:"header"`
	Question string `json:"question"`
	IsSecret bool   `json:"isSecret"`
	IsOther  bool   `json:"isOther"`
	Options  []struct {
		Label       string `json:"label"`
		Description string `json:"description"`
	} `json:"options"`
}
type ChatState struct {
	Prediction        *ChatPrediction `json:"prediction,omitempty"`
	PredictionPending bool            `json:"prediction_pending,omitempty"`
	SessionName       string          `json:"session_name,omitempty"`
	External          bool            `json:"external,omitempty"`
	Revision          uint64          `json:"revision"`
	ID                string          `json:"id,omitempty"`
	Status            string          `json:"status"`
	Busy              bool            `json:"busy"`
	TurnID            string          `json:"turn_id,omitempty"`
	Entries           []HistoryEntry  `json:"entries"`
	Approvals         []ChatApproval  `json:"approvals"`
	Error             string          `json:"error,omitempty"`
	Retrying          string          `json:"retrying,omitempty"`
	Blocked           string          `json:"blocked,omitempty"`
	CanHandoff        bool            `json:"can_handoff"`
	Notice            string          `json:"notice,omitempty"`
	AcceptedInputs    []string        `json:"accepted_inputs,omitempty"`
	Context           *ChatContext    `json:"context,omitempty"`
}
type approvalConnection interface {
	Reply(json.RawMessage, any) error
}

type ChatRun struct {
	mu                     sync.Mutex
	provider               string
	cloudInterrupt         func(context.Context, string) error
	state                  ChatState
	session, cwd           string
	connection             approvalConnection
	cancel                 context.CancelFunc
	changed                chan struct{} // broadcast closed on the next state mutation
	frameMu                sync.Mutex
	frame                  *chatFrame
	finished               chan struct{}
	stopRequested          bool
	turnSubmitting         bool
	handoff                bool
	settings               TurnSettings
	asyncRequest           string
	started                chan struct{}
	writeRoots             []string
	directoryRoots         []string
	baseline               map[string]fileSnapshot
	finalSnapshots         map[string]fileSnapshot
	configured             map[string]configuredDirectory
	directoryError         string
	managedBindings        bool
	permission             string
	pendingDirectoryGrants map[string]model.SessionProjectBinding
}

func (run *ChatRun) snapshot() ChatState {
	run.mu.Lock()
	defer run.mu.Unlock()
	return run.snapshotLocked()
}

func (run *ChatRun) snapshotLocked() ChatState {
	s := run.state
	s.Entries = append([]HistoryEntry{}, s.Entries...)
	s.Approvals = append([]ChatApproval{}, s.Approvals...)
	s.AcceptedInputs = append([]string{}, s.AcceptedInputs...)
	return s
}
func (run *ChatRun) change(fn func(*ChatState)) {
	run.mu.Lock()
	fn(&run.state)
	run.publishChangeLocked()
	run.mu.Unlock()
}

func (run *ChatRun) publishChangeLocked() {
	run.state.Revision++
	if run.changed != nil {
		close(run.changed)
		run.changed = nil
	}
}

func (a *Service) ChatStateHandler(w http.ResponseWriter, r *http.Request) {
	record, ok := a.requestSession(w, r)
	cwd := record.Cwd
	if !ok {
		return
	}
	state := ChatState{Status: "idle", Entries: []HistoryEntry{}, Approvals: []ChatApproval{}}
	if run := a.ChatFor(r.PathValue("session")); run != nil {
		state = run.snapshot()
	}
	if !state.Busy && model.NormalizeProvider(record.Provider) == model.ProviderCodex {
		// An unaccepted send has no turn ID. Its error must survive polling an
		// older completed rollout, so the composer can restore the failed draft.
		// A running/waiting native turn still owns its live controls.
		if external, ok := a.externalActivity(r.Context(), record.ID); ok && (state.ID == "" || external.Status == "running" || external.Status == "waiting" || external.TurnID != "" && external.TurnID != state.TurnID && (state.TurnID != "" || state.Error == "")) {
			state.Status = external.Status
			state.ID = ""
			state.Revision = 0
			state.Entries = []HistoryEntry{}
			state.Approvals = []ChatApproval{}
			state.Context = nil
			state.Error = ""
			state.AcceptedInputs = nil
			state.Prediction = nil
			state.PredictionPending = false
			state.External = true
			state.TurnID = external.TurnID
			state.Busy = external.Status == "running" || external.Status == "waiting"
			if state.Busy {
				state.Notice = "对话正在原生 Codex 中运行，进展会自动同步；请在原窗口处理停止或确认。"
			} else if external.Status == "unknown" {
				state.Notice = "暂时无法核实原生运行状态，请在 Codex 窗口确认。"
			}
		}
	}
	if !state.Busy && model.NormalizeProvider(record.Provider) == model.ProviderCodex {
		state.Blocked = ""
		state.CanHandoff = false
		if err := a.chatTerminalConflict(record.ID); err != nil {
			state.Blocked = err.Error()
			a.DecorateHandoff(&state, record.ID, cwd)
		}
	}
	a.prepareHistoryMedia(record.ID, state.Entries)
	if err := a.decorateAsyncQuestions(r.Context(), record.ID, state.Entries); err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, state)
}
func (a *Service) ChatStartHandler(w http.ResponseWriter, r *http.Request) {
	var input StartTurnInput
	if !httpx.DecodeLimit(w, r, &input, chatRequestLimit) {
		return
	}
	state, status, err := a.StartTurn(r.Context(), r.PathValue("session"), input)
	if err != nil {
		writeConversationError(w, err)
		return
	}
	if status == http.StatusOK {
		a.prepareHistoryMedia(r.PathValue("session"), state.Entries)
	}
	httpx.WriteJSON(w, status, state)
}

func (run *ChatRun) interrupt() error {
	timeout := 5 * time.Second
	if run.provider == model.ProviderCodexCloud {
		timeout = 12 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return run.interruptContext(ctx)
}

func (run *ChatRun) interruptContext(ctx context.Context) error {
	run.mu.Lock()
	provider := run.provider
	client, _ := run.connection.(codex.LiveClient)
	id := run.state.TurnID
	submitting := run.turnSubmitting
	cloudInterrupt := run.cloudInterrupt
	busy := run.state.Busy
	if run.handoff {
		run.mu.Unlock()
		run.cancel()
		return nil
	}
	run.mu.Unlock()
	if !busy {
		return nil
	}
	if model.IsACPProvider(provider) {
		return run.interruptACP()
	}
	if provider == model.ProviderCodexCloud {
		if id == "" {
			return fmt.Errorf("云端尚未确认本轮消息")
		}
		return cloudInterrupt(ctx, id)
	}
	if submitting && id == "" {
		return nil // The driver will interrupt once the provider identifies the turn.
	}
	if client == nil || id == "" {
		run.cancel()
		return nil
	}
	return client.Call(ctx, "turn/interrupt", map[string]any{"threadId": run.session, "turnId": id}, nil)
}
func (a *Service) currentRun(ctx context.Context, session, id string) (*ChatRun, error) {
	if _, err := a.resolveSession(ctx, session); err != nil {
		return nil, err
	}
	run := a.ChatFor(session)
	if run != nil {
		run.mu.Lock()
		matches := run.state.ID == id
		run.mu.Unlock()
		if matches {
			return run, nil
		}
	}
	return nil, conversationFailure(409, "stale_run", "页面运行已变化，请重新打开对话后重试")
}

func (a *Service) ChatStopHandler(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RunID string `json:"run_id"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	state, err := a.StopTurn(r.Context(), r.PathValue("session"), input.RunID)
	if err != nil {
		writeConversationError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, state)
}

// StopTurn transitions the identified run atomically. A queued Codex stop is
// delivered by its driver when turn/start returns an identity.
func (a *Service) StopTurn(ctx context.Context, session, id string) (ChatState, error) {
	run, err := a.currentRun(ctx, session, id)
	if err != nil {
		return ChatState{}, err
	}
	started, queued := run.beginStop()
	if started && !queued {
		if err := run.interrupt(); err != nil {
			run.restoreAfterStopFailure()
			if state := run.snapshot(); !state.Busy {
				return state, nil
			}
			return ChatState{}, conversationFailure(503, "stop_unconfirmed", "停止请求未确认："+err.Error())
		}
	}
	return run.snapshot(), nil
}
