package session

import (
	"context"
	"fmt"
	"testing"

	"worktree-hub/internal/codex"
)

func TestAssistantDiscoveryReusesNativeCatalogAndPreservesSavedIndexOnFailure(t *testing.T) {
	a := testApp(t)
	opens := 0
	a.openSessions = func(context.Context) (codex.SessionClient, error) {
		opens++
		return &fakeSessionClient{request: func(method string, _ map[string]any) (any, error) {
			if method != "thread/list" {
				return nil, fmt.Errorf("unexpected %s", method)
			}
			return codex.SessionPage{Data: []codex.Session{{ID: "native-discovered", Name: "Existing native conversation", Cwd: "/repo"}}}, nil
		}}, nil
	}
	for range 2 {
		if err := a.RefreshConversationCatalog(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if opens != 1 {
		t.Fatalf("catalog requests were duplicated: %d", opens)
	}
	saved, err := a.Workspace.Store.Session("native-discovered")
	if err != nil || saved.Name != "Existing native conversation" || saved.LastSyncedAt == 0 {
		t.Fatalf("native discovery index missing: %+v %v", saved, err)
	}
	a.invalidateSessionCatalog()
	a.openSessions = func(context.Context) (codex.SessionClient, error) { return nil, fmt.Errorf("offline") }
	if err := a.RefreshConversationCatalog(context.Background()); err == nil {
		t.Fatal("discovery failure was hidden")
	}
	if _, err := a.Workspace.Store.Session("native-discovered"); err != nil {
		t.Fatal("saved native history was lost", err)
	}
}
