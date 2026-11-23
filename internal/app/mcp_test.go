package app

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPReadsProjectAndObservedGitStatus(t *testing.T) {
	a := testApp(t)
	projectID := register(t, a, "API", repo(t, "api", "master"))
	path := createWorktree(t, a, projectID, "agent-context").Path
	testGit(t, path, "switch", "-c", "agent-observed-branch")
	if err := os.WriteFile(filepath.Join(path, "untracked.txt"), []byte("uncommitted work"), 0600); err != nil {
		t.Fatal(err)
	}
	backend := httptest.NewServer(a.handler())
	t.Cleanup(backend.Close)
	if err := writeDesktopService(a.Execution.DataDir, a.desktopInfo(backend.URL)); err != nil {
		t.Fatal(err)
	}
	session := connectTestMCP(t, a.Execution.DataDir)
	tools, err := session.ListTools(t.Context(), nil)
	if err != nil || len(tools.Tools) != 2 {
		t.Fatalf("list MCP tools: %+v %v", tools, err)
	}
	for _, tool := range tools.Tools {
		if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
			t.Fatalf("tool lacks a read-only annotation: %+v", tool)
		}
	}

	var list listProjectsOutput
	callTestMCP(t, session, "list_projects", map[string]any{"query": "api"}, &list)
	if len(list.Projects) != 1 || list.Projects[0].ID != projectID || list.Projects[0].EnvironmentID != "local" {
		t.Fatalf("unexpected listing: %+v", list)
	}
	var detail getProjectOutput
	callTestMCP(t, session, "get_project", getProjectInput{ProjectID: projectID, EnvironmentID: "local", Refresh: true}, &detail)
	if detail.Project.ID != projectID || detail.StatusRefreshing || len(detail.Project.Worktrees) != 2 {
		t.Fatalf("unexpected detail: %+v", detail)
	}
	found := false
	for _, tree := range detail.Project.Worktrees {
		if tree.Path == path {
			found = tree.Branch == "agent-observed-branch" && tree.Dirty == 1 && tree.StatusUpdatedAt != ""
		}
	}
	if !found {
		t.Fatalf("wrong linked worktree status: %+v", detail.Project.Worktrees)
	}
	wrongEnv, err := session.CallTool(t.Context(), &mcp.CallToolParams{
		Name: "get_project", Arguments: getProjectInput{ProjectID: projectID, EnvironmentID: "other"},
	})
	if err != nil || !wrongEnv.IsError {
		t.Fatalf("unexpected result for wrong environment: %+v %v", wrongEnv, err)
	}

}

func TestMCPReportsStoppedBackendAsToolError(t *testing.T) {
	session := connectTestMCP(t, t.TempDir())
	result, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: "list_projects"})
	if err != nil || !result.IsError || len(result.Content) == 0 {
		t.Fatalf("unexpected result without backend: %+v %v", result, err)
	}
	message, ok := result.Content[0].(*mcp.TextContent)
	if !ok || !strings.Contains(message.Text, "same data directory") {
		t.Fatalf("unexpected tool error: %+v", result.Content[0])
	}
}

func connectTestMCP(t *testing.T, dataDir string) *mcp.ClientSession {
	t.Helper()
	client := desktopHTTPClient(5 * time.Second)
	t.Cleanup(client.CloseIdleConnections)
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	server := (&projectMCP{dataDir: dataDir, client: client}).server()
	serving, err := server.Connect(t.Context(), serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = serving.Close() })
	session, err := mcp.NewClient(&mcp.Implementation{Name: "yolu-test", Version: "1"}, nil).Connect(t.Context(), clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func callTestMCP(t *testing.T, session *mcp.ClientSession, name string, arguments any, out any) {
	t.Helper()
	result, err := session.CallTool(t.Context(), &mcp.CallToolParams{Name: name, Arguments: arguments})
	if err != nil || result.IsError {
		t.Fatalf("MCP call %s: %+v %v", name, result, err)
	}
	raw, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatal(err)
	}
}
