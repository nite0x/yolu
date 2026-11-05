package session

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"maps"
	"net/http"
	"net/url"
	"strings"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/workspace"
)

// Tokens are minted only for image references in displayable session history.
// They are scoped to a session and this backend instance, never arbitrary file
// URLs. The authenticated JSON route also preserves remote-environment routing.
func (a *Service) imageRef(session, path string) string {
	a.mediaOnce.Do(func() {
		if _, err := rand.Read(a.mediaKey[:]); err != nil {
			panic(err)
		}
	})
	encoded := base64.RawURLEncoding.EncodeToString([]byte(path))
	mac := hmac.New(sha256.New, a.mediaKey[:])
	mac.Write([]byte(session + "\x00" + encoded))
	return encoded + "." + hex.EncodeToString(mac.Sum(nil))
}
func (a *Service) prepareHistoryMedia(session string, entries []HistoryEntry) {
	for i := range entries {
		e := &entries[i]
		e.LocalImages = maps.Clone(e.LocalImages)
		// Replace inline generated/user images with short session-scoped refs.
		// Clone first: live snapshots share image slices with the active run.
		images := make([]string, 0, len(e.Images))
		for _, image := range e.Images {
			if strings.HasPrefix(image, "data:") {
				key, err := a.cacheHistoryImage(image)
				if err != nil {
					e.Text += "\n[图片暂不可读取]"
					continue
				}
				image = "/workhub-generated-images/" + key
				if e.LocalImages == nil {
					e.LocalImages = map[string]string{}
				}
				e.LocalImages[image] = a.imageRef(session, "generated:"+key)
			}
			images = append(images, image)
		}
		e.Images = images
		paths := e.LocalImagePaths
		if e.Kind == "assistant" {
			paths = append(paths, localImageSources(e.Text)...)
		}
		for _, source := range paths {
			path := source
			if p, err := url.PathUnescape(source); err == nil {
				path = p
			}
			if !platform.AbsoluteWorkspacePath(path) || len(path) > 4096 || strings.ContainsRune(path, 0) {
				continue
			}
			if e.LocalImages == nil {
				e.LocalImages = map[string]string{}
			}
			e.LocalImages[source] = a.imageRef(session, path)
		}
	}
}
func (a *Service) SessionImageHandler(w http.ResponseWriter, r *http.Request) {
	if !a.HistorySessionAllowed(w, r) {
		return
	}
	session := r.PathValue("session")
	ref := r.URL.Query().Get("ref")
	encoded, signature, ok := strings.Cut(ref, ".")
	if !ok || len(ref) > 12000 {
		httpx.WriteError(w, 403, "图片引用无效，请刷新历史")
		return
	}
	path, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil || !hmac.Equal([]byte(ref), []byte(a.imageRef(session, string(path)))) || signature == "" {
		httpx.WriteError(w, 403, "图片引用无效，请刷新历史")
		return
	}
	ctx, source := r.Context(), string(path)
	if key, cached := strings.CutPrefix(source, "generated:"); cached {
		source, err = a.generatedImagePath(key)
		if err != nil {
			httpx.WriteError(w, 403, err.Error())
			return
		}
		// This cache lives on the Yolu host, not in a remote execution root.
		ctx = context.Background()
	}
	raw, err := workspace.ReadImage(ctx, source)
	if err != nil {
		httpx.WriteError(w, 404, "图片不存在、已移动或格式不受支持")
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"data_url": "data:" + http.DetectContentType(raw) + ";base64," + base64.StdEncoding.EncodeToString(raw)})
}
func localImageSources(text string) []string {
	var out []string
	for offset := 0; offset < len(text); {
		n := strings.Index(text[offset:], "![")
		if n < 0 {
			break
		}
		begin := offset + n + 2
		end := strings.Index(text[begin:], "](")
		if end < 0 {
			break
		}
		start := begin + end + 2
		offset = start
		if start >= len(text) {
			break
		}
		var source string
		if text[start] == '<' {
			end = strings.IndexByte(text[start+1:], '>')
			if end < 0 {
				continue
			}
			source = text[start+1 : start+1+end]
			offset = start + end + 2
		} else {
			depth := 1
			end = start
			for end < len(text) {
				if text[end] == '\\' && end+1 < len(text) {
					end += 2
					continue
				}
				if text[end] == '(' {
					depth++
				}
				if text[end] == ')' {
					depth--
					if depth == 0 {
						break
					}
				}
				end++
			}
			if depth != 0 {
				continue
			}
			source = strings.TrimSpace(text[start:end])
			offset = end + 1
			if title := strings.LastIndex(source, " \""); title >= 0 && strings.HasSuffix(source, "\"") {
				source = source[:title]
			}
			source = strings.NewReplacer("\\(", "(", "\\)", ")", "\\ ", " ").Replace(source)
		}
		if source != "" {
			out = append(out, source)
		}
	}
	return out
}
