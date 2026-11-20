package session

import (
	"context"
	"net/http"

	"worktree-hub/internal/httpx"
)

type legacyResumePlanKey struct{}

// Workspace URLs remain compatibility adapters. Resolve their scope/readiness here,
// then dispatch to the same workspace-independent session operation as the global URL.
func (a *Service) workspaceSessionAdapter(next http.HandlerFunc, launch bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		scope, err := a.workspaceScope(id)
		if err != nil {
			httpx.WriteError(w, 404, "工作区不存在")
			return
		}
		s, err := a.Execution.Store.Session(r.PathValue("session"))
		if err != nil || !scope.includes(s.ID, s.Cwd) {
			httpx.WriteError(w, 404, "对话不在该工作区的目录范围内，也未手动关联")
			return
		}
		if launch {
			plan, err := a.plans.MakeLaunchPlan(r.Context(), id)
			if err != nil {
				httpx.WriteError(w, 409, err.Error())
				return
			}
			r = r.WithContext(context.WithValue(r.Context(), legacyResumePlanKey{}, plan))
		}
		r.SetPathValue("id", "")
		next(w, r)
	}
}
