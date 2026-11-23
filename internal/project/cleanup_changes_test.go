package project

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"worktree-hub/internal/execution"
)

func reviewWorktree(t *testing.T, a *App, projectID, path string) CleanupCandidate {
	t.Helper()
	code, raw := call(t, a, "GET", "/api/projects/"+projectID+"/worktree?path="+url.QueryEscape(path), nil)
	var result CleanupCandidate
	if err := json.Unmarshal(raw, &result); err != nil || code != 200 {
		t.Fatalf("review %d %s %v", code, raw, err)
	}
	return result
}

func TestCleanupChecksDirtyReferencedIgnoredAndExpiredPreview(t *testing.T) {
	a := testApp(t)
	id := register(t, a, "Repo", repo(t, "repo", "main"))
	q := createWorktree(t, a, id, "cleanup")
	path := q.Path
	endpoint := "/api/projects/" + id + "/worktree"
	clean := reviewWorktree(t, a, id, path)
	if !clean.Cleanable {
		t.Fatal(clean)
	}
	input := map[string]string{"path": path, "fingerprint": clean.Fingerprint}
	dirty := filepath.Join(path, "keep.txt")
	if err := os.WriteFile(dirty, []byte("unsaved"), 0600); err != nil {
		t.Fatal(err)
	}
	if code, _ := call(t, a, "DELETE", endpoint, input); code != 409 {
		t.Fatal("dirty worktree removed", code)
	}
	os.Remove(dirty)
	// Ignored files are preserved even though Git status reports clean.
	ignore := filepath.Join(t.TempDir(), "ignore")
	testGit(t, path, "config", "core.excludesFile", ignore)
	os.WriteFile(ignore, []byte("ignored.txt\n"), 0600)
	ignored := filepath.Join(path, "ignored.txt")
	os.WriteFile(ignored, []byte("keep ignored"), 0600)
	if item := reviewWorktree(t, a, id, path); item.Cleanable || !item.Ignored {
		t.Fatal(item)
	}
	os.Remove(ignored)
	binding := bindTestSession(t, a, "saved", id, path)
	if item := reviewWorktree(t, a, id, path); item.Cleanable || !strings.Contains(strings.Join(item.Reasons, " "), "仍有对话") {
		t.Fatal(item)
	}
	if code, _ := call(t, a, "DELETE", endpoint, input); code != 409 {
		t.Fatal("referenced worktree removed", code)
	}
	if err := a.Execution.Store.DeleteSessionBinding(binding.SessionID, binding.ID); err != nil {
		t.Fatal(err)
	}
	current := reviewWorktree(t, a, id, path)
	if !current.Cleanable {
		t.Fatal(current)
	}
	input["fingerprint"] = "old-preview"
	if code, _ := call(t, a, "DELETE", endpoint, input); code != 409 {
		t.Fatal("expired preview accepted", code)
	}
	input["fingerprint"] = current.Fingerprint
	a.ReserveWorktree = func(context.Context, string) (func(), error) { return nil, fmt.Errorf("active conversation") }
	if code, _ := call(t, a, "DELETE", endpoint, input); code != 409 {
		t.Fatal("active worktree removed", code)
	}
	a.ReserveWorktree = nil
	if code, raw := call(t, a, "DELETE", endpoint, input); code != 200 {
		t.Fatalf("cleanup %d %s", code, raw)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("directory retained", err)
	}
	ps, _ := a.Execution.Store.ProjectMap()
	testGit(t, ps[id].Path, "show-ref", "--verify", "refs/heads/"+q.Branch)
	if _, err := a.Execution.Store.DB.Exec(`DELETE FROM sessions WHERE id='saved'`); err != nil {
		t.Fatal(err)
	}
	if code, raw := manualWorktree(t, a, id, CreateWorktree{Slug: "cleanup", Mode: "existing", Branch: q.Branch}); code != 201 {
		t.Fatalf("reuse kept branch %d %s", code, raw)
	}
}

func TestCleanupRejectsUnpublishedCommit(t *testing.T) {
	a := testApp(t)
	id := register(t, a, "Repo", repo(t, "repo", "main"))
	q := createWorktree(t, a, id, "unpublished")
	if item := reviewWorktree(t, a, id, q.Path); !item.Cleanable {
		t.Fatal(item)
	}
	commitFile(t, q.Path, "commit.txt", "keep commit")
	if item := reviewWorktree(t, a, id, q.Path); item.Cleanable {
		t.Fatal("unpublished commit accepted")
	}
}

func TestChangesPreviewIndexWorkingUntrackedAndTraversal(t *testing.T) {
	a := testApp(t)
	path := repo(t, "repo", "main")
	id := register(t, a, "Repo", path)
	os.WriteFile(filepath.Join(path, "file.txt"), []byte("original\n"), 0600)
	testGit(t, path, "add", "file.txt")
	testGit(t, path, "commit", "-m", "baseline")
	os.WriteFile(filepath.Join(path, "file.txt"), []byte("staged\n"), 0600)
	testGit(t, path, "add", "file.txt")
	os.WriteFile(filepath.Join(path, "file.txt"), []byte("working\n"), 0600)
	os.WriteFile(filepath.Join(path, "新文件.txt"), []byte("<script>inert</script>\n"), 0600)
	base := "/api/projects/" + id + "/changes?path=" + url.QueryEscape(path)
	code, raw := call(t, a, "GET", base, nil)
	if code != 200 || !strings.Contains(string(raw), "新文件.txt") {
		t.Fatalf("list %d %s", code, raw)
	}
	for _, mode := range []string{"working", "index"} {
		code, raw := call(t, a, "GET", base+"&file=file.txt&mode="+mode, nil)
		if code != 200 || !strings.Contains(string(raw), "+"+map[string]string{"working": "working", "index": "staged"}[mode]) {
			t.Fatalf("preview %s %d %s", mode, code, raw)
		}
	}
	code, raw = call(t, a, "GET", base+"&file="+url.QueryEscape("新文件.txt"), nil)
	var text execution.GitPreview
	json.Unmarshal(raw, &text)
	if code != 200 || !strings.Contains(text.Text, "<script>inert</script>") {
		t.Fatalf("text %d %s", code, raw)
	}
	if code, _ := call(t, a, "GET", base+"&file=../outside", nil); code != 409 {
		t.Fatal("traversal accepted", code)
	}
	if err := os.Symlink(filepath.Join(t.TempDir(), "outside"), filepath.Join(path, "link")); err == nil {
		if code, _ := call(t, a, "GET", base+"&file=link", nil); code != 422 {
			t.Fatal("symlink accepted", code)
		}
	}
}

func TestChangesPreviewWorkingImagesAndStagedBinaryDescription(t *testing.T) {
	a := testApp(t)
	path := repo(t, "repo", "main")
	id := register(t, a, "Repo", path)
	image := filepath.Join(path, "project.png")
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("\x00", 16))
	if err := os.WriteFile(image, png, 0600); err != nil {
		t.Fatal(err)
	}
	base := "/api/projects/" + id + "/changes?path=" + url.QueryEscape(path) + "&file=project.png"
	checkImage := func() {
		t.Helper()
		code, raw := call(t, a, "GET", base+"&mode=working", nil)
		var preview execution.FilePreview
		if code != 200 || json.Unmarshal(raw, &preview) != nil || preview.Format != "image" || !strings.HasPrefix(preview.DataURL, "data:image/png;base64,") {
			t.Fatalf("image %d %s", code, raw)
		}
	}
	checkImage() // Untracked image.
	testGit(t, path, "add", "project.png")
	testGit(t, path, "commit", "-m", "image baseline")
	if err := os.WriteFile(image, append(png, 1), 0600); err != nil {
		t.Fatal(err)
	}
	checkImage() // Modified working image.
	testGit(t, path, "add", "project.png")
	code, raw := call(t, a, "GET", base+"&mode=index", nil)
	if code != 200 || !strings.Contains(string(raw), "Binary files ") || strings.Contains(string(raw), "data_url") {
		t.Fatalf("staged binary %d %s", code, raw)
	}
	if err := os.Remove(image); err != nil {
		t.Fatal(err)
	}
	code, raw = call(t, a, "GET", base+"&mode=working", nil)
	if code != 200 || !strings.Contains(string(raw), "Binary files ") {
		t.Fatalf("deleted binary %d %s", code, raw)
	}
}
