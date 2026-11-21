package session

import (
	"crypto/hmac"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"worktree-hub/internal/codex"
)

const visualizationLimit = 1 << 20

var (
	visualizationThread = regexp.MustCompile(`^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`)
	visualizationDate   = regexp.MustCompile(`^\d{4}/\d{2}/\d{2}/`)
)

//go:embed visualization_frame.js
var visualizationRuntime string

func visualizationRelative(root, session, source string) (string, bool) {
	if root == "" || len(source) > 4096 || !filepath.IsAbs(source) || !visualizationThread.MatchString(session) {
		return "", false
	}
	rel, err := filepath.Rel(root, source)
	rel = filepath.ToSlash(rel)
	parts := strings.Split(rel, "/")
	if err != nil || !fs.ValidPath(rel) || len(parts) != 5 || !visualizationDate.MatchString(rel) || parts[3] != session || filepath.Ext(parts[4]) != ".html" {
		return "", false
	}
	return rel, true
}

func (a *Service) prepareVisualizations(session string, entry *HistoryEntry) {
	if !strings.Contains(entry.Text, "visualize") {
		return
	}
	root := codex.VisualizationRoot()
	for _, line := range strings.Split(entry.Text, "\n") {
		payload, ok := strings.CutPrefix(strings.TrimSpace(line), "visualize")
		if !ok || !strings.HasSuffix(payload, "") || len(payload) > 8192 || len(entry.Visualizations) >= 16 {
			continue
		}
		var marker struct{ Path string }
		if json.Unmarshal([]byte(strings.TrimSuffix(payload, "")), &marker) != nil {
			continue
		}
		if rel, ok := visualizationRelative(root, session, marker.Path); ok {
			if entry.Visualizations == nil {
				entry.Visualizations = make(map[string]string)
			}
			entry.Visualizations[marker.Path] = a.imageRef(session, "visualization:"+rel)
		}
	}
}

func readVisualization(root, session, relative string) ([]byte, error) {
	if !fs.ValidPath(relative) || strings.Contains(relative, `\`) {
		return nil, fs.ErrInvalid
	}
	path := filepath.Join(root, filepath.FromSlash(relative))
	if canonical, ok := visualizationRelative(root, session, path); !ok || canonical != relative {
		return nil, fs.ErrInvalid
	}
	dir, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	// A reference may only name files in its own conversation, including when
	// another directory or file is reachable through a symlink inside the root.
	parts := strings.Split(relative, "/")
	for i := range parts {
		info, err := dir.Lstat(filepath.Join(parts[:i+1]...))
		if err != nil || info.Mode()&fs.ModeSymlink != 0 || (i == len(parts)-1 && (!info.Mode().IsRegular() || info.Size() > visualizationLimit)) {
			return nil, fs.ErrInvalid
		}
	}
	f, err := dir.Open(filepath.FromSlash(relative))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	body, err := io.ReadAll(io.LimitReader(f, visualizationLimit+1))
	if err != nil || len(body) == 0 || len(body) > visualizationLimit || !utf8.Valid(body) {
		return nil, fs.ErrInvalid
	}
	return body, nil
}

func (a *Service) visualizationFrame(w http.ResponseWriter, r *http.Request) {
	session, ref := r.PathValue("session"), r.URL.Query().Get("ref")
	encoded, _, ok := strings.Cut(ref, ".")
	dest := r.Header.Get("Sec-Fetch-Dest")
	if !ok || len(ref) > 8192 || a.Execution.Remote != nil || (dest != "" && dest != "iframe") {
		http.NotFound(w, r)
		return
	}
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	rel, kind := strings.CutPrefix(string(decoded), "visualization:")
	if err != nil || !kind || !hmac.Equal([]byte(ref), []byte(a.imageRef(session, string(decoded)))) {
		http.NotFound(w, r)
		return
	}
	body, err := readVisualization(codex.VisualizationRoot(), session, rel)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-DNS-Prefetch-Control", "off")
	w.Header().Set("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `<!doctype html><meta charset="utf-8"><script>parent.postMessage({type:'yolu-visualization',unavailable:true},'*')</script>`)
		return
	}
	scheme := "light"
	if r.URL.Query().Get("theme") == "dark" {
		scheme = "dark"
	}
	_, _ = io.WriteString(w, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;color-scheme:`+scheme+`;font:14px system-ui,sans-serif}svg{vertical-align:middle}.viz-dotted-background{background-image:radial-gradient(circle,light-dark(#dce6df,#383f48) 1px,transparent 1px);background-size:16px 16px}</style><script>`+visualizationRuntime+`</script></head><body>`)
	_, _ = w.Write(body)
	_, _ = io.WriteString(w, `</body></html>`)
}
