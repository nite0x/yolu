package workspace

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

func (a *Service) MakeLaunchPlan(ctx context.Context, id string) (model.LaunchPlan, error) {
	q, err := a.Execution.Store.Workspace(id)
	if err != nil {
		return model.LaunchPlan{}, err
	}
	if q.State != "ready" {
		return model.LaunchPlan{}, fmt.Errorf("工作区未就绪或已归档，不能启动 Codex")
	}
	ps, err := a.Execution.Store.ProjectMap()
	if err != nil {
		return model.LaunchPlan{}, err
	}
	p := model.LaunchPlan{Title: "Codex · " + q.Name, Workspace: q.ID, Args: []string{}, AdditionalDirectories: []string{}}
	for _, m := range q.Members {
		if err := VerifyMember(ctx, ps[m.ProjectID], m, q.Branch); err != nil {
			return model.LaunchPlan{}, fmt.Errorf("%s：%w", m.ProjectName, err)
		}
		if m.ProjectID == q.PrimaryProjectID {
			p.Cwd = m.Path
		} else {
			p.AdditionalDirectories = append(p.AdditionalDirectories, m.Path)
		}
	}
	if p.Cwd == "" {
		return model.LaunchPlan{}, fmt.Errorf("主项目 Worktree 不存在")
	}
	p.Args = append(p.Args, "--cd", p.Cwd)
	for _, dir := range p.AdditionalDirectories {
		p.Args = append(p.Args, "--add-dir", dir)
	}
	p.Command = platform.DisplayCommand("codex", p.Args, platform.NativeWindows() && a.Execution.Remote == nil)
	return p, nil
}
func (a *Service) LaunchPlanHandler(w http.ResponseWriter, r *http.Request) {
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	p, err := a.MakeLaunchPlan(r.Context(), r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "工作区不存在")
		return
	}
	if err != nil {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	httpx.WriteJSON(w, 200, p)
}
