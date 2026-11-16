package app

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"worktree-hub/internal/httpx"
	"worktree-hub/web"
)

const browserCookie = "yolu_browser_session"

func browserCookieName(port int) string {
	return browserCookie + "_" + strconv.Itoa(port)
}

type browserRequestKey struct{}

func isBrowserRequest(r *http.Request) bool {
	return r.Context().Value(browserRequestKey{}) == true
}

type browserConfig struct {
	Enabled bool   `json:"enabled"`
	Port    int    `json:"port"`
	Code    string `json:"code"`
}

type browserAccess struct {
	mu         sync.Mutex
	app        *App
	config     browserConfig
	listener   *browserListener
	server     *http.Server
	sessionKey string
	lastError  string
	closed     bool
}

func newBrowserAccess(a *App) *browserAccess {
	b := &browserAccess{app: a, config: browserConfig{Port: 4318}, sessionKey: rand.Text()}
	raw, err := os.ReadFile(filepath.Join(a.Workspace.DataDir, "browser-access.json"))
	if errors.Is(err, os.ErrNotExist) {
		return b
	}
	if err == nil {
		err = json.Unmarshal(raw, &b.config)
	}
	if err != nil {
		b.lastError = "无法读取浏览器访问设置"
	}
	return b
}

func (b *browserAccess) restore() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.lastError != "" {
		return errors.New(b.lastError)
	}
	if !b.config.Enabled {
		return nil
	}
	if b.config.Code == "" || b.config.Port < 1024 || b.config.Port > 65535 {
		b.lastError = "浏览器访问设置无效，请重新保存"
		return errors.New(b.lastError)
	}
	l, err := b.listen(b.config.Port)
	if err != nil {
		b.lastError = err.Error()
		return err
	}
	b.startLocked(l)
	return nil
}

func (b *browserAccess) listen(port int) (*browserListener, error) {
	l, err := net.Listen("tcp4", net.JoinHostPort("0.0.0.0", strconv.Itoa(port)))
	if err != nil {
		return nil, fmt.Errorf("无法启动浏览器访问（端口 %d）：%w", port, err)
	}
	return &browserListener{Listener: l, connections: make(map[*browserConn]struct{})}, nil
}

func (b *browserAccess) startLocked(l *browserListener) {
	srv := &http.Server{Handler: b.handler(b.app.handler()), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 64 << 10}
	b.listener, b.server = l, srv
	go func() {
		err := srv.Serve(l)
		b.mu.Lock()
		defer b.mu.Unlock()
		if b.server == srv {
			b.listener, b.server = nil, nil
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				b.lastError = err.Error()
			}
		}
	}()
}

// Bind the replacement before saving so port conflicts preserve the existing
// listener and settings. All updates, including shutdown, are serialized.
func (b *browserAccess) configure(ctx context.Context, enabled bool, port int, regenerate bool) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return errors.New("后台正在退出")
	}
	if port < 1024 || port > 65535 {
		return errors.New("端口必须在 1024 到 65535 之间")
	}
	config := browserConfig{Enabled: enabled, Port: port, Code: b.config.Code}
	if config.Code == "" || regenerate {
		config.Code = rand.Text()
	}
	var replacement *browserListener
	if enabled && (b.listener == nil || b.config.Port != port) {
		var err error
		replacement, err = b.listen(port)
		if err != nil {
			return err
		}
	}
	raw, err := json.Marshal(config)
	if err == nil {
		err = ctx.Err()
	}
	if err == nil {
		err = b.saveConfig(raw)
	}
	if err != nil {
		if replacement != nil {
			_ = replacement.Close()
		}
		return fmt.Errorf("保存浏览器访问设置失败：%w", err)
	}
	changed := config != b.config
	b.config, b.lastError = config, ""
	if changed {
		b.sessionKey = rand.Text()
	}
	if !enabled || replacement != nil {
		if b.server != nil {
			_ = b.server.Close()
		}
		b.server, b.listener = nil, nil
	} else if changed && b.listener != nil {
		b.listener.disconnect()
	}
	if replacement != nil {
		b.startLocked(replacement)
	}
	return nil
}

func (b *browserAccess) saveConfig(raw []byte) error {
	f, err := os.CreateTemp(b.app.Workspace.DataDir, ".browser-access-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(raw)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), filepath.Join(b.app.Workspace.DataDir, "browser-access.json"))
}

func (b *browserAccess) close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.closed = true
	if b.server != nil {
		_ = b.server.Close()
	}
	b.server, b.listener = nil, nil
}

func browserAddresses(port int) []string {
	addresses := []string{"http://127.0.0.1:" + strconv.Itoa(port)}
	interfaces, _ := net.InterfaceAddrs()
	for _, address := range interfaces {
		ip, _, err := net.ParseCIDR(address.String())
		if err == nil && ip.To4() != nil && !ip.IsLoopback() && !ip.IsUnspecified() {
			addresses = append(addresses, "http://"+net.JoinHostPort(ip.String(), strconv.Itoa(port)))
		}
	}
	slices.Sort(addresses)
	return slices.Compact(addresses)
}

func (a *App) browserAccessHandler(w http.ResponseWriter, r *http.Request) {
	if a.browser == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "请在主机上的 Yolu 中配置浏览器访问")
		return
	}
	canManage := !isBrowserRequest(r)
	if r.Method == http.MethodPut {
		if !canManage {
			httpx.WriteError(w, http.StatusForbidden, "请在主机上的 Yolu 中配置浏览器访问")
			return
		}
		var input struct {
			Enabled    bool `json:"enabled"`
			Port       int  `json:"port"`
			Regenerate bool `json:"regenerate_code"`
		}
		if !httpx.Decode(w, r, &input) {
			return
		}
		if err := a.browser.configure(r.Context(), input.Enabled, input.Port, input.Regenerate); err != nil {
			httpx.WriteError(w, http.StatusConflict, err.Error())
			return
		}
	}
	b := a.browser
	b.mu.Lock()
	defer b.mu.Unlock()
	code := ""
	if canManage && b.config.Enabled {
		code = b.config.Code
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"enabled": b.config.Enabled, "port": b.config.Port, "code": code,
		"running": b.server != nil, "error": b.lastError, "can_manage": canManage,
		"addresses": browserAddresses(b.config.Port),
	})
}

func browserSignature(key, value string) string {
	mac := hmac.New(sha256.New, []byte(key))
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}

func validBrowserSession(cookie *http.Cookie, key string) bool {
	if cookie == nil {
		return false
	}
	expires, signature, ok := strings.Cut(cookie.Value, ".")
	deadline, err := strconv.ParseInt(expires, 10, 64)
	return ok && err == nil && deadline > time.Now().Unix() && deadline <= time.Now().Add(24*time.Hour).Unix() &&
		hmac.Equal([]byte(signature), []byte(browserSignature(key, expires)))
}

func sameBrowserOrigin(r *http.Request) bool {
	origin, err := url.Parse(r.Header.Get("Origin"))
	return err == nil && origin.Scheme == "http" && origin.Host == r.Host
}

func (b *browserAccess) handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		b.mu.Lock()
		config, key, enabled := b.config, b.sessionKey, b.config.Enabled && !b.closed
		b.mu.Unlock()
		if !enabled {
			httpx.WriteError(w, http.StatusServiceUnavailable, "浏览器访问已关闭")
			return
		}
		address := "http://" + r.Host
		if r.Host != net.JoinHostPort("localhost", strconv.Itoa(config.Port)) && !slices.Contains(browserAddresses(config.Port), address) {
			httpx.WriteError(w, http.StatusForbidden, "浏览器访问地址无效")
			return
		}
		if r.Method == http.MethodGet && (r.URL.Path == "/ui/i18n.js" || r.URL.Path == "/core/browser-login.css" || r.URL.Path == "/yolu.svg") {
			http.FileServer(http.FS(web.Assets)).ServeHTTP(w, r)
			return
		}
		if r.URL.Path == "/browser-login" {
			b.login(w, r, config, key)
			return
		}
		cookie, _ := r.Cookie(browserCookieName(config.Port))
		if !validBrowserSession(cookie, key) {
			if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/terminal-stream/") {
				httpx.WriteError(w, http.StatusUnauthorized, "浏览器登录已过期，请刷新页面并输入配对码")
			} else {
				http.Redirect(w, r, "/browser-login", http.StatusSeeOther)
			}
			return
		}
		if r.URL.Path == "/browser-logout" {
			if r.Method != http.MethodPost || !sameBrowserOrigin(r) {
				httpx.WriteError(w, http.StatusForbidden, "拒绝跨站请求")
				return
			}
			http.SetCookie(w, &http.Cookie{Name: browserCookieName(config.Port), Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
			http.Redirect(w, r, "/browser-login", http.StatusSeeOther)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), browserRequestKey{}, true)))
	})
}

func (b *browserAccess) login(w http.ResponseWriter, r *http.Request, config browserConfig, key string) {
	failed := false
	if r.Method == http.MethodPost {
		if !sameBrowserOrigin(r) {
			httpx.WriteError(w, http.StatusForbidden, "拒绝跨站请求")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		if err := r.ParseForm(); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, "请求格式不正确")
			return
		}
		if subtle.ConstantTimeCompare([]byte(r.PostForm.Get("code")), []byte(config.Code)) == 1 {
			expires := time.Now().Add(24 * time.Hour)
			value := strconv.FormatInt(expires.Unix(), 10)
			http.SetCookie(w, &http.Cookie{Name: browserCookieName(config.Port), Value: value + "." + browserSignature(key, value),
				Path: "/", Expires: expires, MaxAge: 86400, HttpOnly: true, SameSite: http.SameSiteStrictMode})
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		failed = true
	} else if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET, POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	web.BrowserLogin(w, b.app.uiLanguage(), failed)
}
