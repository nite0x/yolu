package project

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"worktree-hub/internal/model"
)

func TestCloneProjectRegistersCompleteCheckoutAndSurvivesRefresh(t *testing.T) {
	a := testApp(t)
	_, remote, _ := remoteClone(t)
	parent := t.TempDir()
	code, raw := call(t, a, "POST", "/api/projects/clone", map[string]string{"url": remote, "parent": parent, "directory": "new checkout", "name": "Cloned"})
	if code != 201 {
		t.Fatalf("clone %d %s", code, raw)
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &created); err != nil || created.ID == "" {
		t.Fatalf("response %s %v", raw, err)
	}
	target := filepath.Join(parent, "new checkout")
	if got := testGit(t, target, "remote", "get-url", "origin"); got != remote {
		t.Fatalf("origin %q", got)
	}
	if got := testGit(t, target, "branch", "--show-current"); got != "master" {
		t.Fatalf("default branch %q", got)
	}
	code, raw = call(t, a, "GET", "/api/state", nil)
	var state struct {
		Projects []model.Project `json:"projects"`
	}
	if err := json.Unmarshal(raw, &state); err != nil || code != 200 || len(state.Projects) != 1 || state.Projects[0].ID != created.ID || state.Projects[0].Path != target {
		t.Fatalf("state %d %s %v", code, raw, err)
	}
}

func TestCloneProjectNeverOverwritesExistingDirectory(t *testing.T) {
	a := testApp(t)
	_, remote, _ := remoteClone(t)
	parent := t.TempDir()
	target := filepath.Join(parent, "existing")
	if err := os.Mkdir(target, 0755); err != nil {
		t.Fatal(err)
	}
	// Even an empty directory is not adopted by a clone request.
	for _, withFile := range []bool{false, true} {
		if withFile {
			if err := os.WriteFile(filepath.Join(target, "keep"), []byte("keep"), 0644); err != nil {
				t.Fatal(err)
			}
		}
		if code, raw := call(t, a, "POST", "/api/projects/clone", map[string]string{"url": remote, "parent": parent, "directory": "existing"}); code != 409 {
			t.Fatalf("existing %d %s", code, raw)
		}
	}
	if content, err := os.ReadFile(filepath.Join(target, "keep")); err != nil || string(content) != "keep" {
		t.Fatalf("user file %q %v", content, err)
	}
}

func TestCloneProjectFailuresDoNotRegisterOrEscapeParent(t *testing.T) {
	a := testApp(t)
	parent := t.TempDir()
	source := filepath.Join(parent, "missing.git")
	for _, folder := range []string{"..", "../escape", "/absolute", "child/nested", "C:\\escape"} {
		if code, raw := call(t, a, "POST", "/api/projects/clone", map[string]string{"url": source, "parent": parent, "directory": folder}); code != 400 {
			t.Fatalf("directory %q %d %s", folder, code, raw)
		}
	}
	if code, raw := call(t, a, "POST", "/api/projects/clone", map[string]string{"url": source, "parent": parent, "directory": "failed"}); code != 422 {
		t.Fatalf("failed %d %s", code, raw)
	}
	var count int
	if err := a.Workspace.Store.DB.QueryRow(`SELECT count(*) FROM projects`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("registered failed clone: %d %v", count, err)
	}
	if _, err := os.Stat(filepath.Join(parent, "failed")); !os.IsNotExist(err) {
		t.Fatalf("empty reservation remains: %v", err)
	}
}

func TestCloneSourceRejectsCommandProtocolsAndAcceptsGitTransports(t *testing.T) {
	for _, source := range []string{"--upload-pack=bad", "ext::bad command", "ftp://host/repo.git", "https://", "git@host:repo\nother", ""} {
		if validCloneSource(source) {
			t.Errorf("accepted %q", source)
		}
	}
	for _, source := range []string{"https://host/team/repo.git", "ssh://git@host/team/repo.git", "git@host:team/repo.git", "git@host:repo.git", "file:///tmp/repo.git"} {
		if !validCloneSource(source) {
			t.Errorf("rejected %q", source)
		}
	}
}

func TestCloneRegistrationConflictRetainsUsableRepository(t *testing.T) {
	a := testApp(t)
	_, remote, existing := remoteClone(t)
	register(t, a, "Duplicate", existing)
	parent := t.TempDir()
	code, raw := call(t, a, "POST", "/api/projects/clone", map[string]string{"url": remote, "parent": parent, "directory": "retained", "name": "Duplicate"})
	if code != 409 {
		t.Fatalf("conflict %d %s", code, raw)
	}
	target := filepath.Join(parent, "retained")
	if got := testGit(t, target, "remote", "get-url", "origin"); got != remote {
		t.Fatalf("retained repository origin %q", got)
	}
	if code, raw := call(t, a, "POST", "/api/projects", map[string]string{"path": target, "name": "Recovered"}); code != 201 {
		t.Fatalf("recover registration %d %s", code, raw)
	}
}
