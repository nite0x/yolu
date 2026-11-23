package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestMCPSettingsInstallsWithCurrentProfileAndPreservesExistingEntries(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture uses POSIX CLI shims")
	}
	a := testApp(t)
	dir := t.TempDir()
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	t.Setenv("YOLU_TEST_MCP_DIR", dir)
	launcher, err := currentMCPLaunch(a.Execution.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	config := map[string]any{"type": "stdio", "command": launcher.Command, "args": []string{"--mcp", "--data", launcher.DataDir}}
	writeMCPFixture(t, filepath.Join(dir, "codex-installed.json"), []any{map[string]any{"name": "yolu", "enabled": true, "transport": config}})
	writeMCPFixture(t, filepath.Join(dir, "claude-installed.json"), map[string]any{"mcpServers": map[string]any{"yolu": config}})
	for name, script := range map[string]string{
		"codex": `#!/bin/sh
case "$2" in
list) if [ -f "$YOLU_TEST_MCP_DIR/codex.json" ]; then cat "$YOLU_TEST_MCP_DIR/codex.json"; else printf '[]\n'; fi ;;
add) printf '%s\n' "$@" >> "$YOLU_TEST_MCP_DIR/codex.args"; cp "$YOLU_TEST_MCP_DIR/codex-installed.json" "$YOLU_TEST_MCP_DIR/codex.json" ;;
*) exit 1 ;;
esac
`,
		"claude": `#!/bin/sh
if [ "$2" != add ]; then exit 1; fi
printf '%s\n' "$@" >> "$YOLU_TEST_MCP_DIR/claude.args"
cp "$YOLU_TEST_MCP_DIR/claude-installed.json" "$CLAUDE_CONFIG_DIR/.claude.json"
`,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
	}
	code, raw := call(t, a, http.MethodGet, mcpSettingsPath, nil)
	var listing mcpAgentSettings
	if err := json.Unmarshal(raw, &listing); err != nil || code != http.StatusOK || !listing.CanManage || len(listing.Agents) != 2 {
		t.Fatalf("unexpected agent listing: %d %s %v", code, raw, err)
	}
	for _, agent := range listing.Agents {
		if agent.Status != "available" {
			t.Fatalf("unexpected initial agent status: %+v", agent)
		}
		for range 2 {
			code, raw := call(t, a, http.MethodPost, mcpSettingsPath, map[string]string{"agent": agent.Agent})
			var result mcpInstallStatus
			if err := json.Unmarshal(raw, &result); err != nil || code != http.StatusOK || result.Agent != agent.Agent || result.Status != "installed" {
				t.Fatalf("unexpected installation result: %d %s %v", code, raw, err)
			}
		}
		want := []string{"mcp", "add"}
		if agent.Agent == "claude" {
			want = append(want, "--scope", "user", "--transport", "stdio")
		}
		want = append(want, "yolu", "--", launcher.Command, "--mcp", "--data", launcher.DataDir)
		args, err := os.ReadFile(filepath.Join(dir, agent.Agent+".args"))
		if err != nil || string(args) != strings.Join(want, "\n")+"\n" {
			t.Fatalf("expected one registration with separate args: %q %v", args, err)
		}
	}
	conflict := []any{map[string]any{"name": "yolu", "transport": map[string]string{"type": "streamable_http", "url": "https://example.invalid/mcp"}}}
	writeMCPFixture(t, filepath.Join(dir, "codex.json"), conflict)
	code, raw = call(t, a, http.MethodPost, mcpSettingsPath, map[string]string{"agent": "codex"})
	var result mcpInstallStatus
	if err := json.Unmarshal(raw, &result); err != nil || code != http.StatusOK || result.Status != "conflict" {
		t.Fatalf("same-name configuration was not preserved: %d %s %v", code, raw, err)
	}
	if args, err := os.ReadFile(filepath.Join(dir, "codex.args")); err != nil || strings.Count(string(args), "\nadd\n") != 1 {
		t.Fatalf("a second write was attempted: %q %v", args, err)
	}
}

func TestMCPSettingsRequiresHostAndKnownAgent(t *testing.T) {
	a := testApp(t)
	if code, _ := call(t, a, http.MethodPost, mcpSettingsPath, map[string]string{"agent": "unknown"}); code != http.StatusBadRequest {
		t.Fatalf("unknown agent accepted: %d", code)
	}
	if err := a.browser.configure(context.Background(), true, freeBrowserPort(t), false); err != nil {
		t.Fatal(err)
	}
	cookie := pairBrowser(t, a)
	read := browserRequest(t, a, http.MethodGet, mcpSettingsPath, "", cookie, true)
	var listing mcpAgentSettings
	if err := json.NewDecoder(read.Body).Decode(&listing); err != nil || read.StatusCode != http.StatusOK || listing.CanManage || len(listing.Agents) != 0 {
		t.Fatalf("browser received host settings: %d %+v %v", read.StatusCode, listing, err)
	}
	write := browserRequest(t, a, http.MethodPost, mcpSettingsPath, `{"agent":"codex"}`, cookie, true)
	if write.StatusCode != http.StatusForbidden {
		t.Fatalf("LAN browser was allowed to install MCP: %d", write.StatusCode)
	}
}

func writeMCPFixture(t *testing.T, path string, value any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
}
