package testutil

import (
	"net/http"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/overview"
	"worktree-hub/web"
)

// Handler uses the same overview and security boundaries as the application,
// while each module's fixture supplies only the routes it exercises.
func Handler(environment *execution.Service, token string, status overview.ProjectStatus, registrars ...func(*http.ServeMux)) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /api/state", overview.New(environment, status))
	for _, register := range registrars {
		register(mux)
	}
	environment.RegisterRoutes(mux)
	mux.Handle("/", web.Handler(token, environment.ReadOnlySessions))
	return httpx.LocalHandler(token, func() bool { return environment.ReadOnlySessions }, func() bool { return environment.Closing.Load() }, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if environment.Remote != nil {
			r = r.WithContext(execution.WithClient(r.Context(), environment.Remote))
		}
		mux.ServeHTTP(w, r)
	}))
}
