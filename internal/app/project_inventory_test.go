package app

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"worktree-hub/internal/store"
)

func TestProjectInventoryIncludesOfflineRegisteredProjectsWithoutConnecting(t *testing.T) {
	a := testApp(t)
	path := repo(t, "local", "main")
	id := register(t, a, "Local", path)
	tree := createWorktree(t, a, id, "keep")
	note := filepath.Join(tree.Path, "note.txt")
	if err := os.WriteFile(note, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	hub, err := newEnvironmentHub(a)
	if err != nil {
		t.Fatal(err)
	}
	remote := Environment{ID: environmentID("Ubuntu", "user"), Name: "WSL · Ubuntu / user", Root: "/new/root"}
	dataDir := filepath.Join(a.Execution.DataDir, "environments", remote.ID)
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	// The same project ID can exist in two independently stored environments.
	if _, err := db.DB.Exec(`INSERT INTO projects VALUES(?, 'Remote', '/repo/remote', '/repo/remote/.git', 'remote', '9999')`, id); err != nil {
		t.Fatal(err)
	}
	db.DB.Close()
	hub.entries = []Environment{remote, {ID: "missing", Name: "Unavailable metadata"}}

	request := httptest.NewRequest("GET", "http://localhost:4317/api/project-inventory?refresh=1", nil)
	request.Header.Set("X-Environment-ID", remote.ID)
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, request)
	if w.Code != 403 {
		t.Fatal("inventory bypassed authentication")
	}
	request.Header.Set("X-CSRF-Token", a.token)
	w = httptest.NewRecorder()
	a.handler().ServeHTTP(w, request)
	var inventory projectInventory
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &inventory) != nil || len(inventory.Projects) != 2 || len(inventory.Environments) != 3 {
		t.Fatalf("inventory %d %s", w.Code, w.Body.String())
	}
	offline, local := inventory.Projects[0], inventory.Projects[1]
	if offline.ID != id || offline.Path != "/repo/remote" || offline.EnvironmentID != remote.ID || offline.Connected ||
		local.ID != id || local.Path != path || local.EnvironmentID != "local" || !local.Connected {
		t.Fatalf("incorrect environment identity: %+v", inventory.Projects)
	}
	if len(hub.apps) != 0 || inventory.Environments[2].Error == "" {
		t.Fatal("inventory started an environment or hid a metadata error")
	}
	if content, err := os.ReadFile(note); err != nil || string(content) != "keep" {
		t.Fatal("inventory changed working files")
	}
}
