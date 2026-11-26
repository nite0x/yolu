package cursor

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"worktree-hub/internal/acp"
)

type optionClient struct{ calls []string }

func (c *optionClient) Call(_ context.Context, method string, _ any, out any) error {
	c.calls = append(c.calls, method)
	if method != "session/new" {
		return fmt.Errorf("unexpected RPC: %s", method)
	}
	data := `{"sessionId":"options","configOptions":[{"id":"model","category":"model","currentValue":"default[]","options":[{"value":"default[]","name":"Auto"},{"value":"composer-2.5[fast=true]","name":"Composer 2.5"}]}],"modes":{"currentModeId":"agent","availableModes":[{"id":"agent"},{"id":"ask"}]}}`
	return json.Unmarshal([]byte(data), out)
}
func (*optionClient) Notify(string, any) error                      { return nil }
func (*optionClient) Reply(json.RawMessage, any) error              { return nil }
func (*optionClient) ReplyError(json.RawMessage, int, string) error { return nil }
func (*optionClient) Events() <-chan acp.Message                    { return nil }
func (*optionClient) Close()                                        {}
func TestDiscoverCatalogRetainsACPModelIDsWithoutPrompt(t *testing.T) {
	client := &optionClient{}
	cat, err := DiscoverCatalog(context.Background(), func(_ context.Context, flags ...string) (acp.Client, acp.InitializeResult, error) {
		if len(flags) != 2 || flags[0] != "--sandbox" || flags[1] != "enabled" {
			t.Fatalf("unsafe discovery flags: %v", flags)
		}
		return client, acp.InitializeResult{}, nil
	})
	if err != nil || cat.CurrentModel != "default[]" || len(cat.Models) != 2 || cat.Models[1].Model != "composer-2.5[fast=true]" || len(client.calls) != 1 {
		t.Fatalf("catalog: %+v %v calls=%v", cat, err, client.calls)
	}
}

func TestOptionProbeDirectoryIsNotAUserConversation(t *testing.T) {
	probe := filepath.Join(os.TempDir(), "yolu-cursor-options-regression")
	if !IsOptionsDirectory(probe) {
		t.Fatal("private options directory was exposed as a conversation")
	}
	dir := t.TempDir()
	if IsOptionsDirectory(filepath.Join(dir, "yolu-cursor-options-user")) {
		t.Fatal("prefix alone hid a user conversation")
	}
	if IsOptionsDirectory(dir) {
		t.Fatal("user directory treated as an options probe")
	}
}
