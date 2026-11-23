package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"worktree-hub/internal/model"
)

func writeLegacyDatabase(t *testing.T) (string, string, string) {
	t.Helper()
	dataDir := t.TempDir()
	projects := t.TempDir()
	main := filepath.Join(projects, "main")
	extra := filepath.Join(projects, "extra")
	if err := os.Mkdir(main, 0700); err != nil {
		t.Fatal(err)
	}
	git := func(dir string, args ...string) {
		t.Helper()
		if out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s: %v", args, out, err)
		}
	}
	git(main, "init", "-b", "main")
	git(main, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "baseline")
	tree := filepath.Join(projects, "feature")
	git(main, "worktree", "add", "-b", "feature", tree)
	if err := os.Mkdir(extra, 0700); err != nil {
		t.Fatal(err)
	}
	git(extra, "init", "-b", "main")
	git(extra, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "baseline")
	for _, p := range []*string{&tree, &extra} {
		path, err := filepath.EvalSymlinks(*p)
		if err != nil {
			t.Fatal(err)
		}
		*p = path
	}
	alias := filepath.Join(projects, "alias")
	if err := os.Symlink(extra, alias); err != nil {
		alias = extra
	}
	legacyParent := filepath.Join(projects, "parent")
	if err := os.Mkdir(legacyParent, 0700); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dataDir, "worktree-hub.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := (&Store{DB: db}).migrateAssistant(); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,path TEXT,common_dir TEXT,folder TEXT,created_at TEXT);
CREATE TABLE requirements(id TEXT PRIMARY KEY,name TEXT,slug TEXT,description TEXT,branch TEXT,path TEXT,primary_project_id TEXT NOT NULL REFERENCES projects(id),state TEXT,created_at TEXT,has_workspace INTEGER);
CREATE TABLE members(requirement_id TEXT REFERENCES requirements(id),project_id TEXT REFERENCES projects(id),path TEXT,base_commit TEXT,state TEXT,error TEXT,PRIMARY KEY(requirement_id,project_id));
CREATE TABLE requirement_sessions(requirement_id TEXT REFERENCES requirements(id),session_id TEXT,name TEXT,cwd TEXT,created_at INTEGER,updated_at INTEGER,source TEXT,PRIMARY KEY(requirement_id,session_id));
CREATE TABLE task_session_pins(requirement_id TEXT REFERENCES requirements(id),session_id TEXT REFERENCES sessions(id),PRIMARY KEY(requirement_id,session_id));
CREATE TABLE session_create_requests(requirement_id TEXT REFERENCES requirements(id),request_id TEXT,session_id TEXT,PRIMARY KEY(requirement_id,request_id));
CREATE TABLE sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,cwd TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,source TEXT NOT NULL,last_synced_at INTEGER NOT NULL DEFAULT 0,additional_directories TEXT NOT NULL DEFAULT '[]');
`)
	if err != nil {
		t.Fatal(err)
	}
	statements := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO projects VALUES('p','Main',?,?,'main','now'),('q','Extra',?,?,'extra','now'),('r','Unfinished','/missing/path','/missing/path/.git','unfinished','now')`, []any{main, filepath.Join(main, ".git"), extra, filepath.Join(extra, ".git")}},
		{`INSERT INTO requirements VALUES
 ('a','Feature','feature','Original description','feature',?,'p','ready','now',1),
 ('b','Shared','shared','Another description','','/missing/saved','p','creating','now',0),
 ('c','Unmatched','unmatched','Unlinked description','','/missing/unmatched','p','ready','now',0)`, []any{legacyParent}},
		{`INSERT INTO members VALUES
 ('a','p',?,'base','ready',''),
 ('a','q',?,'base','ready',''),
 ('a','r','relative/path','base','failed','could not create')`, []any{tree, alias}},
		{`INSERT INTO requirement_sessions VALUES ('a','second','Second',?,1,2,'manual'),('b','shared','Stale','/stale',1,1,'manual')`, []any{tree}},
		{`INSERT INTO sessions(id,name,cwd,created_at,updated_at,source,additional_directories) VALUES
 ('shared','Saved title',?,1,3,'workbench',?),
 ('inferred','Directory match',?,1,3,'codex','[]'),
 ('unrelated','Unrelated','/arbitrary',1,3,'codex','[]')`, []any{legacyParent, jsonDirectories(t, extra), tree}},
		{`INSERT INTO task_session_pins VALUES('a','shared'),('a','missing-session');
INSERT INTO session_create_requests VALUES('a','pending','');
INSERT INTO assistant_conversations VALUES('assistant','Previous chat',1,2);
INSERT INTO assistant_runs VALUES('run','assistant','History input','completed','');
INSERT INTO assistant_messages(conversation_id,run_id,role,text) VALUES('assistant','run','assistant','Existing message');`, nil},
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt.query, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}
	return dataDir, tree, extra
}

func jsonDirectories(t *testing.T, paths ...string) string {
	t.Helper()
	raw, err := json.Marshal(paths)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func assertMigratedBindings(t *testing.T, s *Store, tree, extra string) {
	t.Helper()
	session, err := s.Session("shared")
	if err != nil || session.Name != "Saved title" || session.Source != "workbench" {
		t.Fatalf("preserved current index: %+v %v", session, err)
	}
	second, err := s.Session("second")
	if err != nil || second.Name != "Second" || second.Cwd != tree || second.TitleSource != "legacy" {
		t.Fatalf("backfilled legacy index: %+v %v", second, err)
	}
	for _, id := range []string{"shared", "second", "inferred"} {
		bindings, err := s.SessionBindings(id)
		if err != nil || len(bindings) != 2 {
			t.Fatalf("%s: %+v %v", id, bindings, err)
		}
		access := model.SessionBindingRead
		primaryAccess := model.SessionBindingWrite
		if id == "shared" {
			access = model.SessionBindingWrite
			primaryAccess = model.SessionBindingRead
		}
		if bindings[0].Role != model.SessionBindingPrimary || bindings[0].Directory != tree || bindings[0].ProjectID != "p" || bindings[0].Branch != "feature" || bindings[0].Access != primaryAccess {
			t.Fatalf("%s primary: %+v", id, bindings[0])
		}
		if bindings[1].Role != model.SessionBindingAdditional || bindings[1].Directory != extra || bindings[1].ProjectID != "q" || bindings[1].Access != access {
			t.Fatalf("%s additional: %+v", id, bindings[1])
		}
	}
	if managed, err := s.SessionBindingsManaged("unrelated"); err != nil || managed {
		t.Fatalf("unrelated session changed: %v %v", managed, err)
	}
	linked, err := s.SessionIDsForProject("q")
	if err != nil || len(linked) != 3 || !linked["shared"] {
		t.Fatalf("project context: %+v %v", linked, err)
	}
	var count int
	if err := s.DB.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name IN ('requirements','members','requirement_sessions','task_session_pins','workspaces','workspace_sessions','workspace_session_pins','session_create_requests')`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("legacy tables: %d %v", count, err)
	}
	if err := s.DB.QueryRow(`SELECT count(*) FROM pragma_foreign_key_check`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("foreign keys broken: %d %v", count, err)
	}
	if err := s.DB.QueryRow(`SELECT count(*) FROM migration_recovery WHERE reason <> ''`).Scan(&count); err != nil || count < 4 {
		t.Fatalf("missing recoverable migration details: %d %v", count, err)
	}
	var details string
	if err := s.DB.QueryRow(`SELECT payload FROM migration_recovery WHERE kind='legacy_context' AND record_key='["a"]'`).Scan(&details); err != nil || !json.Valid([]byte(details)) {
		t.Fatalf("historical context not recoverable: %q %v", details, err)
	}
	if _, err := os.Stat(filepath.Join(tree, ".git")); err != nil {
		t.Fatalf("existing worktree was modified: %v", err)
	}
	messages, err := s.AssistantMessages("assistant", 0, 100)
	if err != nil || len(messages) != 1 || messages[0].Text != "Existing message" {
		t.Fatalf("message history changed: %+v %v", messages, err)
	}
}

func TestLegacySessionMigrationPreservesDirectoriesAndMetadata(t *testing.T) {
	source, tree, extra := writeLegacyDatabase(t)
	file := filepath.Join(source, "worktree-hub.db")
	before, err := ExportMetadata(context.Background(), file)
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Tables["workspaces"]) != 3 || len(before.Tables["members"]) != 3 {
		t.Fatalf("old metadata could not be exported: %+v", before.Tables)
	}
	// WSL metadata transfer serializes numeric fields through JSON.
	raw, err := json.Marshal(before)
	if err != nil {
		t.Fatal(err)
	}
	var transferred MetadataSnapshot
	if err := json.Unmarshal(raw, &transferred); err != nil {
		t.Fatal(err)
	}
	target, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer target.DB.Close()
	if err := target.ImportMetadata(transferred); err != nil {
		t.Fatal(err)
	}
	assertMigratedBindings(t, target, tree, extra)
	upgraded, err := Open(source)
	if err != nil {
		t.Fatal(err)
	}
	assertMigratedBindings(t, upgraded, tree, extra)
	bindings, _ := upgraded.SessionBindings("shared")
	if err := upgraded.DeleteSessionBinding("shared", bindings[1].ID); err != nil {
		t.Fatal(err)
	}
	upgraded.DB.Close()
	reopened, err := Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.DB.Close()
	bindings, err = reopened.SessionBindings("shared")
	if err != nil || len(bindings) != 1 {
		t.Fatalf("migration replayed: %+v %v", bindings, err)
	}
	after, err := ExportMetadata(context.Background(), file)
	if err != nil {
		t.Fatal(err)
	}
	replica, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer replica.DB.Close()
	if err := replica.ImportMetadata(after); err != nil {
		t.Fatal(err)
	}
	bindings, err = replica.SessionBindings("shared")
	if err != nil || len(bindings) != 1 || len(after.Tables["migration_recovery"]) == 0 {
		t.Fatalf("current snapshot lost data: %+v %v", bindings, err)
	}
}

func TestLegacySessionMigrationRollsBackOnFailure(t *testing.T) {
	source, _, _ := writeLegacyDatabase(t)
	path := filepath.Join(source, "worktree-hub.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`ALTER TABLE members RENAME COLUMN path TO malformed`); err != nil {
		t.Fatal(err)
	}
	if migrated, err := Open(source); err == nil {
		migrated.DB.Close()
		t.Fatal("invalid database migrated")
	}
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM requirements`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("original contexts lost: %d %v", count, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name='session_project_bindings'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("failed conversion left partial schema: %d %v", count, err)
	}
}

func TestLegacySessionMigrationPreservesBothSchemasWhenAmbiguous(t *testing.T) {
	source, _, _ := writeLegacyDatabase(t)
	db, err := sql.Open("sqlite", filepath.Join(source, "worktree-hub.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE workspaces (id TEXT); INSERT INTO workspaces VALUES ('conflicting-record')`); err != nil {
		t.Fatal(err)
	}
	if migrated, err := Open(source); err == nil {
		migrated.DB.Close()
		t.Fatal("ambiguous database migrated")
	}
	var earlier, later int
	if err := db.QueryRow(`SELECT (SELECT count(*) FROM requirements), (SELECT count(*) FROM workspaces)`).Scan(&earlier, &later); err != nil || earlier != 3 || later != 1 {
		t.Fatalf("migration changed historical tables: %d %d %v", earlier, later, err)
	}
}
