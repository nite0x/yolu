// Package session indexes Codex threads and owns history, chat runs and terminal
// handoff and their working directory associations.
package session

import (
	"context"
	"strings"
	"sync"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/agy"
	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

type Service struct {
	chatRuntime
	controlCoordinator
	Execution             *execution.Service
	AssistantMCP          []string
	openSessions          func(context.Context) (codex.SessionClient, error)
	openCloudSessions     func(context.Context) (codex.SessionClient, error)
	sessionPool           *codex.SessionPool
	codexInstaller        codex.Installer
	openLive              func(context.Context) (codex.LiveClient, error)
	openTitleLive         func(context.Context) (codex.LiveClient, error)
	openAgy               func(context.Context, ...string) (acp.Client, acp.InitializeResult, error)
	diagnoseAgy           func(context.Context) agy.Diagnostics
	agyCatalogMu          sync.Mutex
	agyCatalog            *agy.OptionCatalog
	watchHistory          func(context.Context, string, func(HistoryPush) error) error
	terminalConflict      func(string, string) error
	openExternal          func(string) error
	bridgeMu              sync.Mutex
	catalogMu             sync.Mutex
	catalogs              map[string]*catalogEntry
	cloudCatalogCache     *cloudCatalogEntry
	rateLimitsMu          sync.Mutex
	rateLimits            *RateLimitsResponse
	bridges               map[string]*terminalBridge
	directoryStarts       sync.Mutex
	directoryReservations map[string]directoryReservation
	mediaOnce             sync.Once
	mediaKey              [32]byte
}

func New(environment *execution.Service) *Service {
	s := &Service{Execution: environment, openSessions: codex.OpenSessionClient, openLive: codex.OpenLive, openAgy: agy.OpenACP, watchHistory: WatchCodexHistory, terminalConflict: terminalSessionConflict, openExternal: platform.OpenExternal, chatRuntime: chatRuntime{chats: map[string]*ChatRun{}}, bridges: map[string]*terminalBridge{}}
	s.diagnoseAgy = func(ctx context.Context) agy.Diagnostics { return agy.Diagnose(ctx, s.openAgy) }
	if environment.Remote != nil {
		s.openLive = environment.Remote.OpenCodex
		s.terminalConflict = func(id, cwd string) error {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			return environment.Remote.Call(ctx, execution.Request{Op: "session-conflict", Path: cwd, Method: id}, nil)
		}
		s.openSessions = func(ctx context.Context) (codex.SessionClient, error) {
			return &execution.Sessions{Context: ctx, Client: environment.Remote}, nil
		}
		s.watchHistory = func(ctx context.Context, id string, emit func(HistoryPush) error) error {
			return watchRemoteHistory(ctx, environment.Remote, id, emit)
		}
	} else {
		s.sessionPool = codex.NewSessionPool()
		s.openSessions = s.sessionPool.Open
		s.openCloudSessions = s.openSessions
	}
	s.openTitleLive = s.openLive
	return s
}

// A launcher can exit after accepting the request. Only release an unused
// reservation; an already connected terminal retains its ownership.
func (s *Service) releaseUnconnectedBridge(plan model.LaunchPlan) {
	if len(plan.Args) == 0 {
		return
	}
	s.bridgeMu.Lock()
	b := s.bridges[strings.TrimPrefix(plan.Args[len(plan.Args)-1], "unix://")]
	s.bridgeMu.Unlock()
	if b == nil {
		return
	}
	b.mu.Lock()
	unused := !b.connected
	if unused {
		b.revoked = true
	}
	b.mu.Unlock()
	if unused {
		b.Close()
	}
}

func (s *Service) Close() {
	s.codexInstaller.Close()
	s.CloseChats()
	s.CloseBridges()
	if s.sessionPool != nil {
		s.sessionPool.Close()
	}
}
