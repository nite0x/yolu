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

func TestCreateCloudSessionUsesCloudValidationWithoutLocalResolution(t *testing.T) {
	a := testApp(t)
	for _, tc := range []struct {
		name   string
		input  CreateSessionInput
		status int
	}{
		{"cloud unavailable", CreateSessionInput{Text: "Inspect the cloud", RequestID: "cloud-unavailable", CloudEnvironment: "cloud-env"}, 503},
		{"local directory rejected", CreateSessionInput{Text: "Inspect the cloud", RequestID: "cloud-directory", CloudEnvironment: "cloud-env", Cwd: "/missing-local-directory"}, 400},
		{"other provider rejected", CreateSessionInput{Text: "Inspect the cloud", RequestID: "cloud-provider", CloudEnvironment: "cloud-env", Provider: "agy"}, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := a.CreateSession(context.Background(), tc.input)
			var failure *creationError
			if !errors.As(err, &failure) || failure.status != tc.status {
				t.Fatalf("creation error = %v, want status %d", err, tc.status)
			}
			var receipts int
			if err := a.Execution.Store.DB.QueryRow(`SELECT COUNT(*) FROM conversation_create_requests WHERE request_id=?`, tc.input.RequestID).Scan(&receipts); err != nil || receipts != 0 {
				t.Fatalf("rejected request receipts = %d, error = %v", receipts, err)
			}
		})
	}
}
