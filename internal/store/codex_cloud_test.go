package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"worktree-hub/internal/model"
)

func TestCloudDiscoveryIndexesAndScopesExistingThreads(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	cloud := CodexCloudSession{ThreadID: "remote", Identity: "account-1", Environment: "apix", Model: "model"}
	record := model.Session{ID: "cloud-remote", Name: "Original task", Provider: model.ProviderCodexCloud, Source: "codex-cloud", CreatedAt: 40, UpdatedAt: 42, Cwd: "/workspace/apix"}
	observation := time.Now().UnixNano()
	save := func(record model.Session, cloud CodexCloudSession, archived, named bool) {
		t.Helper()
		if err := s.SaveCodexCloudListings([]CodexCloudListing{{Session: record, Cloud: cloud, Named: named}}, archived, observation); err != nil {
			t.Fatal(err)
		}
	}
	save(record, cloud, true, true)
	if err := s.SetSessionPinned(record.ID, true); err != nil {
		t.Fatal(err)
	}
	save(record, cloud, false, true)
	if _, err := s.DB.Exec(`INSERT INTO conversation_create_requests(request_id,fingerprint) VALUES('request','fingerprint')`); err != nil {
		t.Fatal(err)
	}
	created := record
	created.Source = "workbench"
	if err := s.SaveCodexCloudSession(created, cloud, "request"); err != nil {
		t.Fatalf("create after discovery: %v", err)
	}
	first, err := s.Session(record.ID)
	if err != nil || first.Archived || !first.Pinned {
		t.Fatalf("active thread = %+v, error = %v", first, err)
	}
	if err := s.SetSessionTitle(record.ID, "Local name", "manual"); err != nil {
		t.Fatal(err)
	}
	if err := s.OrganizeSession(record.ID, true, true); err != nil {
		t.Fatal(err)
	}
	record.Name, record.Cwd, record.UpdatedAt = "Cloud title", "", 45
	cloud.Environment, cloud.Model = "", ""
	save(record, cloud, false, true)
	if err := s.SaveSession(model.Session{ID: "local"}); err != nil {
		t.Fatal(err)
	}
	visible, err := s.SessionsForCloudIdentity(cloud.Identity)
	if err != nil || len(visible) != 2 || visible[0].ID != record.ID {
		t.Fatalf("visible threads = %+v, error = %v", visible, err)
	}
	got := visible[0]
	if got.Name != "Local name" || got.Source != "workbench" || got.CloudEnvironment != "apix" || got.UpdatedAt != 45 || got.Cwd != "/workspace/apix" || !got.Pinned || !got.Archived {
		t.Fatalf("unexpected merged thread: %+v", got)
	}
	for _, identity := range []string{"", "account-2"} {
		visible, err := s.SessionsForCloudIdentity(identity)
		if err != nil || len(visible) != 1 || visible[0].ID != "local" {
			t.Fatalf("another login received %+v, error = %v", visible, err)
		}
	}
}

func TestCloudMetadataRoundTripPreservesAccountScopeAndConfirmedInput(t *testing.T) {
	ctx := context.Background()
	source := t.TempDir()
	s, err := Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	record := model.Session{ID: "cloud-thread", Provider: model.ProviderCodexCloud, UpdatedAt: 1}
	link := CodexCloudSession{ThreadID: "thread", Identity: "account-a", Environment: "environment", Model: "model"}
	if err := s.ReserveCreation(ctx, "creation", "fingerprint"); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveCodexCloudSession(record, link, "creation"); err != nil {
		t.Fatal(err)
	}
	if err := s.ReserveInput(ctx, record.ID, "message", "input-fingerprint"); err != nil {
		t.Fatal(err)
	}
	if err := s.ConfirmInputAndTouchSession(ctx, record.ID, "message", 2); err != nil {
		t.Fatal(err)
	}
	snapshot, err := ExportMetadata(ctx, filepath.Join(source, "worktree-hub.db"))
	if err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	imported, err := Open(target)
	if err != nil {
		t.Fatal(err)
	}
	if err := imported.ImportMetadata(snapshot); err != nil {
		imported.Close()
		t.Fatal(err)
	}
	if err := imported.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(target)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	got, err := reopened.CodexCloudSession(record.ID)
	if err != nil || got != link {
		t.Fatalf("cloud link: %+v %v", got, err)
	}
	visible, err := reopened.SessionsForCloudIdentity(link.Identity)
	if err != nil || len(visible) != 1 || visible[0].UpdatedAt != 2 {
		t.Fatalf("owner view: %+v %v", visible, err)
	}
	other, err := reopened.SessionsForCloudIdentity("account-b")
	if err != nil || len(other) != 0 {
		t.Fatalf("another account received imported cloud data: %+v %v", other, err)
	}
	fingerprint, status, err := reopened.InputReceipt(ctx, record.ID, "message")
	if err != nil || fingerprint != "input-fingerprint" || status != "accepted" {
		t.Fatalf("input receipt: %q %q %v", fingerprint, status, err)
	}
}
