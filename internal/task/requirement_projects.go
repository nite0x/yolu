package task

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/workspace"
)

func (a *Service) AddRequirementProjectsHandler(w http.ResponseWriter, r *http.Request) {
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

func appendProjectsBrief(q model.Requirement, added []model.Member) error {
	return appendProjectsBriefContext(context.Background(), q, added)
}
func appendProjectsBriefContext(ctx context.Context, q model.Requirement, added []model.Member) error {
	if !q.HasWorkspace {
		return nil
	}
	if _, err := workspace.Stat(ctx, q.Path, false); errors.Is(err, os.ErrNotExist) {
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
	return workspace.Write(ctx, platform.JoinWorkspacePath(q.Path, "BRIEF.md"), []byte(b.String()), os.O_WRONLY|os.O_APPEND, 0)
}
