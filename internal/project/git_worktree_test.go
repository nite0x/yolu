package project

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
)

func commitFile(t *testing.T, path, file, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(path, file), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	testGit(t, path, "add", "--", file)
	testGit(t, path, "commit", "-m", file)
}

func TestWorktreePushPublishesOnlySelectedBranchAndTracksUpstream(t *testing.T) {
	a := testApp(t)
	_, remote, clone := remoteClone(t)
	id := register(t, a, "App", clone)
	gitAction(t, a, id, GitAction{Action: "fetch", Remote: "origin"})
	gitAction(t, a, id, GitAction{Action: "create_branch", Name: "master", Source: "refs/remotes/origin/master", Track: true})
	q := createWorktree(t, a, id, "push-worktree")
	path := q.Path
	commitFile(t, path, "worktree.txt", "worktree")
	_ = os.WriteFile(filepath.Join(path, "unsaved.txt"), []byte("keep"), 0644)
	in := GitAction{Action: "push", Path: path, Remote: "origin", Name: q.Branch, Track: true}
	if code, raw := gitAction(t, a, id, in); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if testGit(t, remote, "rev-parse", q.Branch) != testGit(t, path, "rev-parse", "HEAD") {
		t.Fatal("wrong pushed commit")
	}
	if testGit(t, clone, "branch", "--show-current") != "codex/wsl-startup" {
		t.Fatal("changed original directory")
	}
	state, err := execution.ReadGitState(context.Background(), path)
	if err != nil || state.Upstream != "origin/"+q.Branch || !state.SyncAvailable || state.SyncAhead != 0 || state.Dirty != 1 {
		t.Fatalf("%+v %v", state, err)
	}
	commitFile(t, path, "next.txt", "next")
	state, _ = execution.ReadGitState(context.Background(), path)
	if state.SyncAhead != 1 {
		t.Fatalf("wrong upstream ahead count: %+v", state)
	}
	if content, _ := os.ReadFile(filepath.Join(path, "unsaved.txt")); string(content) != "keep" {
		t.Fatal("lost uncommitted file")
	}
	// A non-fast-forward push must not replace the remote branch.
	if code, raw := gitAction(t, a, id, in); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	before := testGit(t, remote, "rev-parse", q.Branch)
	testGit(t, path, "reset", "--hard", "HEAD~1")
	commitFile(t, path, "diverged.txt", "other")
	if code, raw := gitAction(t, a, id, in); code != 409 || !strings.Contains(string(raw), "push_rejected") {
		t.Fatalf("%d %s", code, raw)
	}
	if got := testGit(t, remote, "rev-parse", q.Branch); got != before {
		t.Fatal("remote overwritten")
	}
}

func TestWorktreeSwitchUsesLiveBranchAndRejectsStaleSelection(t *testing.T) {
	a := testApp(t)
	root := repo(t, "switch", "master")
	id := register(t, a, "App", root)
	tree := createWorktree(t, a, id, "branch-switch")
	testGit(t, root, "branch", "other")
	in := GitAction{Action: "switch", Path: tree.Path, Source: "refs/heads/other", ExpectedBranch: tree.Branch}
	if code, raw := gitAction(t, a, id, in); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if testGit(t, tree.Path, "branch", "--show-current") != "other" || testGit(t, root, "branch", "--show-current") != "master" {
		t.Fatal("unexpected checkout changed")
	}
	if code, _ := gitAction(t, a, id, in); code != 409 {
		t.Fatal("stale branch accepted")
	}
}

func TestMergeConflictIsStructuredAndCanBeRecoveredOrAborted(t *testing.T) {
	a := testApp(t)
	root := repo(t, "merge", "master")
	testGit(t, root, "switch", "-c", "source")
	commitFile(t, root, "README.md", "source\n")
	testGit(t, root, "switch", "master")
	id := register(t, a, "App", root)
	q := createWorktree(t, a, id, "merge-worktree")
	path := q.Path
	commitFile(t, path, "README.md", "target\n")
	in := GitAction{Action: "merge_preview", Path: path, Source: "refs/heads/source"}
	code, raw := gitAction(t, a, id, in)
	if code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	var preview struct {
		Head   string `json:"expected_head"`
		Source string `json:"source_commit"`
	}
	_ = json.Unmarshal(raw, &preview)
	in.Action, in.ExpectedHead, in.SourceCommit = "merge", preview.Head, preview.Source
	code, raw = gitAction(t, a, id, in)
	var result struct {
		Conflict bool     `json:"conflict"`
		Files    []string `json:"conflicts"`
		Head     string   `json:"merge_head"`
	}
	_ = json.Unmarshal(raw, &result)
	if code != 200 || !result.Conflict || len(result.Files) != 1 || result.Files[0] != "README.md" || result.Head != preview.Source {
		t.Fatalf("%d %s", code, raw)
	}
	state, err := execution.ReadGitState(context.Background(), path)
	if err != nil || state.Operation != "merge" || len(state.Conflicts) != 1 {
		t.Fatalf("%+v %v", state, err)
	}
	if code, _ := gitAction(t, a, id, GitAction{Action: "switch", Source: "refs/heads/source", Path: path}); code != 409 {
		t.Fatal("switch during merge accepted")
	}
	if code, raw := gitAction(t, a, id, GitAction{Action: "merge_abort", Path: path}); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	state, _ = execution.ReadGitState(context.Background(), path)
	if state.Operation != "" || state.Dirty != 0 || state.Head != preview.Head {
		t.Fatal(state)
	}
}

func TestMergeRejectsExpiredPreview(t *testing.T) {
	a := testApp(t)
	path := repo(t, "preview", "master")
	id := register(t, a, "App", path)
	testGit(t, path, "branch", "source")
	head := testGit(t, path, "rev-parse", "HEAD")
	commitFile(t, path, "changed.txt", "changed")
	if code, _ := gitAction(t, a, id, GitAction{Action: "merge", Path: path, Source: "refs/heads/source", ExpectedHead: head, SourceCommit: head}); code != 409 {
		t.Fatal("expired preview accepted")
	}
}

func TestWorktreeCanSwitchToRemoteAndCreateFromItsOwnHead(t *testing.T) {
	a := testApp(t)
	_, _, clone := remoteClone(t)
	id := register(t, a, "App", clone)
	gitAction(t, a, id, GitAction{Action: "fetch", Remote: "origin"})
	gitAction(t, a, id, GitAction{Action: "create_branch", Name: "master", Source: "refs/remotes/origin/master", Track: true})
	q := createWorktree(t, a, id, "tracked-worktree")
	path := q.Path
	if code, raw := gitAction(t, a, id, GitAction{Action: "switch", Path: path, Source: "refs/remotes/origin/master", Name: "tracked/master"}); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if got := testGit(t, path, "rev-parse", "--abbrev-ref", "@{upstream}"); got != "origin/master" {
		t.Fatal(got)
	}
	commitFile(t, path, "local.txt", "selected worktree head")
	if code, raw := gitAction(t, a, id, GitAction{Action: "create_branch", Path: path, Source: "HEAD", Name: "from-worktree-head"}); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if testGit(t, path, "rev-parse", "from-worktree-head") != testGit(t, path, "rev-parse", "HEAD") {
		t.Fatal("used registered directory HEAD instead of worktree HEAD")
	}
	if testGit(t, clone, "branch", "--show-current") != "codex/wsl-startup" {
		t.Fatal("changed original checkout")
	}
}

func TestSharedDirectorySwitchRequiresAcknowledgement(t *testing.T) {
	a := testApp(t)
	path := repo(t, "shared", "master")
	id := register(t, a, "App", path)
	q := createWorktree(t, a, id, "shared-worktree")
	path = q.Path
	for _, sessionID := range []string{"a", "b"} {
		bindTestSession(t, a, sessionID, id, path)
	}
	testGit(t, path, "branch", "next")
	in := GitAction{Action: "switch", Path: path, Source: "refs/heads/next"}
	if code, _ := gitAction(t, a, id, in); code != 409 {
		t.Fatal("shared switch had no acknowledgement")
	}
	in.AllowShared = true
	if code, raw := gitAction(t, a, id, in); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
}

func bindTestSession(t *testing.T, a *App, sessionID, projectID, dir string) model.SessionProjectBinding {
	t.Helper()
	if _, err := a.Execution.Store.DB.Exec(`INSERT INTO sessions(id,name,cwd,created_at,updated_at,source,last_synced_at) VALUES(?,?,?,1,1,'test',1)`, sessionID, sessionID, dir); err != nil {
		t.Fatal(err)
	}
	binding, err := a.Execution.Store.BindSessionDirectory(model.SessionProjectBinding{
		SessionID: sessionID, ProjectID: projectID, Directory: dir, Role: "primary", Access: "write",
	})
	if err != nil {
		t.Fatal(err)
	}
	return binding
}
