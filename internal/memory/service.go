// Package memory authorizes conversation memory and calls the bundled store.
package memory

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

const (
	GrantEnv   = "YOLU_MEMORY_GRANT"
	SearchTool = "memory_search"
	SaveTool   = "memory_save"
)

type SearchInput struct {
	Query string `json:"query" jsonschema:"Keywords for past decisions and facts in the current project."`
}

type SaveInput struct {
	Title   string `json:"title" jsonschema:"Short searchable title for the requested memory."`
	Content string `json:"content" jsonschema:"The concise project fact or decision the user asked to save."`
	Type    string `json:"type,omitempty" jsonschema:"Optional category: decision, architecture, bugfix, pattern, config, discovery, or learning."`
}

type Call struct {
	Search *SearchInput `json:"search,omitempty"`
	Save   *SaveInput   `json:"save,omitempty"`
}

type Match struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Type      string `json:"type"`
	Preview   string `json:"preview"`
	Truncated bool   `json:"truncated"`
}

type SearchResult struct {
	Matches []Match `json:"matches"`
}

type SaveResult struct {
	ID       int64 `json:"id"`
	Replayed bool  `json:"replayed"`
}

type Result struct {
	Search *SearchResult `json:"search,omitempty"`
	Save   *SaveResult   `json:"save,omitempty"`
}

type Problem struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (p *Problem) Error() string { return p.Message }

type Service struct {
	binary   string
	dataDir  string
	bindings func(string) ([]model.SessionProjectBinding, error)
	mu       sync.Mutex
	grants   map[string]*Grant
}

func BundledBinary(backend string) string {
	name := "engram-core"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(filepath.Dir(backend), name)
}

func New(binary, dataDir string, bindings func(string) ([]model.SessionProjectBinding, error)) *Service {
	return &Service{binary: binary, dataDir: dataDir, bindings: bindings, grants: make(map[string]*Grant)}
}

func (s *Service) Available() bool {
	info, err := os.Stat(s.binary)
	return err == nil && info.Mode().IsRegular()
}

type Grant struct {
	service   *Service
	token     string
	ctx       context.Context
	cancel    context.CancelFunc
	binding   model.SessionProjectBinding
	allowSave bool
	session   string // Set only after Yolu publishes the saved session and its bindings.
	operation string
}

func (s *Service) Issue(ctx context.Context, binding model.SessionProjectBinding, allowSave bool) *Grant {
	ctx, cancel := context.WithCancel(ctx)
	g := &Grant{service: s, token: model.NewID() + model.NewID(), ctx: ctx, cancel: cancel, binding: binding, allowSave: allowSave}
	s.mu.Lock()
	s.grants[g.token] = g
	s.mu.Unlock()
	return g
}

func (g *Grant) Token() string { return g.token }

func (g *Grant) Activate(session, operation string) {
	if g == nil {
		return
	}
	g.service.mu.Lock()
	defer g.service.mu.Unlock()
	if g.session == "" {
		g.session, g.operation = session, operation
	}
}

func (g *Grant) Close() {
	if g == nil {
		return
	}
	g.cancel()
	g.service.mu.Lock()
	delete(g.service.grants, g.token)
	g.service.mu.Unlock()
}

func (s *Service) Call(ctx context.Context, token string, call Call) (Result, *Problem) {
	s.mu.Lock()
	g := s.grants[token]
	var session, operation string
	if g != nil {
		session, operation = g.session, g.operation
	}
	s.mu.Unlock()
	if g == nil || session == "" || g.ctx.Err() != nil {
		return Result{}, &Problem{"forbidden", "This conversation's memory authorization is inactive"}
	}
	if (call.Search == nil) == (call.Save == nil) {
		return Result{}, &Problem{"invalid_request", "Provide one memory operation"}
	}
	bindings, err := s.bindings(session)
	if err != nil {
		return Result{}, &Problem{"memory_unavailable", "Could not check the conversation's project binding"}
	}
	var authorized bool
	for _, binding := range bindings {
		if binding.Role == model.SessionBindingPrimary && binding.ProjectID != "" && binding.ProjectID == g.binding.ProjectID && platform.SameWorkspacePath(binding.Directory, g.binding.Directory) {
			authorized = call.Save == nil && (binding.Access == model.SessionBindingRead || binding.Access == model.SessionBindingWrite) ||
				call.Save != nil && g.allowSave && operation != "" && binding.Access == model.SessionBindingWrite
			break
		}
	}
	if !authorized {
		return Result{}, &Problem{"forbidden", "Memory requires the current primary project and an explicit save request for writes"}
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	stop := context.AfterFunc(g.ctx, cancel)
	defer stop()
	if g.ctx.Err() != nil {
		return Result{}, &Problem{"forbidden", "This conversation's memory authorization is inactive"}
	}
	project := fmt.Sprintf("yolu-%x", sha256.Sum256([]byte(g.binding.ProjectID)))
	req := coreRequest{Version: 1, Project: project}
	var result Result
	var target any
	if call.Search != nil {
		req.Operation, req.Query, req.Limit = "search", strings.TrimSpace(call.Search.Query), 5
		if req.Query == "" || len(req.Query) > 2048 {
			return Result{}, &Problem{"invalid_request", "Provide a search query of at most 2048 bytes"}
		}
		result.Search = &SearchResult{}
		target = result.Search
	} else {
		req.Operation, req.SessionID, req.OperationID = "save", session, session+"\x00"+operation
		req.Title, req.Content = strings.TrimSpace(call.Save.Title), strings.TrimSpace(call.Save.Content)
		if req.Title == "" || len(req.Title) > 512 || req.Content == "" || len(req.Content) > 16000 {
			return Result{}, &Problem{"invalid_request", "Provide a short title and memory content"}
		}
		req.Type = strings.ToLower(strings.TrimSpace(call.Save.Type))
		switch req.Type {
		case "", "decision", "architecture", "bugfix", "pattern", "config", "discovery", "learning":
		default:
			return Result{}, &Problem{"invalid_request", "Choose a supported memory category"}
		}
		result.Save = &SaveResult{}
		target = result.Save
	}
	if problem := s.execute(ctx, req, target); problem != nil {
		return Result{}, problem
	}
	return result, nil
}

type coreRequest struct {
	Version     int    `json:"version"`
	Operation   string `json:"operation"`
	Project     string `json:"project"`
	Query       string `json:"query,omitempty"`
	Limit       int    `json:"limit,omitempty"`
	SessionID   string `json:"session_id,omitempty"`
	OperationID string `json:"operation_id,omitempty"`
	Title       string `json:"title,omitempty"`
	Content     string `json:"content,omitempty"`
	Type        string `json:"type,omitempty"`
}

func (s *Service) execute(ctx context.Context, req coreRequest, result any) *Problem {
	dataDir := filepath.Join(s.dataDir, "memory", req.Project)
	if ctx.Err() != nil || os.MkdirAll(dataDir, 0o700) != nil {
		return &Problem{"memory_unavailable", "The project memory store is unavailable"}
	}
	input, _ := json.Marshal(req)
	cmd := exec.CommandContext(ctx, s.binary, "--data-dir", dataDir)
	platform.HideCommand(cmd)
	cmd.Stdin = bytes.NewReader(input)
	output, err := cmd.Output()
	if err != nil {
		return &Problem{"memory_unavailable", "Engram Core could not complete the memory operation"}
	}
	var response struct {
		Version int             `json:"version"`
		Result  json.RawMessage `json:"result"`
		Error   *Problem        `json:"error"`
	}
	if json.Unmarshal(output, &response) != nil || response.Version != 1 {
		return &Problem{"memory_unavailable", "Engram Core returned an incompatible response"}
	}
	if response.Error != nil {
		return response.Error
	}
	if len(response.Result) == 0 || json.Unmarshal(response.Result, result) != nil {
		return &Problem{"memory_unavailable", "Engram Core returned an invalid result"}
	}
	return nil
}
