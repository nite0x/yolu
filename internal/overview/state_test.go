package overview

import (
	"testing"
	"worktree-hub/internal/model"
)

func TestCompletedDiscoveryReportsMissingWorkspaceDirectory(t *testing.T) {
	for _, step := range []struct {
		refreshing bool
		failed     bool
		missing    bool
	}{{true, false, false}, {false, false, true}, {false, true, false}} {
		p := model.Project{ID: "p", StatusUpdatedAt: "checked", Refreshing: step.refreshing}
		if step.failed {
			p.Error = "repository unavailable"
		}
		workspaces := []model.Workspace{{ID: "q", Members: []model.Member{{ProjectID: "p", Path: "/missing", State: "ready"}}}}
		LinkWorktrees([]model.Project{p}, workspaces)
		observed := workspaces[0].Members[0].Worktree
		if step.refreshing {
			if observed != nil {
				t.Fatal("incomplete discovery reported missing")
			}
			continue
		}
		if observed == nil || observed.Missing != step.missing || (observed.Error != "") != step.failed {
			t.Fatalf("observed %+v", observed)
		}
	}
}
