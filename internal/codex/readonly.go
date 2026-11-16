package codex

import (
	"context"
	"encoding/json"
)

// ReadOnlyThreadParams shares the assistant and title worker's tool isolation.
// Disable configured MCP servers individually because config layers merge maps.
func ReadOnlyThreadParams(ctx context.Context, client LiveClient, cwd, instructions string) (map[string]any, error) {
	var settings struct {
		Config struct {
			MCPServers map[string]json.RawMessage `json:"mcp_servers"`
		} `json:"config"`
	}
	if err := client.Call(ctx, "config/read", map[string]any{"cwd": cwd, "includeLayers": false}, &settings); err != nil {
		return nil, err
	}
	servers := map[string]any{}
	for name := range settings.Config.MCPServers {
		servers[name] = map[string]any{"enabled": false}
	}
	return map[string]any{
		"cwd": cwd, "ephemeral": true, "sandbox": "read-only", "approvalPolicy": "never", "baseInstructions": instructions,
		"config": map[string]any{
			"features.shell_tool": false, "features.hooks": false, "features.plugins": false,
			"features.multi_agent": false, "features.multi_agent_v2": false, "features.enable_fanout": false,
			"features.apps": false, "mcp_servers": servers, "web_search": "disabled", "thread_unload_delay_secs": 0,
		},
	}, nil
}
