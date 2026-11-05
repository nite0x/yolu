package session

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"worktree-hub/internal/workspace"
)

func historyImageURL(value string) (string, error) {
	raw, mime, err := decodeHistoryImage(value)
	if err != nil {
		return "", err
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(raw), nil
}

// Generation results may be bare base64 or data URLs. Sniff decoded bytes;
// neither arbitrary URLs nor active document formats become image previews.
func decodeHistoryImage(value string) ([]byte, string, error) {
	payload, declared := value, ""
	if strings.HasPrefix(value, "data:") {
		header, data, ok := strings.Cut(value, ",")
		if !ok || !strings.HasSuffix(header, ";base64") {
			return nil, "", fmt.Errorf("图片编码无效")
		}
		payload, declared = data, strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	}
	if payload == "" || len(payload) > base64.StdEncoding.EncodedLen(workspace.ImageLimit) {
		return nil, "", fmt.Errorf("图片为空或超过 10 MiB")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(payload)
	if err != nil || len(raw) == 0 || len(raw) > workspace.ImageLimit {
		return nil, "", fmt.Errorf("图片编码无效或超过 10 MiB")
	}
	mime := http.DetectContentType(raw)
	if declared != "" && declared != mime {
		return nil, "", fmt.Errorf("图片格式与内容不匹配")
	}
	switch mime {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
		return raw, mime, nil
	}
	return nil, "", fmt.Errorf("不支持此图片格式")
}

func (a *Service) generatedImagePath(key string) (string, error) {
	if len(key) != 64 {
		return "", fmt.Errorf("图片引用无效")
	}
	if _, err := hex.DecodeString(key); err != nil {
		return "", fmt.Errorf("图片引用无效")
	}
	return filepath.Join(a.Workspace.DataDir, "history-images", key), nil
}

// Cache on the Yolu host, including for remote sessions. Content addressing
// deduplicates refreshes; atomic replacement keeps concurrent readers safe.
func (a *Service) cacheHistoryImage(value string) (string, error) {
	raw, _, err := decodeHistoryImage(value)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(raw)
	key := hex.EncodeToString(hash[:])
	path, _ := a.generatedImagePath(key)
	if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() && info.Size() == int64(len(raw)) {
		return key, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return "", err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".image-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(raw)
	closeErr := f.Close()
	if err != nil {
		return "", err
	}
	if closeErr != nil {
		return "", closeErr
	}
	if err := os.Rename(f.Name(), path); err != nil {
		// Another writer may have published the same content on Windows.
		if info, statErr := os.Stat(path); statErr != nil || !info.Mode().IsRegular() || info.Size() != int64(len(raw)) {
			return "", err
		}
	}
	return key, nil
}
