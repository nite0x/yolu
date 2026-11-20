package agy

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"worktree-hub/internal/acp"
)

type stubACPClient struct {
	callFn func(method string, params any, result any) error
	events chan acp.Message
}

func (s *stubACPClient) Call(_ context.Context, method string, params any, result any) error {
	if s.callFn != nil {
		return s.callFn(method, params, result)
	}
	return nil
}
func (s *stubACPClient) Notify(string, any) error                      { return nil }
func (s *stubACPClient) Reply(json.RawMessage, any) error              { return nil }
func (s *stubACPClient) ReplyError(json.RawMessage, int, string) error { return nil }
func (s *stubACPClient) Events() <-chan acp.Message                    { return s.events }
func (s *stubACPClient) Close()                                        {}

func TestCatalogFromSetupSupportsConfigOptionsAndLegacyFields(t *testing.T) {
	setup := acp.SessionSetupResult{
		SessionID: "sess-1",
		ConfigOptions: []acp.ConfigOption{
			{
				ID:           "model",
				Category:     "model",
				CurrentValue: "gemini-3-pro",
				Options:      json.RawMessage(`[{"value":"gemini-3-pro","name":"Gemini 3 Pro"},{"value":"gemini-3-flash","name":"Gemini 3 Flash"}]`),
			},
			{
				ID:           "thought_level",
				Category:     "thought_level",
				CurrentValue: "high",
				Options:      json.RawMessage(`[{"value":"low","name":"Low"},{"value":"high","name":"High"}]`),
			},
			{
				ID:           "mode",
				Category:     "mode",
				CurrentValue: "plan",
				Options:      json.RawMessage(`[{"value":"default","name":"Default"},{"value":"plan","name":"Plan"}]`),
			},
		},
	}
	cat := CatalogFromSetup(setup)
	if len(cat.Models) != 2 || cat.Models[0].Model != "gemini-3-pro" || !cat.Models[0].Default {
		t.Fatalf("unexpected models: %+v", cat.Models)
	}
	if len(cat.Models[0].Efforts) != 2 || cat.Models[0].DefaultEffort != "high" {
		t.Fatalf("unexpected efforts: %+v", cat.Models[0])
	}
	if len(cat.Modes) != 2 || cat.CurrentMode != "plan" {
		t.Fatalf("unexpected modes: %+v", cat.Modes)
	}

	legacy := acp.SessionSetupResult{
		SessionID: "sess-2",
		Models: &acp.ModelsState{
			CurrentModelID:  "m1",
			AvailableModels: []acp.ModelInfo{{ModelID: "m1", Name: "Model One"}},
		},
		Modes: &acp.ModesState{
			CurrentModeID:  "auto",
			AvailableModes: []acp.ModeInfo{{ID: "auto", Name: "Auto"}},
		},
	}
	legacyCat := CatalogFromSetup(legacy)
	if len(legacyCat.Models) != 1 || legacyCat.Models[0].Model != "m1" || !legacyCat.Models[0].Default {
		t.Fatalf("unexpected legacy models: %+v", legacyCat.Models)
	}
	if len(legacyCat.Modes) != 1 || legacyCat.Modes[0] != "auto" {
		t.Fatalf("unexpected legacy modes: %+v", legacyCat.Modes)
	}
}

func TestACPFlagsForPermission(t *testing.T) {
	flags := ACPFlagsForPermission("full", []string{"/repo/a", "/repo/b"})
	if len(flags) != 5 || flags[0] != "--dangerously-skip-permissions" || flags[1] != "--add-dir" || flags[2] != "/repo/a" {
		t.Fatalf("unexpected flags: %v", flags)
	}
	askFlags := ACPFlagsForPermission("ask", nil)
	if len(askFlags) != 1 || askFlags[0] != "--sandbox" {
		t.Fatalf("unexpected ask flags: %v", askFlags)
	}
}

func TestDiagnoseReportsAuthRequiredAsWarning(t *testing.T) {
	t.Setenv("AGY_CLI_PATH", "/bin/sh")
	report := Diagnose(context.Background(), func(context.Context, ...string) (acp.Client, acp.InitializeResult, error) {
		return &stubACPClient{
			events: make(chan acp.Message),
			callFn: func(method string, _ any, _ any) error {
				if method == "session/list" {
					return &acp.RPCError{Code: -32000, Message: "Authentication required"}
				}
				return errors.New("unexpected")
			},
		}, acp.InitializeResult{AgentInfo: acp.AgentInfo{Name: "Antigravity ACP Server", Version: "1.5.12"}}, nil
	})
	if report.Status != "warning" || report.Version != "1.5.12" || len(report.Checks) != 3 || report.Checks[2].Status != "warning" {
		t.Fatalf("unexpected report: %+v", report)
	}
}
