package session

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/codex"
)

func TestRateLimitsReadCachesAndRefreshesWithoutStartingThreads(t *testing.T) {
	a := testApp(t)
	reads := 0
	a.openSessions = func(ctx context.Context) (codex.SessionClient, error) {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 10*time.Second {
			t.Fatal("unbounded quota read")
		}
		return &fakeSessionClient{request: func(method string, _ map[string]any) (any, error) {
			if method != "account/rateLimits/read" {
				t.Fatalf("unexpected mutation or RPC: %s", method)
			}
			reads++
			return map[string]any{
				"rateLimits":            map[string]any{"limitId": "codex", "primary": map[string]any{"usedPercent": 25, "windowDurationMins": 300, "resetsAt": 1730947200}},
				"rateLimitsByLimitId":   map[string]any{"codex": map[string]any{"primary": map[string]any{"usedPercent": 25}}, "other": map[string]any{"primary": map[string]any{"windowDurationMins": 10080}}},
				"rateLimitResetCredits": map[string]any{"availableCount": 2, "credits": []map[string]any{{"id": "card", "resetType": "codexRateLimits", "status": "available", "title": "Full reset", "expiresAt": 1800000000}}},
			}, nil
		}}, nil
	}
	for _, path := range []string{"/api/codex/rate-limits", "/api/codex/rate-limits", "/api/codex/rate-limits?refresh=1"} {
		code, raw := call(t, a, "GET", path, nil)
		var value RateLimitsResponse
		if code != 200 || json.Unmarshal(raw, &value) != nil || value.CheckedAt == 0 {
			t.Fatalf("%d %s", code, raw)
		}
		if value.RateLimits.Primary == nil || *value.RateLimits.Primary.UsedPercent != 25 || len(value.RateLimitsByLimitID) != 2 {
			t.Fatal(string(raw))
		}
		if value.RateLimitsByLimitID["other"].Primary.UsedPercent != nil {
			t.Fatal("missing usage became a false zero")
		}
		if value.ResetCredits == nil || value.ResetCredits.AvailableCount != 2 || len(value.ResetCredits.Credits) != 1 || value.ResetCredits.Credits[0].ID != "card" {
			t.Fatal("card count or details lost", string(raw))
		}
	}
	if reads != 2 {
		t.Fatalf("reads=%d", reads)
	}
	a.rateLimits.CheckedAt = time.Now().Add(-2 * time.Minute).Unix()
	call(t, a, "GET", "/api/codex/rate-limits", nil)
	if reads != 3 {
		t.Fatal("expired quota was not refreshed")
	}
}

func TestRateLimitResetRequiresConfirmationAndPreservesIdempotency(t *testing.T) {
	a := testApp(t)
	const key = "8ae96ff3-3425-4f4c-8772-b6fd61502868"
	var keys []string
	var outcome = "reset"
	a.openSessions = func(context.Context) (codex.SessionClient, error) {
		return &fakeSessionClient{request: func(method string, params map[string]any) (any, error) {
			if method != "account/rateLimitResetCredit/consume" || params["creditId"] != "card" {
				t.Fatalf("unexpected RPC %s %+v", method, params)
			}
			keys = append(keys, params["idempotencyKey"].(string))
			if outcome == "timeout" {
				return nil, fmt.Errorf("private upstream error")
			}
			return map[string]any{"outcome": outcome}, nil
		}}, nil
	}
	for _, input := range []map[string]any{
		{"idempotencyKey": key, "creditId": "card"},
		{"confirmed": true, "idempotencyKey": "bad", "creditId": "card"},
		{"confirmed": true, "idempotencyKey": key},
	} {
		code, _ := call(t, a, "POST", "/api/codex/rate-limit-reset", input)
		if code != 400 || len(keys) != 0 {
			t.Fatal("redemption without valid confirmation")
		}
	}
	input := map[string]any{"confirmed": true, "idempotencyKey": key, "creditId": "card"}
	for _, next := range []string{"timeout", "alreadyRedeemed", "reset", "nothingToReset", "noCredit", "unrecognized"} {
		outcome = next
		a.rateLimits = &RateLimitsResponse{CheckedAt: time.Now().Unix()}
		code, raw := call(t, a, "POST", "/api/codex/rate-limit-reset", input)
		want := 200
		if next == "timeout" {
			want = 503
		}
		if next == "unrecognized" {
			want = 502
		}
		if code != want || a.rateLimits != nil || strings.Contains(string(raw), "private upstream") {
			t.Fatalf("%d %s", code, raw)
		}
	}
	for _, got := range keys {
		if got != key {
			t.Fatal("retry identity changed")
		}
	}
}

func TestRateLimitsFailureNeverBecomesAnAvailableQuota(t *testing.T) {
	a := testApp(t)
	for _, opening := range []bool{true, false} {
		a.openSessions = func(context.Context) (codex.SessionClient, error) {
			if opening {
				return nil, fmt.Errorf("private upstream details")
			}
			return &fakeSessionClient{request: func(string, map[string]any) (any, error) { return nil, fmt.Errorf("private upstream details") }}, nil
		}
		code, raw := call(t, a, "GET", "/api/codex/rate-limits", nil)
		if code != 503 || strings.Contains(string(raw), "private upstream") || a.rateLimits != nil {
			t.Fatalf("%d %s", code, raw)
		}
	}
}
