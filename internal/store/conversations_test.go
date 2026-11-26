package store

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"worktree-hub/internal/model"
)

func TestSaveCreatedSessionPublishesRecordAndReceiptTogether(t *testing.T) {
	ctx := context.Background()
	data := t.TempDir()
	s, err := Open(data)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = s.Close() }()
	cwd := t.TempDir()
	record := model.Session{ID: "session", Cwd: cwd, Permission: "ask"}
	if err := s.ReserveCreation(ctx, "request", "fingerprint"); err != nil {
		t.Fatal(err)
	}
	// A foreign-key violation prevents local publication after the provider
	// has created the thread. The original pending receipt must survive.
	bad := model.SessionProjectBinding{ProjectID: "missing", Directory: cwd, Role: "primary", Access: "write"}
	if err := s.SaveCreatedSession(ctx, "request", record, []model.SessionProjectBinding{bad}); err == nil {
		t.Fatal("published an invalid session")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(data)
	if err != nil {
		t.Fatal(err)
	}
	id, fp, err := s.CreationReceipt(ctx, "request")
	if err != nil || id != "" || fp != "fingerprint" {
		t.Fatalf("receipt = %q, %q, %v", id, fp, err)
	}
	if _, err := s.Session(record.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("partial index entry survived: %v", err)
	}
	if err := s.SaveCreatedSession(ctx, "request", record, []model.SessionProjectBinding{}); err != nil {
		t.Fatal(err)
	}
	managed, err := s.SessionBindingsManaged(record.ID)
	if err != nil || !managed {
		t.Fatalf("empty managed binding set: %v %v", managed, err)
	}
	id, _, err = s.CreationReceipt(ctx, "request")
	if err != nil || id != record.ID {
		t.Fatalf("receipt = %q, %v", id, err)
	}
}
