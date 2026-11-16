package task

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"worktree-hub/internal/store"
)

func roundTripReview[T any](t *testing.T, value T) T {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var restored T
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	return restored
}

func TestReviewedWorkspaceAllMemberModesAndIdempotentExecution(t *testing.T) {
	for _, mode := range []string{"new", "existing", "project", "worktree"} {
		t.Run(mode, func(t *testing.T) {
			a := testApp(t)
			a.LockRepositories = a.Projects.LockRepositories
			path := repo(t, "reviewed", "main")
			id := register(t, a, "Reviewed", path)
			selection := MemberSelection{ProjectID: id, Mode: mode}
			switch mode {
			case "existing":
				testGit(t, path, "branch", "selected")
				selection.Branch = "selected"
			case "worktree":
				selection.Path = filepath.Join(t.TempDir(), "external")
				testGit(t, path, "worktree", "add", "-b", "external", "--", selection.Path, "main")
			}
			review, err := a.ReviewWorkspace(context.Background(), CreateRequirement{Name: "Reviewed workspace", Slug: "reviewed", Members: []MemberSelection{selection}})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(review.Requirement.Path); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("review wrote a workspace: %v", err)
			}
			review = roundTripReview(t, review)
			q, err := a.ExecuteWorkspace(context.Background(), review)
			if err != nil || q.State != "ready" || q.ID != review.Requirement.ID {
				t.Fatalf("execute: %+v %v", q, err)
			}
			repeated, err := a.ExecuteWorkspace(context.Background(), review)
			if err != nil || repeated.ID != q.ID || len(repeated.Members) != 1 {
				t.Fatalf("repeat: %+v %v", repeated, err)
			}
			if q.HasWorkspace != (mode == "new" || mode == "existing") {
				t.Fatalf("workspace materialization changed for %s", mode)
			}
			if mode == "project" || mode == "worktree" {
				if _, err := os.Stat(q.Path); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("reuse materialized a directory: %v", err)
				}
			}
			var count int
			if err := a.Workspace.Store.DB.QueryRow(`SELECT count(*) FROM requirements`).Scan(&count); err != nil || count != 1 {
				t.Fatalf("duplicate records: %d %v", count, err)
			}
		})
	}
}

func TestReviewedWorkspaceRejectsChangedSourceBeforeAnyWrite(t *testing.T) {
	a := testApp(t)
	path := repo(t, "source", "main")
	id := register(t, a, "Source", path)
	review, err := a.ReviewWorkspace(context.Background(), CreateRequirement{Name: "Stale", Slug: "stale-source", ProjectIDs: []string{id}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "changed.txt"), []byte("new baseline"), 0644); err != nil {
		t.Fatal(err)
	}
	testGit(t, path, "add", ".")
	testGit(t, path, "commit", "-m", "Change source after review")
	if _, err := a.ExecuteWorkspace(context.Background(), review); err == nil {
		t.Fatal("accepted a changed source")
	}
	if _, err := os.Stat(review.Requirement.Path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("stale review created a directory")
	}
	if _, found, err := a.ReconcileWorkspace(context.Background(), review); err != nil || found {
		t.Fatalf("stale review saved metadata: %v %v", found, err)
	}
}

func TestReviewedWorkspaceReconcilesPartialResultsAfterRestartWithoutRetrying(t *testing.T) {
	a := testApp(t)
	first := register(t, a, "First", repo(t, "first", "main"))
	secondPath := repo(t, "second", "main")
	second := register(t, a, "Second", secondPath)
	review, err := a.ReviewWorkspace(context.Background(), CreateRequirement{Name: "Partial", Slug: "reviewed-partial", ProjectIDs: []string{first, second}})
	if err != nil {
		t.Fatal(err)
	}
	hook := filepath.Join(secondPath, ".git", "hooks", "post-checkout")
	if err := os.WriteFile(hook, []byte("#!/bin/sh\nexit 1\n"), 0755); err != nil {
		t.Fatal(err)
	}
	q, err := a.ExecuteWorkspace(context.Background(), review)
	if err != nil || q.State != "partial" || q.Members[0].State != "ready" || q.Members[1].State != "failed" {
		t.Fatalf("partial result: %+v %v", q, err)
	}
	if err := os.Remove(hook); err != nil {
		t.Fatal(err)
	}
	if err := a.Workspace.Store.DB.Close(); err != nil {
		t.Fatal(err)
	}
	a.Workspace.Store, err = store.Open(a.Workspace.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	actual, found, err := a.ReconcileWorkspace(context.Background(), roundTripReview(t, review))
	if err != nil || !found || actual.State != "partial" {
		t.Fatalf("reconcile: %+v %v %v", actual, found, err)
	}
	repeated, err := a.ExecuteWorkspace(context.Background(), review)
	if err != nil || repeated.State != "partial" {
		t.Fatalf("repeat silently retried a failed member: %+v %v", repeated, err)
	}
}

func TestReviewedAttachmentPreservesNotesAndReconciles(t *testing.T) {
	a := testApp(t)
	a.LockRepositories = a.Projects.LockRepositories
	first := register(t, a, "First", repo(t, "first", "main"))
	q, err := a.CreateWorkspace(context.Background(), CreateRequirement{Name: "Attach", Slug: "reviewed-attach", ProjectIDs: []string{first}})
	if err != nil {
		t.Fatal(err)
	}
	second := register(t, a, "Second", repo(t, "second", "main"))
	third := register(t, a, "Third", repo(t, "third", "main"))
	in := AttachProjectsInput{Members: []MemberSelection{{ProjectID: second, Mode: "new"}, {ProjectID: third, Mode: "project"}}}
	review, err := a.ReviewAttachProjects(context.Background(), q.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	review = roundTripReview(t, review)
	if err := os.WriteFile(filepath.Join(q.Path, "BRIEF.md"), []byte("Keep my notes\n"), 0644); err != nil {
		t.Fatal(err)
	}
	result, err := a.ExecuteAttachProjects(context.Background(), review)
	if err != nil || result.State != "ready" || len(result.Members) != 3 {
		t.Fatalf("attach: %+v %v", result, err)
	}
	brief, err := os.ReadFile(filepath.Join(q.Path, "BRIEF.md"))
	if err != nil || len(brief) < len("Keep my notes\n") || string(brief[:len("Keep my notes\n")]) != "Keep my notes\n" {
		t.Fatalf("notes lost: %s %v", brief, err)
	}
	if _, found, err := a.ReconcileAttachProjects(context.Background(), review); err != nil || !found {
		t.Fatalf("reconcile attachment: %v %v", found, err)
	}
	if repeated, err := a.ExecuteAttachProjects(context.Background(), review); err != nil || len(repeated.Members) != 3 {
		t.Fatalf("repeat attachment: %+v %v", repeated, err)
	}
}

func TestReviewedAttachmentRejectsChangedWorkspace(t *testing.T) {
	a := testApp(t)
	first := register(t, a, "First", repo(t, "first", "main"))
	q, err := a.CreateWorkspace(context.Background(), CreateRequirement{Name: "Attach", Slug: "stale-attach", Members: []MemberSelection{{ProjectID: first, Mode: "project"}}})
	if err != nil {
		t.Fatal(err)
	}
	second := register(t, a, "Second", repo(t, "second", "main"))
	review, err := a.ReviewAttachProjects(context.Background(), q.ID, AttachProjectsInput{ProjectIDs: []string{second}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Workspace.Store.DB.Exec(`UPDATE requirements SET description='changed after review' WHERE id=?`, q.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ExecuteAttachProjects(context.Background(), review); err == nil {
		t.Fatal("accepted changed workspace metadata")
	}
	actual, err := a.Workspace.Store.Requirement(q.ID)
	if err != nil || len(actual.Members) != 1 {
		t.Fatalf("stale attachment changed metadata: %+v %v", actual, err)
	}
}

func TestReviewedExistingBranchReportsDriftDuringCreation(t *testing.T) {
	a := testApp(t)
	path := repo(t, "existing", "main")
	id := register(t, a, "Existing", path)
	testGit(t, path, "branch", "reviewed-existing")
	review, err := a.ReviewWorkspace(context.Background(), CreateRequirement{
		Name: "Reviewed existing branch", Slug: "drift-existing",
		Members: []MemberSelection{{ProjectID: id, Mode: "existing", Branch: "reviewed-existing"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Simulate an execution-side change after the final branch preflight.
	hook := filepath.Join(path, ".git", "hooks", "post-checkout")
	if err := os.WriteFile(hook, []byte("#!/bin/sh\ngit commit --allow-empty -m 'Changed during checkout'\n"), 0755); err != nil {
		t.Fatal(err)
	}
	q, err := a.ExecuteWorkspace(context.Background(), review)
	if err != nil || q.State != "partial" || len(q.Members) != 1 || q.Members[0].State != "failed" || q.Members[0].Error == "" {
		t.Fatalf("drift was reported as success: %+v %v", q, err)
	}
	if _, err := os.Stat(q.Members[0].Path); err != nil {
		t.Fatalf("actual partial worktree was hidden: %v", err)
	}
}

func TestReviewedWorkspaceConcurrentRetriesShareDomainLocks(t *testing.T) {
	a := testApp(t)
	a.LockRepositories = a.Projects.LockRepositories
	id := register(t, a, "Concurrent", repo(t, "concurrent", "main"))
	review, err := a.ReviewWorkspace(context.Background(), CreateRequirement{Name: "Concurrent", Slug: "reviewed-concurrent", ProjectIDs: []string{id}})
	if err != nil {
		t.Fatal(err)
	}
	errors := make(chan error, 2)
	for range 2 {
		go func() {
			q, err := a.ExecuteWorkspace(context.Background(), review)
			if err == nil && (q.ID != review.Requirement.ID || q.State != "ready") {
				err = fmt.Errorf("unexpected retry result: %+v", q)
			}
			errors <- err
		}()
	}
	for range 2 {
		if err := <-errors; err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := a.Workspace.Store.DB.QueryRow(`SELECT count(*) FROM requirements`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("concurrent duplicate resources: %d %v", count, err)
	}
}
