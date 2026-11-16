package project

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestReviewedRegistrationIsCanonicalAndIdempotent(t *testing.T) {
	a := testApp(t)
	path := repo(t, "registered", "main")
	if err := os.Mkdir(filepath.Join(path, "subdirectory"), 0755); err != nil {
		t.Fatal(err)
	}
	review, err := a.ReviewRegistration(context.Background(), "  Registered  ", filepath.Join(path, "subdirectory"))
	if err != nil {
		t.Fatal(err)
	}
	if review.Project.Name != "Registered" || review.Project.Path != path {
		t.Fatalf("non-canonical review: %+v", review)
	}
	var count int
	if err := a.Workspace.Store.DB.QueryRow(`SELECT count(*) FROM projects`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("review persisted registration: %d %v", count, err)
	}
	data, err := json.Marshal(review)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &review); err != nil {
		t.Fatal(err)
	}
	p, err := a.ExecuteRegistration(context.Background(), review)
	if err != nil || p.ID != review.Project.ID {
		t.Fatalf("register: %+v %v", p, err)
	}
	repeated, err := a.ExecuteRegistration(context.Background(), review)
	if err != nil || repeated.ID != p.ID {
		t.Fatalf("repeat: %+v %v", repeated, err)
	}
	if _, found, err := a.ReconcileRegistration(context.Background(), review); err != nil || !found {
		t.Fatalf("reconcile: %v %v", found, err)
	}
	if _, err := a.RegisterProject(context.Background(), "Other name", path); err == nil {
		t.Fatal("duplicate common Git directory accepted")
	}
}

func TestReviewedRegistrationRejectsChangedRepository(t *testing.T) {
	a := testApp(t)
	path := repo(t, "registered", "main")
	review, err := a.ReviewRegistration(context.Background(), "Registered", path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(path, path+"-moved"); err != nil {
		t.Fatal(err)
	}
	other := repo(t, "replacement", "main")
	if err := os.Symlink(other, path); err != nil {
		t.Fatal(err)
	}
	if _, err := a.ExecuteRegistration(context.Background(), review); err == nil {
		t.Fatal("accepted replacement repository")
	}
	if _, found, err := a.ReconcileRegistration(context.Background(), review); err != nil || found {
		t.Fatalf("stale registration persisted: %v %v", found, err)
	}
}
