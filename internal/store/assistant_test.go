package store

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
)

func TestAssistantRestartMetadataAndHistory(t *testing.T) {
	directory := t.TempDir()
	db, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.CreateAssistant("assistant"); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 55; i++ {
		id := fmt.Sprint(i)
		if _, _, err := db.BeginAssistantRun("assistant", id, "input"); err != nil {
			t.Fatal(err)
		}
		if err := db.FinishAssistantRun("assistant", id, "completed", "", "reply"); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := db.BeginAssistantRun("assistant", "unfinished", "persist me"); err != nil {
		t.Fatal(err)
	}
	db.DB.Close()
	db, err = Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer db.DB.Close()
	run, err := db.AssistantRun("assistant", "unfinished")
	if err != nil || run.Status != "interrupted" {
		t.Fatalf("restart %+v %v", run, err)
	}
	newest, err := db.AssistantMessages("assistant", 0, 50)
	if err != nil || len(newest) != 50 {
		t.Fatalf("newest %d %v", len(newest), err)
	}
	earlier, err := db.AssistantMessages("assistant", newest[0].ID, 100)
	if err != nil || len(earlier) != 61 {
		t.Fatalf("earlier %d %v", len(earlier), err)
	}
	snapshot, err := ExportMetadata(context.Background(), filepath.Join(directory, "worktree-hub.db"))
	if err != nil {
		t.Fatal(err)
	}
	target, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer target.DB.Close()
	if err := target.ImportMetadata(snapshot); err != nil {
		t.Fatal(err)
	}
	messages, err := target.AssistantMessages("assistant", 0, 200)
	if err != nil || len(messages) != 111 {
		t.Fatalf("import %d %v", len(messages), err)
	}
	if err := target.ImportMetadata(snapshot); err == nil {
		t.Fatal("import overwrote existing assistant data")
	}
	// Simulate an older export without assistant tables.
	legacy, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer legacy.DB.Close()
	if err := legacy.ImportMetadata(MetadataSnapshot{Tables: map[string][][]any{}}); err != nil {
		t.Fatal(err)
	}
}
