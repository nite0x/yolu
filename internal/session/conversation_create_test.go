package session

import (
	"context"
	"errors"
	"testing"
)

func TestCreateSessionUseCasePreservesReceiptsWithoutHTTP(t *testing.T) {
	a, q, c, _ := chatFixture(t)
	input := CreateSessionInput{Text: "Inspect the directory", RequestID: "direct-use-case", Project: q.ProjectID, Cwd: q.Path}
	first, err := a.CreateSession(context.Background(), input)
	if err != nil || first.Status != 202 {
		t.Fatalf("%+v %v", first, err)
	}
	second, err := a.CreateSession(context.Background(), input)
	if err != nil || second.Status != 200 || first.SessionID != second.SessionID {
		t.Fatalf("%+v %v", second, err)
	}
	input.Text = "A different request"
	_, err = a.CreateSession(context.Background(), input)
	var failure *creationError
	if !errors.As(err, &failure) || failure.code != "creation_mismatch" {
		t.Fatalf("%v", err)
	}
	c.event("turn/completed", map[string]any{"turn": map[string]any{"id": "turn", "status": "completed"}})
}
