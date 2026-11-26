package httpx

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"worktree-hub/internal/model"
)

type requestContextKey struct{}

func RequestLogger(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(requestContextKey{}).(*slog.Logger); ok {
		return logger
	}
	return slog.Default()
}

// Diagnostics retains ResponseWriter capabilities used by SSE and WebSockets by
// passing the original writer through. Never log tokens, bodies or query text.
func Diagnostics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := r.Context().Value(requestContextKey{}).(*slog.Logger); ok {
			next.ServeHTTP(w, r)
			return
		}
		requestID := model.NewID()
		w.Header().Set("X-Request-ID", requestID)
		environment := r.Header.Get("X-Environment-ID")
		if environment == "" {
			environment = "local"
		}
		logger := slog.Default().With("request_id", requestID, "environment_id", environment, "method", r.Method)
		ctx := context.WithValue(r.Context(), requestContextKey{}, logger)
		r = r.WithContext(ctx)
		start := time.Now()
		next.ServeHTTP(w, r)
		if r.Method != http.MethodGet {
			logger.Info("API mutation completed", "duration_ms", time.Since(start).Milliseconds())
		}
	})
}
