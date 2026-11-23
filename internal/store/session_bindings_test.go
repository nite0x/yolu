package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"worktree-hub/internal/model"
)

func TestSessionBindingUpdatesPreserveIdentityAndIndependentScopes(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	base := t.TempDir()
	first, second := filepath.Join(base, "first"), filepath.Join(base, "second")
	for _, id := range []string{"a", "b"} {
		if err := s.SaveSession(model.Session{ID: id, Cwd: first}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.DB.Exec(`INSERT INTO projects VALUES('p','Project',?,?,'project','now')`, first, filepath.Join(first, ".git")); err != nil {
		t.Fatal(err)
	}
	initial := model.SessionProjectBinding{ProjectID: "p", Directory: first, Role: model.SessionBindingPrimary, Access: model.SessionBindingWrite}
	for _, id := range []string{"a", "b"} {
		if err := s.InsertSessionBindings(id, []model.SessionProjectBinding{initial}); err != nil {
			t.Fatal(err)
		}
	}
	binding, err := s.BindSessionDirectory(model.SessionProjectBinding{
		SessionID: "a", ProjectID: "p", Directory: second, Role: model.SessionBindingPrimary, Access: model.SessionBindingRead,
	})
	if err != nil {
		t.Fatal(err)
	}
	binding.Access = model.SessionBindingWrite
	updated, err := s.BindSessionDirectory(binding)
	if err != nil || updated.CreatedAt != binding.CreatedAt || updated.ID != binding.ID {
		t.Fatalf("binding identity changed: %+v %v", updated, err)
	}
	a, err := s.SessionBindings("a")
	if err != nil || len(a) != 2 || a[0].Directory != second || a[0].Access != model.SessionBindingWrite || a[1].Role != model.SessionBindingAdditional {
		t.Fatalf("primary update: %+v %v", a, err)
	}
	b, err := s.SessionBindings("b")
	if err != nil || len(b) != 1 || b[0].Directory != first || b[0].Role != model.SessionBindingPrimary {
		t.Fatalf("other conversation changed: %+v %v", b, err)
	}
	resolved, err := s.BindingsWithinDirectory(base)
	if err != nil || len(resolved) != 3 {
		t.Fatalf("directory references: %+v %v", resolved, err)
	}
	if err := s.DeleteSessionBinding("b", binding.ID); err == nil {
		t.Fatal("another conversation's binding was removed")
	}
	if err := s.DeleteSessionBinding("a", binding.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`DELETE FROM projects WHERE id='p'`); err != nil {
		t.Fatal(err)
	}
	a, err = s.SessionBindings("a")
	if err != nil || len(a) != 1 || a[0].ProjectID != "" || a[0].Directory != first {
		t.Fatalf("detached project changed directory association: %+v %v", a, err)
	}
	if _, err := s.DB.Exec(`DELETE FROM sessions WHERE id='b'`); err != nil {
		t.Fatal(err)
	}
	b, err = s.SessionBindings("b")
	if err != nil || len(b) != 0 {
		t.Fatalf("orphaned binding: %+v %v", b, err)
	}
}

func TestSessionBindingInsertRollsBackAndConcurrentDuplicateIsRejected(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	dir := t.TempDir()
	if err := s.SaveSession(model.Session{ID: "a", Cwd: dir}); err != nil {
		t.Fatal(err)
	}
	binding := model.SessionProjectBinding{SessionID: "a", Directory: dir, Role: model.SessionBindingPrimary, Access: model.SessionBindingWrite}
	bad := model.SessionProjectBinding{ProjectID: "unknown", Directory: filepath.Join(dir, "unregistered"), Role: model.SessionBindingAdditional, Access: model.SessionBindingRead}
	if err := s.SaveSessionWithBindings(model.Session{ID: "unpublished", Cwd: dir}, []model.SessionProjectBinding{binding, bad}); err == nil {
		t.Fatal("invalid initial bindings accepted")
	}
	if _, err := s.Session("unpublished"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("failed initial bindings published a conversation: %v", err)
	}
	if err := s.InsertSessionBindings("a", []model.SessionProjectBinding{binding, bad}); err == nil {
		t.Fatal("invalid project accepted")
	}
	a, err := s.SessionBindings("a")
	if err != nil || len(a) != 0 {
		t.Fatalf("partial batch: %+v %v", a, err)
	}
	if managed, err := s.SessionBindingsManaged("a"); err != nil || managed {
		t.Fatalf("failed batch changed managed marker: %v %v", managed, err)
	}
	if err := s.InsertSessionBindings("a", nil); err != nil {
		t.Fatal(err)
	}
	const requests = 8
	results := make(chan error, requests)
	var wg sync.WaitGroup
	for range requests {
		wg.Go(func() {
			_, err := s.BindSessionDirectory(binding)
			results <- err
		})
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else if !errors.Is(err, ErrSessionBindingDuplicate) {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("%d duplicate requests succeeded", success)
	}
	if managed, err := s.SessionBindingsManaged("a"); err != nil || !managed {
		t.Fatalf("managed marker: %v %v", managed, err)
	}
}
