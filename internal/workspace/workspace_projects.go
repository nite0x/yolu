package workspace

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

func (a *Service) AddWorkspaceProjectsHandler(w http.ResponseWriter, r *http.Request) {
	var in AttachProjectsInput
	if !httpx.Decode(w, r, &in) {
		return
	}
	q, err := a.AttachProjects(r.Context(), r.PathValue("id"), in)
	if err != nil {
		writeOperationError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, q)
}

func appendProjectsBrief(q model.Workspace, added []model.Member) error {
	return appendProjectsBriefContext(context.Background(), q, added)
}
func appendProjectsBriefContext(ctx context.Context, q model.Workspace, added []model.Member) error {
	if !q.HasDirectory {
		return nil
	}
	if _, err := execution.Stat(ctx, q.Path, false); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err := WriteBriefContext(ctx, q); err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("\n\n## 新增参与项目\n\n")
	for _, m := range added {
		fmt.Fprintf(&b, "- %s（参与项目）：%s\n  %s\n", m.ProjectName, m.Path, memberDescription(m))
	}
	return execution.Write(ctx, platform.JoinWorkspacePath(q.Path, "BRIEF.md"), []byte(b.String()), os.O_WRONLY|os.O_APPEND, 0)
}
