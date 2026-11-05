package web

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
)

func Handler(token string, readOnly bool, language ...func() string) http.Handler {
	static := http.FileServer(http.FS(Assets))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			static.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		pageName := "workspace.html"
		if r.URL.Query().Get("workspace-tab") != "" {
			pageName = "index.html"
			// Only the internal workspace page may be framed by this origin.
			// The outer window retains frame-ancestors 'none'.
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'")
		}
		styleNonce := ""
		if r.URL.Query().Get("workspace-tab") != "" && r.URL.Query().Get("workspace-terminal") == "1" {
			pageName = "terminal.html"
			var random [18]byte
			if _, err := rand.Read(random[:]); err != nil {
				http.Error(w, "无法创建终端页面", 500)
				return
			}
			styleNonce = base64.StdEncoding.EncodeToString(random[:])
			// WKWebView does not consistently match ws: URLs with connect-src
			// 'self'. Allow only this loopback host explicitly for terminal I/O.
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'nonce-"+styleNonce+"'; img-src 'self' data:; connect-src 'self' ws://"+r.Host+"; frame-ancestors 'self'; base-uri 'none'; form-action 'self'")
		}
		b, _ := Assets.ReadFile(pageName)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		page := strings.ReplaceAll(string(b), "__CSRF_TOKEN__", token)
		choice := "system"
		if len(language) > 0 {
			if value := language[0](); value == "en" || value == "zh-CN" {
				choice = value
			}
		}
		page = strings.ReplaceAll(page, "__UI_LANGUAGE__", choice)
		page = strings.ReplaceAll(page, "__STYLE_NONCE__", styleNonce)
		mode := "interactive"
		if readOnly {
			mode = "read-only"
			page = strings.ReplaceAll(page, `<script src="/features/sessions/session-chat.js" defer></script>`, "")
			page = strings.ReplaceAll(page, `<script src="/features/sessions/session-create.js" defer></script>`, "")
		}
		_, _ = w.Write([]byte(strings.ReplaceAll(page, "__SESSION_MODE__", mode)))
	})
}
