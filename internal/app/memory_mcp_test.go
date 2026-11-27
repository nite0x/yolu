package app

import (
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"worktree-hub/internal/memory"
	"worktree-hub/internal/model"
)

func TestMemoryMCPWithBundledCore(t *testing.T) {
	binary := os.Getenv("YOLU_TEST_ENGRAM_CORE")
	if binary == "" {
		t.Skip("set YOLU_TEST_ENGRAM_CORE to the packaged Engram Core executable")
	}
	a := testApp(t)
	a.Sessions.Memory = memory.New(binary, a.Execution.DataDir, a.Execution.Store.SessionBindings)
	backend := httptest.NewServer(a.handler())
	t.Cleanup(backend.Close)
	if err := writeDesktopService(a.Execution.DataDir, a.desktopInfo(backend.URL)); err != nil {
		t.Fatal(err)
	}
	path := repo(t, "memory", "master")
	project := register(t, a, "Memory", path)
	worktree := createWorktree(t, a, project, "memory-new-session").Path
	otherPath := repo(t, "other-memory", "master")
	otherProject := register(t, a, "Other memory", otherPath)
	connect := func(session, project, directory string, save bool) (*memory.Grant, *mcp.ClientSession) {
		t.Helper()
		binding := model.SessionProjectBinding{ProjectID: project, Directory: directory, Role: model.SessionBindingPrimary, Access: model.SessionBindingWrite}
		if err := a.Execution.Store.SaveSession(model.Session{ID: session, Cwd: directory}); err != nil {
			t.Fatal(err)
		}
		if err := a.Execution.Store.InsertSessionBindings(session, []model.SessionProjectBinding{binding}); err != nil {
			t.Fatal(err)
		}
		grant := a.Sessions.Memory.Issue(t.Context(), binding, save)
		t.Cleanup(grant.Close)
		grant.Activate(session, "turn-start:request")
		client := desktopHTTPClient(10 * time.Second)
		t.Cleanup(client.CloseIdleConnections)
		serverTransport, clientTransport := mcp.NewInMemoryTransports()
		server, err := newMemoryMCP(a.Execution.DataDir, client, grant.Token()).Connect(t.Context(), serverTransport, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = server.Close() })
		connected, err := mcp.NewClient(&mcp.Implementation{Name: "memory-fixture"}, nil).Connect(t.Context(), clientTransport, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = connected.Close() })
		return grant, connected
	}
	grant, writer := connect("writer", project, path, true)
	input := memory.SaveInput{Title: "Release marker", Content: "The release marker is TUNDRAK8X73."}
	var saved, repeated memory.SaveResult
	callTestMCP(t, writer, memory.SaveTool, input, &saved)
	callTestMCP(t, writer, memory.SaveTool, input, &repeated)
	if saved.ID <= 0 || saved.Replayed || repeated.ID != saved.ID || !repeated.Replayed {
		t.Fatalf("save or replay failed: %+v %+v", saved, repeated)
	}
	grant.Close()
	_, reader := connect("new-conversation", project, worktree, false)
	query := memory.SearchInput{Query: "release marker"}
	var found memory.SearchResult
	callTestMCP(t, reader, memory.SearchTool, query, &found)
	if len(found.Matches) != 1 || found.Matches[0].ID != saved.ID || found.Matches[0].Preview != input.Content {
		t.Fatalf("new worktree conversation missed its project's saved memory: %+v", found)
	}
	_, other := connect("other-project", otherProject, otherPath, false)
	var empty memory.SearchResult
	callTestMCP(t, other, memory.SearchTool, query, &empty)
	if len(empty.Matches) != 0 {
		t.Fatalf("another project saw saved memory: %+v", empty)
	}
	for _, attempt := range []struct {
		client *mcp.ClientSession
		tool   string
		input  any
	}{{writer, memory.SearchTool, query}, {reader, memory.SaveTool, input}} {
		result, err := attempt.client.CallTool(t.Context(), &mcp.CallToolParams{Name: attempt.tool, Arguments: attempt.input})
		if err != nil || !result.IsError {
			t.Fatalf("unauthorized operation succeeded: %+v %v", result, err)
		}
	}
}
