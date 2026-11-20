package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestLegacyMembersMigrationAndMetadataPreserveWorkspaceScope(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "worktree-hub.db")
	db, err := sql.Open("sqlite", file)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT,path TEXT,common_dir TEXT,folder TEXT,created_at TEXT);
CREATE TABLE workspaces (id TEXT PRIMARY KEY,name TEXT,slug TEXT,description TEXT,branch TEXT,path TEXT,primary_project_id TEXT,state TEXT,created_at TEXT);
CREATE TABLE members (workspace_id TEXT,project_id TEXT,path TEXT NOT NULL UNIQUE,base_commit TEXT,state TEXT,error TEXT,PRIMARY KEY(workspace_id,project_id));
INSERT INTO projects VALUES('p','Repo','/repo','/repo/.git','repo','now');
INSERT INTO workspaces(id,name,slug,description,branch,path,primary_project_id,state,created_at) VALUES('r','Workspace','workspace','notes','feature/workspace','/workspace/workspace','p','ready','now');
INSERT INTO members VALUES('r','p','/workspace/workspace/repo','baseline','ready','');`)
	if err != nil {
		t.Fatal(err)
	}
	db.Close()
	// An offline environment's old database can be read/exported without mutation.
	readonly, err := OpenReadOnly(dir)
	if err != nil {
		t.Fatal(err)
	}
	q, err := readonly.Workspace("r")
	readonly.DB.Close()
	if err != nil || q.Members[0].Mode != "new" || q.Members[0].Branch != "feature/workspace" {
		t.Fatalf("legacy read: %+v %v", q, err)
	}
	snapshot, err := ExportMetadata(context.Background(), file)
	if err != nil {
		t.Fatal(err)
	}
	target, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer target.DB.Close()
	snapshot.Tables["members"][0] = snapshot.Tables["members"][0][:6] // Older exporters sent six fields.
	if err := target.ImportMetadata(snapshot); err != nil {
		t.Fatal(err)
	}
	q, err = target.Workspace("r")
	if err != nil || q.Members[0].BaseRef != "refs/heads/master" || q.Members[0].BaseCommit != "baseline" {
		t.Fatalf("legacy import: %+v %v", q, err)
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	q, err = s.Workspace("r")
	if err != nil || q.Members[0].Branch != "feature/workspace" || q.Path != "/workspace/workspace" {
		t.Fatalf("migration: %+v %v", q, err)
	}
	_, err = s.DB.Exec(`INSERT INTO workspaces(id,name,slug,description,branch,path,primary_project_id,state,created_at) VALUES('r2','Other','other','notes','','/workspace/other','p','ready','now');
INSERT INTO members(workspace_id,project_id,path,base_commit,state,mode,base_ref,branch) VALUES('r2','p','/workspace/workspace/repo','baseline','ready','worktree','','feature/workspace');`)
	if err != nil {
		t.Fatalf("migrated worktree cannot be reused: %v", err)
	}
	snapshot, err = ExportMetadata(context.Background(), file)
	if err != nil {
		t.Fatal(err)
	}
	target2, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer target2.DB.Close()
	if err := target2.ImportMetadata(snapshot); err != nil {
		t.Fatal(err)
	}
	q, err = target2.Workspace("r2")
	if err != nil || q.Members[0].Mode != "worktree" || q.Members[0].Branch != "feature/workspace" {
		t.Fatalf("new metadata lost selection: %+v %v", q, err)
	}
}

func TestWorkspaceDirectoryPresenceSurvivesMetadataTransfer(t *testing.T) {
	source, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer source.DB.Close()
	_, err = source.DB.Exec(`INSERT INTO projects(id,name,path,common_dir,folder,created_at) VALUES('p','Repo','/repo','/repo/.git','repo','now');
 INSERT INTO workspaces(id,name,slug,description,branch,path,primary_project_id,state,created_at,has_directory) VALUES('workspace','Workspace','workspace','','','/reserved/workspace','p','ready','now',0);`)
	if err != nil {
		t.Fatal(err)
	}
	var file string
	if err := source.DB.QueryRow(`SELECT file FROM pragma_database_list WHERE name='main'`).Scan(&file); err != nil {
		t.Fatal(err)
	}
	snapshot, err := ExportMetadata(context.Background(), file)
	if err != nil {
		t.Fatal(err)
	}
	target, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer target.DB.Close()
	if err := target.ImportMetadata(snapshot); err != nil {
		t.Fatal(err)
	}
	q, err := target.Workspace("workspace")
	if err != nil || q.HasDirectory || q.Path != "/reserved/workspace" {
		t.Fatalf("workspace-free workspace changed: %+v %v", q, err)
	}
	legacy, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer legacy.DB.Close()
	snapshot.Tables["workspaces"][0] = snapshot.Tables["workspaces"][0][:9]
	if err := legacy.ImportMetadata(snapshot); err != nil {
		t.Fatal(err)
	}
	q, err = legacy.Workspace("workspace")
	if err != nil || !q.HasDirectory {
		t.Fatalf("legacy workspace lost its workspace: %+v %v", q, err)
	}
}
