package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"testing"
)

func TestDeleteWorkspacePreservesFilesSessionsAndReleasesProject(t *testing.T) {
	a := testApp(t)
	id := register(t, a, "Keep", repo(t, "lifecycle-keep", "main"))
	_, q, _ := create(t, a, id, nil, "delete-record")
	db := a.Workspace.Store.DB
	for _, statement := range []string{
		`INSERT INTO sessions(id,name,cwd,created_at,updated_at,source) VALUES('keep-session','Keep','/keep',1,1,'codex')`,
		`INSERT INTO requirement_sessions VALUES('` + q.ID + `','keep-session','Keep','/keep',1,1,'codex')`,
		`INSERT INTO task_session_pins VALUES('` + q.ID + `','keep-session')`,
		`INSERT INTO session_create_requests VALUES('` + q.ID + `','request','keep-session')`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	if code, raw := call(t, a, "DELETE", "/api/requirements/"+q.ID, nil); code != 200 {
		t.Fatalf("delete %d %s", code, raw)
	}
	if _, err := a.Workspace.Store.Requirement(q.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("workspace remains: %v", err)
	}
	if _, err := a.Workspace.Store.Session("keep-session"); err != nil {
		t.Fatalf("session lost: %v", err)
	}
	for _, member := range q.Members {
		if _, err := os.Stat(member.Path); err != nil {
			t.Fatalf("worktree lost: %v", err)
		}
	}
	if _, err := os.Stat(q.Path); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"members", "requirement_sessions", "task_session_pins", "session_create_requests"} {
		var count int
		if err := db.QueryRow(`SELECT count(*) FROM `+table+` WHERE requirement_id=?`, q.ID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s count=%d err=%v", table, count, err)
		}
	}
	if code, raw := call(t, a, "DELETE", "/api/projects/"+id, nil); code != 200 {
		t.Fatalf("project %d %s", code, raw)
	}
	if code, _ := call(t, a, "DELETE", "/api/requirements/"+q.ID, nil); code != 404 {
		t.Fatalf("repeat delete %d", code)
	}
}

func TestProjectRemovalRequiresReviewedLinksAndPreservesOtherProjects(t *testing.T) {
	a := testApp(t)
	first := register(t, a, "First", repo(t, "lifecycle-first", "main"))
	second := register(t, a, "Second", repo(t, "lifecycle-second", "main"))
	_, q, _ := create(t, a, first, []string{second}, "unlink-project")
	if code, raw := call(t, a, "POST", "/api/requirements/"+q.ID+"/archive", map[string]bool{"archived": true}); code != 200 {
		t.Fatalf("archive %d %s", code, raw)
	}
	code, raw := call(t, a, "GET", "/api/projects/"+first+"/removal", nil)
	var plan struct {
		Requirements []struct{ ID, Name, State string }
	}
	if err := json.Unmarshal(raw, &plan); err != nil || code != 200 || len(plan.Requirements) != 1 || plan.Requirements[0].ID != q.ID || plan.Requirements[0].State != "archived" {
		t.Fatalf("plan %d %s %v", code, raw, err)
	}
	if code, _ := call(t, a, "DELETE", "/api/projects/"+first, nil); code != 409 {
		t.Fatalf("unconfirmed %d", code)
	}
	if code, _ := call(t, a, "DELETE", "/api/projects/"+first+"?detach=1", map[string]any{"requirements": []string{}}); code != 409 {
		t.Fatalf("stale %d", code)
	}
	if code, raw := call(t, a, "DELETE", "/api/projects/"+first+"?detach=1", map[string]any{"requirements": []string{q.ID}}); code != 200 {
		t.Fatalf("confirmed %d %s", code, raw)
	}
	saved, err := a.Workspace.Store.Requirement(q.ID)
	if err != nil || saved.State != "archived" || len(saved.Members) != 1 || saved.Members[0].ProjectID != second || saved.PrimaryProjectID != second {
		t.Fatalf("remaining scope %+v %v", saved, err)
	}
	for _, member := range q.Members {
		if _, err := os.Stat(member.Path); err != nil {
			t.Fatal(err)
		}
	}
	if code, _ := call(t, a, "GET", "/api/projects/"+first+"/removal", nil); code != 404 {
		t.Fatalf("project returned %d", code)
	}
}

func TestLifecycleBlocksPreparingWorkspace(t *testing.T) {
	a := testApp(t)
	id := register(t, a, "Preparing", repo(t, "preparing", "main"))
	_, q, _ := create(t, a, id, nil, "preparing")
	if _, err := a.Workspace.Store.DB.Exec(`UPDATE requirements SET state='creating' WHERE id=?`, q.ID); err != nil {
		t.Fatal(err)
	}
	if code, _ := call(t, a, "DELETE", "/api/requirements/"+q.ID, nil); code != 409 {
		t.Fatalf("workspace %d", code)
	}
	if code, _ := call(t, a, "DELETE", "/api/projects/"+id+"?detach=1", map[string]any{"requirements": []string{q.ID}}); code != 409 {
		t.Fatalf("project %d", code)
	}
}
