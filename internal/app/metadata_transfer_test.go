package app

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"worktree-hub/internal/model"
	"worktree-hub/internal/store"
)

func TestMetadataSnapshotPreservesSessionDirectoriesAndImportsTransactionally(t *testing.T) {
	source := testApp(t)
	const directory = "/saved/worktrees/project"
	_, err := source.Execution.Store.DB.Exec(`INSERT INTO projects VALUES('p','Project','/original/repo','/original/repo/.git','project','now');
INSERT INTO sessions(id,name,cwd,created_at,updated_at,source,last_synced_at,permission) VALUES('session','Title',?,123,456,'manual',456,'ask');
INSERT INTO settings VALUES('terminal','{"kind":"windows-terminal"}')`, directory)
	if err != nil {
		t.Fatal(err)
	}
	_, err = source.Execution.Store.BindSessionDirectory(model.SessionProjectBinding{SessionID: "session", ProjectID: "p", Directory: directory, Role: "primary", Access: "write"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.ExportMetadata(context.Background(), filepath.Join(source.Execution.DataDir, "worktree-hub.db"))
	if err != nil {
		t.Fatal(err)
	}
	// Round trip through JSON, as the actual WSL transport does.
	raw, _ := json.Marshal(snapshot)
	var transferred store.MetadataSnapshot
	if err := json.Unmarshal(raw, &transferred); err != nil {
		t.Fatal(err)
	}
	target := testApp(t)
	if err := target.Execution.Store.ImportMetadata(transferred); err != nil {
		t.Fatal(err)
	}
	bindings, err := target.Execution.Store.SessionBindings("session")
	if err != nil || len(bindings) != 1 || bindings[0].Directory != directory || bindings[0].ProjectID != "p" {
		t.Fatalf("bindings: %+v %v", bindings, err)
	}
	sessions, err := target.Execution.Store.Sessions()
	if err != nil || len(sessions) != 1 || sessions[0].UpdatedAt != 456 || sessions[0].Permission != "ask" {
		t.Fatalf("sessions: %+v %v", sessions, err)
	}
	if err := target.Execution.Store.ImportMetadata(transferred); err == nil {
		t.Fatal("import overwrote an existing environment")
	}
	broken := testApp(t)
	transferred.Tables["session_project_bindings"][0] = []any{"invalid"}
	if err := broken.Execution.Store.ImportMetadata(transferred); err == nil {
		t.Fatal("invalid import succeeded")
	}
	var count int
	if err := broken.Execution.Store.DB.QueryRow("SELECT count(*) FROM projects").Scan(&count); err != nil || count != 0 {
		t.Fatal("failed import left partial metadata")
	}
}
