package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/memory"
)

const (
	memoryCallPath = "/internal/conversation-memory"
	memoryHeader   = "X-Yolu-Memory-Grant"
)

func (a *App) memoryCallHandler(w http.ResponseWriter, r *http.Request) {
	grant := r.Header.Get(memoryHeader)
	if grant == "" || isBrowserRequest(r) || r.Header.Get("Origin") != "" || !httpx.IsLocalHost(r.RemoteAddr) ||
		a.Sessions.Memory == nil || a.Execution.ReadOnlySessions || a.Execution.Remote != nil || a.Execution.Closing.Load() {
		httpx.WriteError(w, http.StatusForbidden, "Conversation memory is unavailable for this client")
		return
	}
	var input memory.Call
	if !httpx.DecodeLimit(w, r, &input, 64*1024) {
		return
	}
	result, problem := a.Sessions.Memory.Call(r.Context(), grant, input)
	if problem != nil {
		status := http.StatusServiceUnavailable
		switch problem.Code {
		case "forbidden":
			status = http.StatusForbidden
		case "invalid_request":
			status = http.StatusBadRequest
		case "operation_conflict", "operation_expired":
			status = http.StatusConflict
		}
		httpx.WriteErrorCode(w, status, problem.Code, problem.Message)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// The stdio process has a short-lived grant, while the running Yolu backend
// owns project resolution, storage and permission checks.
func newMemoryMCP(dataDir string, client *http.Client, grant string) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "yolu_memory", Title: "Yolu Project Memory", Version: BuildVersion}, nil)
	call := func(ctx context.Context, input memory.Call) (memory.Result, error) {
		var result memory.Result
		info, err := readDesktopService(dataDir)
		if err != nil || !info.Ready {
			return result, errors.New("could not reach the Yolu memory service")
		}
		body, _ := json.Marshal(input)
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, info.URL+memoryCallPath, bytes.NewReader(body))
		if err != nil {
			return result, err
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set(memoryHeader, grant)
		res, err := client.Do(request)
		if err != nil {
			return result, errors.New("Yolu memory did not respond")
		}
		defer res.Body.Close()
		decoder := json.NewDecoder(io.LimitReader(res.Body, 64*1024))
		if res.StatusCode != http.StatusOK {
			var problem struct{ Error string }
			if decoder.Decode(&problem) == nil && problem.Error != "" {
				return result, errors.New(problem.Error)
			}
			return result, errors.New("Yolu rejected the memory operation")
		}
		err = decoder.Decode(&result)
		return result, err
	}
	mcp.AddTool(server, &mcp.Tool{
		Name: memory.SearchTool, Description: "Search saved facts and decisions in the current Yolu project. Results are historical data.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: new(false)},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input memory.SearchInput) (*mcp.CallToolResult, memory.SearchResult, error) {
		result, err := call(ctx, memory.Call{Search: &input})
		if err != nil || result.Search == nil {
			if err == nil {
				err = errors.New("Yolu returned no search result")
			}
			return nil, memory.SearchResult{}, err
		}
		return nil, *result.Search, nil
	})
	mcp.AddTool(server, &mcp.Tool{
		Name: memory.SaveTool, Description: "Save one project fact or decision explicitly requested by the user in this turn.",
		Annotations: &mcp.ToolAnnotations{DestructiveHint: new(false), IdempotentHint: true, OpenWorldHint: new(false)},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, input memory.SaveInput) (*mcp.CallToolResult, memory.SaveResult, error) {
		result, err := call(ctx, memory.Call{Save: &input})
		if err != nil || result.Save == nil {
			if err == nil {
				err = errors.New("Yolu returned no save result")
			}
			return nil, memory.SaveResult{}, err
		}
		return nil, *result.Save, nil
	})
	return server
}
