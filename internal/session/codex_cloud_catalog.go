package session

import (
	"context"
	"errors"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/codexcloud"
	"worktree-hub/internal/model"
	"worktree-hub/internal/store"
)

type cloudCatalogEntry struct {
	identity string
	done     chan struct{}
	expires  time.Time
	err      error
}

func (a *Service) cloudCatalog(ctx context.Context, force bool) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client, err := a.cloudClient(ctx)
	if err != nil {
		// Cloud is optional, and a cached list is only visible after login.
		return "", nil
	}
	identity := client.Identity()
	a.catalogMu.Lock()
	if cached := a.cloudCatalogCache; cached != nil && cached.identity == identity {
		select {
		case <-cached.done:
			if !force && time.Now().Before(cached.expires) {
				a.catalogMu.Unlock()
				return identity, cached.err
			}
		default:
			a.catalogMu.Unlock()
			select {
			case <-cached.done:
				return identity, cached.err
			case <-ctx.Done():
				return identity, ctx.Err()
			}
		}
	}
	entry := &cloudCatalogEntry{identity: identity, done: make(chan struct{})}
	a.cloudCatalogCache = entry
	a.catalogMu.Unlock()

	entry.err = a.scanCloudCatalog(ctx, client)
	entry.expires = time.Now().Add(30 * time.Second)
	if entry.err != nil {
		entry.expires = time.Now().Add(10 * time.Second)
	}
	close(entry.done)
	return identity, entry.err
}

func (a *Service) scanCloudCatalog(ctx context.Context, client *codexcloud.Client) error {
	observedAt := time.Now().UnixNano()
	// The picker is a separate service. A slow picker must not consume the
	// deadline for thread discovery or prevent opening a listed thread.
	environmentCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	environmentNames := make(chan map[string]string, 1)
	go func() {
		environments, _ := client.Environments(environmentCtx)
		names := make(map[string]string, len(environments))
		for _, environment := range environments {
			names[environment.ID] = environment.Name
		}
		environmentNames <- names
	}()
	var names map[string]string
	for _, archived := range []bool{false, true} {
		var entries []store.CodexCloudListing
		var cursor string
		seen := map[string]bool{}
		for {
			threads, next, err := client.ListThreads(ctx, archived, cursor)
			if err != nil {
				return err
			}
			if names == nil {
				names = <-environmentNames
			}
			for _, thread := range threads {
				name := sessionName(codex.Session{Name: thread.Name})
				named := name != ""
				if !named && thread.Preview != "" {
					name = initialSessionTitle(thread.Preview)
				}
				entries = append(entries, store.CodexCloudListing{
					Session: model.Session{
						ID: "cloud-" + thread.ID, Name: name, Cwd: thread.Cwd, CreatedAt: thread.CreatedAt,
						UpdatedAt: thread.UpdatedAt, Provider: model.ProviderCodexCloud, Source: "codex-cloud",
					},
					Cloud: store.CodexCloudSession{
						ThreadID: thread.ID, Identity: client.Identity(), Environment: names[thread.EnvironmentID], Model: thread.Model,
					},
					Named: named,
				})
			}
			if next == "" {
				break
			}
			if seen[next] {
				return errors.New("Codex Cloud 对话分页未前进，请重试")
			}
			seen[next], cursor = true, next
		}
		if err := a.Execution.Store.SaveCodexCloudListings(entries, archived, observedAt); err != nil {
			return err
		}
	}
	return nil
}
