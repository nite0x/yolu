package session

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
)

func makeMergeConflict(t *testing.T, directory string) string {
	t.Helper()
	original := testGit(t, directory, "branch", "--show-current")
	commit := func(text string) {
		if err := os.WriteFile(filepath.Join(directory, "README.md"), []byte(text+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		testGit(t, directory, "add", "README.md")
		testGit(t, directory, "commit", "-m", text)
	}
	testGit(t, directory, "switch", "-c", "incoming")
	commit("incoming")
	head := testGit(t, directory, "rev-parse", "HEAD")
	testGit(t, directory, "switch", original)
	commit("current")
	if _, err := execution.GitOperation(context.Background(), directory, "merge", "incoming"); err == nil {
		t.Fatal("merge unexpectedly succeeded")
	}
	return head
}

func TestMergeAssistanceRevalidatesSelectedWorktree(t *testing.T) {
	for _, terminal := range []bool{false, true} {
		name := "conversation"
		if terminal {
			name = "terminal"
		}
		t.Run(name, func(t *testing.T) {
			a, q, c, _ := chatFixture(t)
			head := makeMergeConflict(t, q.Path)
			input := map[string]string{"project_id": q.ProjectID, "cwd": q.Path, "merge_head": "stale", "request_id": "merge-assist"}
			endpoint := "/api/sessions/new"
			var launched []model.LaunchPlan
			a.Execution.Launch = func(plan model.LaunchPlan, _ func()) error {
				launched = append(launched, plan)
				return nil
			}
			if terminal {
				a.Execution.ReadOnlySessions = true
				endpoint = "/api/sessions/merge-terminal"
			} else {
				input["purpose"] = "merge_conflict"
			}
			if code, _ := call(t, a, "POST", endpoint, input); code != 409 {
				t.Fatalf("stale merge head accepted: %d", code)
			}
			input["merge_head"] = head
			want := 202
			if terminal {
				want = 200
			}
			if code, raw := call(t, a, "POST", endpoint, input); code != want {
				t.Fatalf("merge: %d %s", code, raw)
			}
			if code, _ := call(t, a, "POST", endpoint, input); code != 200 {
				t.Fatalf("merge retry: %d", code)
			}
			if terminal {
				if len(launched) != 1 || launched[0].Cwd != q.Path || !strings.Contains(strings.Join(launched[0].Args, " "), head) {
					t.Fatalf("wrong terminal target: %+v", launched)
				}
				return
			}
			awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
			c.mu.Lock()
			params := c.startParams
			c.mu.Unlock()
			text := params["input"].([]any)[0].(map[string]any)["text"].(string)
			if params["cwd"] != q.Path || !strings.Contains(text, head) || !strings.Contains(text, "README.md") {
				t.Fatalf("wrong merge context: %+v", params)
			}
			finishFakeTurn(t, a, c)
		})
	}
}
