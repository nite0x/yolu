package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"sort"
	"sync"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

type catalogEntry struct {
	done    chan struct{}
	updated time.Time
	found   map[string]codex.Session
	err     error
}

// RefreshConversationCatalog shares native discovery and index writes with the
// sidebar without opening or resuming any coding conversation.
func (a *Service) RefreshConversationCatalog(ctx context.Context) error {
	_, err := a.sessionCatalog(ctx, sessionScope{}, false, false)
	return err
}

// SearchSessionsHandler serves the saved index without starting an agent.
// Discovery updates titles and archive state without reading individual threads.
func (a *Service) SearchSessionsHandler(w http.ResponseWriter, r *http.Request) {
	var discoveryErr error
	provider := r.URL.Query().Get("discover")
	switch provider {
	case model.ProviderCodex:
		var activeErr, archiveErr error
		var scans sync.WaitGroup
		scans.Go(func() { _, activeErr = a.sessionCatalog(r.Context(), sessionScope{}, false, false) })
		scans.Go(func() { _, archiveErr = a.sessionCatalog(r.Context(), sessionScope{}, true, false) })
		scans.Wait()
		discoveryErr = errors.Join(activeErr, archiveErr)
	case model.ProviderAgy:
		// Antigravity is optional, as it is on the Conversations page.
		_, _ = a.scanAgyCatalog(r.Context(), sessionScope{}, false)
	default:
		provider = ""
	}
	var cloudIdentity string
	if provider == "" && a.openCloudSessions != nil {
		hasCloud, err := a.Execution.Store.HasCodexCloudSessions()
		if err != nil {
			httpx.DbError(w, err)
			return
		}
		if hasCloud {
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()
			if client, err := a.cloudClient(ctx); err == nil {
				cloudIdentity = client.Identity()
			}
		}
	}
	sessions, err := a.Execution.Store.SessionsForCloudIdentity(cloudIdentity)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	if provider != "" {
		sessions = slices.DeleteFunc(sessions, func(session model.Session) bool { return session.Provider != provider })
	}
	result := map[string]any{"sessions": sessions}
	if discoveryErr != nil {
		result["error"] = discoveryErr.Error()
	}
	httpx.WriteJSON(w, 200, result)
}

// Share pagination and index writes across simultaneous sidebar/list requests.
// Runtime state is decorated by each caller and never cached in this catalog.
func (a *Service) sessionCatalog(ctx context.Context, scope sessionScope, archived, force bool) (map[string]codex.Session, error) {
	paths := append([]string(nil), scope.paths...)
	sort.Strings(paths)
	keyBytes, _ := json.Marshal([]any{archived, paths})
	key := string(keyBytes)
	a.catalogMu.Lock()
	if a.catalogs == nil {
		a.catalogs = map[string]*catalogEntry{}
	}
	if entry := a.catalogs[key]; entry != nil {
		select {
		case <-entry.done:
			if !force && entry.err == nil && time.Since(entry.updated) < 10*time.Second {
				a.catalogMu.Unlock()
				return maps.Clone(entry.found), nil
			}
		default:
			a.catalogMu.Unlock()
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-entry.done:
				return maps.Clone(entry.found), entry.err
			}
		}
	}
	for key, entry := range a.catalogs {
		select {
		case <-entry.done:
			if time.Since(entry.updated) > 10*time.Second {
				delete(a.catalogs, key)
			}
		default:
		}
	}
	entry := &catalogEntry{done: make(chan struct{})}
	a.catalogs[key] = entry
	a.catalogMu.Unlock()
	entry.found, entry.err = a.scanSessionCatalog(ctx, scope, archived)
	a.catalogMu.Lock()
	entry.updated = time.Now()
	close(entry.done)
	a.catalogMu.Unlock()
	return maps.Clone(entry.found), entry.err
}

func (a *Service) invalidateSessionCatalog() {
	a.catalogMu.Lock()
	a.catalogs = nil
	a.catalogMu.Unlock()
}

func (a *Service) scanSessionCatalog(ctx context.Context, scope sessionScope, archived bool) (map[string]codex.Session, error) {
	c, err := a.openSessions(ctx)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	started, observed := time.Now().UnixMilli(), time.Now().UnixNano()
	params := map[string]any{"archived": archived}
	if scope.paths != nil {
		params["cwd"] = scope.paths
	}
	found := map[string]codex.Session{}
	seen := map[string]bool{}
	for {
		page, err := sessionList(c, params)
		if err != nil {
			return nil, err
		}
		for _, s := range page.Data {
			if s.ID == "" || !scope.includes(s.ID, s.Cwd) {
				continue
			}
			found[s.ID] = s
			if err := a.SaveSession(s, "codex", observed); err != nil {
				return nil, err
			}
			if err := a.Execution.Store.ObserveSessionArchive(s.ID, archived, started); err != nil {
				return nil, err
			}
		}
		if page.NextCursor == nil {
			return found, nil
		}
		if seen[*page.NextCursor] {
			return nil, fmt.Errorf("Codex 对话分页未前进，请重试")
		}
		seen[*page.NextCursor] = true
		params["cursor"] = *page.NextCursor
	}
}
