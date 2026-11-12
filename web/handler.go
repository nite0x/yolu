package web

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
)

type UISettings struct {
	Language   string
	ColorTheme string
}

// ValidColorTheme reports whether a saved appearance choice may be written into
// the page bootstrap. "system" is resolved in the browser from prefers-color-scheme.
func ValidColorTheme(theme string) bool {
	switch theme {
	case "mint", "classic", "light", "dark", "system":
		return true
	}
	return false
}

func Handler(token string, readOnly bool, settings ...func() UISettings) http.Handler {
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
		if r.URL.Query().Get("workspace-page") != "" {
			pageName = "index.html"
			// Only the internal workspace page may be framed by this origin.
			// The outer window retains frame-ancestors 'none'.
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'")
		}
		styleNonce := ""
		if r.URL.Query().Get("workspace-page") != "" && r.URL.Query().Get("workspace-terminal") == "1" {
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
		theme := "mint"
		if len(settings) > 0 {
			preferences := settings[0]()
			if preferences.Language == "en" || preferences.Language == "zh-CN" {
				choice = preferences.Language
			}
			if ValidColorTheme(preferences.ColorTheme) {
				theme = preferences.ColorTheme
			}
		}
		page = strings.ReplaceAll(page, "__UI_LANGUAGE__", choice)
		page = strings.ReplaceAll(page, "__UI_COLOR_THEME__", theme)
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
