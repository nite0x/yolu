package session

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"time"

	"worktree-hub/internal/httpx"
)

var resetRequestKey = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Retries must reuse the caller's key: a timeout can happen after Codex has
// already consumed the card. Codex owns redemption and idempotency semantics.
func (s *Service) RateLimitResetHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var input struct {
		Confirmed      bool   `json:"confirmed"`
		IdempotencyKey string `json:"idempotencyKey"`
		CreditID       string `json:"creditId,omitempty"`
	}
	if !httpx.DecodeLimit(w, r, &input, 4096) {
		return
	}
	if !input.Confirmed || !resetRequestKey.MatchString(input.IdempotencyKey) || input.CreditID == "" || len(input.CreditID) > 512 || strings.TrimSpace(input.CreditID) != input.CreditID {
		httpx.WriteError(w, http.StatusBadRequest, "请先确认使用一张重置卡，并提供有效的操作标识。")
		return
	}
	s.rateLimitsMu.Lock()
	defer s.rateLimitsMu.Unlock()
	s.rateLimits = nil
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	c, err := s.openSessions(ctx)
	if err != nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "暂未确认重置结果，请重试上次操作以核对结果。")
		return
	}
	defer c.Close()
	params := map[string]any{"idempotencyKey": input.IdempotencyKey}
	if input.CreditID != "" {
		params["creditId"] = input.CreditID
	}
	var result struct {
		Outcome string `json:"outcome"`
	}
	if err := c.Call("account/rateLimitResetCredit/consume", params, &result); err != nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "暂未确认重置结果，请重试上次操作以核对结果。")
		return
	}
	switch result.Outcome {
	case "reset", "alreadyRedeemed", "nothingToReset", "noCredit":
		httpx.WriteJSON(w, http.StatusOK, result)
	default:
		httpx.WriteError(w, http.StatusBadGateway, "Codex 尚未返回可确认的重置结果，请重试上次操作。")
	}
}
