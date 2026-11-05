package session

import (
	"context"
	"net/http"
	"time"

	"worktree-hub/internal/httpx"
)

type RateLimitWindow struct {
	UsedPercent        *float64 `json:"usedPercent"`
	WindowDurationMins *int     `json:"windowDurationMins"`
	ResetsAt           *int64   `json:"resetsAt"`
}

type RateLimitSnapshot struct {
	LimitID   string           `json:"limitId,omitempty"`
	LimitName string           `json:"limitName,omitempty"`
	PlanType  string           `json:"planType,omitempty"`
	Primary   *RateLimitWindow `json:"primary"`
	Secondary *RateLimitWindow `json:"secondary"`
}

type RateLimitsResponse struct {
	RateLimits          *RateLimitSnapshot           `json:"rateLimits"`
	RateLimitsByLimitID map[string]RateLimitSnapshot `json:"rateLimitsByLimitId,omitempty"`
	ResetCredits        *RateLimitResetCredits       `json:"rateLimitResetCredits"`
	CheckedAt           int64                        `json:"checkedAt"`
}

type RateLimitResetCredits struct {
	AvailableCount int                  `json:"availableCount"`
	Credits        []RateLimitResetCard `json:"credits"`
}

type RateLimitResetCard struct {
	ID          string `json:"id"`
	ResetType   string `json:"resetType"`
	Status      string `json:"status"`
	GrantedAt   int64  `json:"grantedAt"`
	ExpiresAt   *int64 `json:"expiresAt"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// Account limits are independent of threads. Reuse the environment's read-only
// Codex channel and cache briefly so opening multiple workspace pages is cheap.
func (s *Service) RateLimitsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	s.rateLimitsMu.Lock()
	defer s.rateLimitsMu.Unlock()
	if s.rateLimits != nil && r.URL.Query().Get("refresh") != "1" && time.Since(time.Unix(s.rateLimits.CheckedAt, 0)) < time.Minute {
		httpx.WriteJSON(w, http.StatusOK, s.rateLimits)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	c, err := s.openSessions(ctx)
	if err != nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "暂时无法读取 Codex 额度，请确认此环境中的 Codex 已登录后重试。")
		return
	}
	defer c.Close()
	var result RateLimitsResponse
	if err := c.Call("account/rateLimits/read", map[string]any{}, &result); err != nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "暂时无法读取 Codex 额度；当前登录方式可能不支持额度查询，请稍后重试。")
		return
	}
	result.CheckedAt = time.Now().Unix()
	s.rateLimits = &result
	httpx.WriteJSON(w, http.StatusOK, result)
}
