package app

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"worktree-hub/internal/memory"
	"worktree-hub/internal/platform"
)

type listProjectsInput struct {
	Query string `json:"query,omitempty" jsonschema:"Filter project names by case-insensitive substring."`
}

type projectSummary struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	EnvironmentID string `json:"environment_id"`
	Connected     bool   `json:"connected"`
}

type listProjectsOutput struct {
	Projects     []projectSummary              `json:"projects"`
	Environments []projectInventoryEnvironment `json:"environments"`
}

type getProjectInput struct {
	ProjectID     string `json:"project_id" jsonschema:"Project ID returned by list_projects."`
	EnvironmentID string `json:"environment_id" jsonschema:"Environment ID returned by list_projects for this project."`
	Refresh       bool   `json:"refresh,omitempty" jsonschema:"Request a fresh local Git status scan. Defaults to using Yolu's shared status cache."`
}

type getProjectOutput struct {
	Project          projectInventoryEntry `json:"project"`
	StatusRefreshing bool                  `json:"status_refreshing"`
	OpenURL          string                `json:"open_url"`
	WorktreeLinks    map[string]string     `json:"worktree_links"`
}

type projectMCP struct {
	dataDir string
	client  *http.Client
}

func runMCP(args []string) error {
	flags := flag.NewFlagSet("yolu-backend --mcp", flag.ContinueOnError)
	dataDir := flags.String("data", platform.DefaultDataDir(), "data directory of the running Yolu backend")
	memoryTools := flags.Bool("memory", false, "enable scoped conversation memory tools")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 || *dataDir == "" {
		return errors.New("usage: yolu-backend --mcp [--data DIRECTORY] [--memory]")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	client := desktopHTTPClient(5 * time.Second)
	defer client.CloseIdleConnections()
	server := (&projectMCP{dataDir: *dataDir, client: client}).server()
	if *memoryTools {
		client.Timeout = 10 * time.Second
		grant := os.Getenv(memory.GrantEnv)
		if grant == "" {
			return errors.New("Yolu memory requires a conversation grant")
		}
		server = newMemoryMCP(*dataDir, client, grant)
	}
	err := server.Run(ctx, &mcp.StdioTransport{})
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}

func (s *projectMCP) server() *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: mcpServerName, Title: "Yolu", Version: BuildVersion}, nil)
	readOnly := &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: new(false)}
	mcp.AddTool(server, &mcp.Tool{
		Name: "list_projects", Description: "Find Yolu projects and their execution environments.", Annotations: readOnly,
	}, s.listProjects)
	mcp.AddTool(server, &mcp.Tool{
		Name: "get_project", Description: "Read a Yolu project's worktrees, branches and local Git status. Check status_refreshing and each worktree's status_updated_at before using status counts.", Annotations: readOnly,
	}, s.getProject)
	return server
}

func (s *projectMCP) listProjects(ctx context.Context, _ *mcp.CallToolRequest, input listProjectsInput) (*mcp.CallToolResult, listProjectsOutput, error) {
	info, err := s.connect()
	if err != nil {
		return nil, listProjectsOutput{}, err
	}
	inventory, err := s.inventory(ctx, info, false)
	if err != nil {
		return nil, listProjectsOutput{}, err
	}
	result := listProjectsOutput{Projects: []projectSummary{}, Environments: inventory.Environments}
	query := strings.ToLower(strings.TrimSpace(input.Query))
	for _, project := range inventory.Projects {
		if strings.Contains(strings.ToLower(project.Name), query) {
			result.Projects = append(result.Projects, projectSummary{
				ID: project.ID, Name: project.Name, EnvironmentID: project.EnvironmentID, Connected: project.Connected,
			})
		}
	}
	return nil, result, nil
}

func (s *projectMCP) getProject(ctx context.Context, _ *mcp.CallToolRequest, input getProjectInput) (*mcp.CallToolResult, getProjectOutput, error) {
	if input.EnvironmentID == "" || input.ProjectID == "" {
		return nil, getProjectOutput{}, errors.New("provide both project_id and environment_id from list_projects")
	}
	info, err := s.connect()
	if err != nil {
		return nil, getProjectOutput{}, err
	}
	result, err := s.projectStatus(ctx, info, input, input.Refresh)
	if err != nil || !result.StatusRefreshing {
		return nil, result, err
	}

	// Wait briefly for the shared background scan. Slow scans keep running in
	// Yolu and the last snapshot still tells the caller that status is pending.
	wait, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for result.StatusRefreshing {
		select {
		case <-wait.Done():
			return nil, result, ctx.Err()
		case <-ticker.C:
			latest, err := s.projectStatus(wait, info, input, false)
			if wait.Err() != nil {
				return nil, result, ctx.Err()
			}
			if err != nil {
				return nil, result, err
			}
			result = latest
		}
	}
	return nil, result, nil
}

func (s *projectMCP) projectStatus(ctx context.Context, info desktopServiceInfo, input getProjectInput, refresh bool) (getProjectOutput, error) {
	inventory, err := s.inventory(ctx, info, refresh)
	if err != nil {
		return getProjectOutput{}, err
	}
	for _, project := range inventory.Projects {
		if project.ID == input.ProjectID && project.EnvironmentID == input.EnvironmentID {
			path := "#/projects/" + url.PathEscape(project.ID) + "?"
			query := url.Values{"environment": {project.EnvironmentID}}
			result := getProjectOutput{
				Project: project, StatusRefreshing: project.Connected && project.Refreshing,
				OpenURL: path + query.Encode(), WorktreeLinks: make(map[string]string),
			}
			for _, worktree := range project.Worktrees {
				if worktree.Path == "" || worktree.Missing || worktree.Bare {
					continue
				}
				query.Set("directory", worktree.Path)
				result.WorktreeLinks[worktree.Path] = path + query.Encode()
			}
			return result, nil
		}
	}
	for _, environment := range inventory.Environments {
		if environment.ID == input.EnvironmentID && environment.Error != "" {
			return getProjectOutput{}, fmt.Errorf("cannot read the selected environment: %s", environment.Error)
		}
	}
	return getProjectOutput{}, errors.New("project not found in the selected environment; use list_projects to look up both IDs")
}

func (s *projectMCP) connect() (desktopServiceInfo, error) {
	info, err := readDesktopService(s.dataDir)
	if err != nil || !info.Ready {
		return desktopServiceInfo{}, errors.New("cannot connect to Yolu; start the desktop app or browser backend with the same data directory")
	}
	return info, nil
}

func (s *projectMCP) inventory(ctx context.Context, info desktopServiceInfo, refresh bool) (projectInventory, error) {
	var inventory projectInventory
	endpoint := info.URL + "/api/project-inventory"
	if refresh {
		endpoint += "?refresh=1"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return inventory, err
	}
	request.Header.Set("X-CSRF-Token", info.Token)
	response, err := s.client.Do(request)
	if err != nil {
		return inventory, fmt.Errorf("cannot read Yolu project inventory: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return inventory, fmt.Errorf("Yolu project inventory returned HTTP %d", response.StatusCode)
	}
	err = json.NewDecoder(response.Body).Decode(&inventory)
	return inventory, err
}
