package project

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"worktree-hub/internal/testutil"
	"worktree-hub/internal/workspace"
)

func scanProjects(t *testing.T, a *App, path string) workspace.RepositoryScan {
	t.Helper()
	code, raw := call(t, a, "POST", "/api/projects/scan", map[string]string{"path": path})
	var result workspace.RepositoryScan
	if code != 200 || json.Unmarshal(raw, &result) != nil {
		t.Fatalf("scan: %d %s", code, raw)
	}
	return result
}

func importProjects(t *testing.T, a *App, inputs []projectImportInput) []projectImportResult {
	t.Helper()
	code, raw := call(t, a, "POST", "/api/projects/import", map[string]any{"repositories": inputs})
	var response struct {
		Results []projectImportResult `json:"results"`
	}
	if code != 200 || json.Unmarshal(raw, &response) != nil {
		t.Fatalf("import: %d %s", code, raw)
	}
	return response.Results
}

func TestScanProjectsFindsNestedRepositoriesAndDeduplicatesWorktrees(t *testing.T) {
	a := testApp(t)
	root := testutil.TempDir(t)
	seed := repo(t, "seed", "main")
	main := filepath.Join(root, "a-main")
	testGit(t, root, "clone", seed, main)
	testGit(t, main, "worktree", "add", "-b", "linked", filepath.Join(root, "b-linked"))
	nested := filepath.Join(main, "nested")
	testGit(t, root, "clone", seed, nested)
	for _, directory := range []string{"node_modules", "vendor", ".venv"} {
		testGit(t, root, "clone", seed, filepath.Join(root, directory, "hidden"))
	}
	if err := os.Symlink(main, filepath.Join(root, "linked-directory")); err != nil {
		t.Logf("directory symlink unavailable: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "broken", ".git"), 0755); err != nil {
		t.Fatal(err)
	}
	registeredID := register(t, a, "Existing main", main)
	result := scanProjects(t, a, root)
	if len(result.Repositories) != 5 || result.Truncated || len(result.Warnings) != 1 {
		t.Fatalf("unexpected scan: %+v", result)
	}
	found := make(map[string]workspace.DiscoveredRepository)
	for _, repository := range result.Repositories {
		found[repository.Path] = repository
	}
	if found[main].ProjectID != registeredID || found[nested].Path != nested {
		t.Fatalf("unexpected repositories: %+v", result.Repositories)
	}
	for _, directory := range []string{"node_modules", "vendor", ".venv"} {
		if found[filepath.Join(root, directory, "hidden")].Path == "" {
			t.Fatalf("repository under %s was omitted", directory)
		}
	}
	inside := scanProjects(t, a, filepath.Join(main, "nested"))
	if len(inside.Repositories) != 1 || inside.Repositories[0].Path != nested {
		t.Fatalf("root repository omitted: %+v", inside)
	}
}

func TestScanProjectsSuggestsDistinctNamesAndBatchRetryPreservesSuccesses(t *testing.T) {
	a := testApp(t)
	root := testutil.TempDir(t)
	seed := repo(t, "seed", "main")
	longName := strings.Repeat("a", 70)
	for _, directory := range []string{"first", "second"} {
		testGit(t, root, "clone", seed, filepath.Join(root, directory, longName))
	}
	result := scanProjects(t, a, root)
	if len(result.Repositories) != 2 || result.Repositories[0].Name == result.Repositories[1].Name || workspace.Slugify(result.Repositories[0].Name) == workspace.Slugify(result.Repositories[1].Name) {
		t.Fatalf("colliding suggestions: %+v", result.Repositories)
	}
	inputs := make([]projectImportInput, 0, 2)
	for _, repository := range result.Repositories {
		inputs = append(inputs, projectImportInput{Name: repository.Name, Path: repository.Path, CommonDir: repository.CommonDir})
	}
	inputs[1].Name = inputs[0].Name
	first := importProjects(t, a, inputs)
	if first[0].Status != "registered" || first[0].ID == "" || first[1].Status != "error" || first[1].Error == "" {
		t.Fatalf("partial results: %+v", first)
	}
	inputs[1].Name = "Second project"
	retry := importProjects(t, a, inputs)
	if retry[0].Status != "existing" || retry[0].ID != first[0].ID || retry[1].Status != "registered" {
		t.Fatalf("retry: %+v", retry)
	}
	var wg sync.WaitGroup
	for range 2 {
		wg.Go(func() {
			repeated := importProjects(t, a, inputs)
			if repeated[0].ID != retry[0].ID || repeated[1].ID != retry[1].ID {
				t.Errorf("concurrent retry: %+v", repeated)
			}
		})
	}
	wg.Wait()
	projects, err := a.Workspace.Store.ProjectMap()
	if err != nil || len(projects) != 2 {
		t.Fatalf("registrations: %+v %v", projects, err)
	}
}

func TestImportProjectsRevalidatesRepositoryIdentity(t *testing.T) {
	a := testApp(t)
	path := repo(t, "original", "main")
	discovered := scanProjects(t, a, path).Repositories[0]
	if err := os.Rename(path, path+"-moved"); err != nil {
		t.Fatal(err)
	}
	testGit(t, filepath.Dir(path), "clone", path+"-moved", path)
	// An in-place clone has the same common-directory path. A replacement
	// symlink changes the canonical identity and must require another scan.
	if err := os.Rename(path, path+"-replacement"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(path+"-replacement", path); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	result := importProjects(t, a, []projectImportInput{{Name: "Original", Path: path, CommonDir: discovered.CommonDir}})
	if result[0].Status != "error" || result[0].ID != "" {
		t.Fatalf("changed identity accepted: %+v", result)
	}
}

func TestProjectScanAndImportRejectInvalidInputs(t *testing.T) {
	a := testApp(t)
	for _, input := range []string{"", filepath.Join(t.TempDir(), "missing")} {
		code, raw := call(t, a, "POST", "/api/projects/scan", map[string]string{"path": input})
		if code < 400 {
			t.Fatalf("invalid scan accepted: %d %s", code, raw)
		}
	}
	code, raw := call(t, a, "POST", "/api/projects/import", map[string]any{"repositories": []projectImportInput{}})
	if code != 400 {
		t.Fatalf("empty import accepted: %d %s", code, raw)
	}
	empty := scanProjects(t, a, t.TempDir())
	if len(empty.Repositories) != 0 || empty.Repositories == nil || empty.Warnings == nil {
		t.Fatalf("empty scan: %+v", empty)
	}
}
