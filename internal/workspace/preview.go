package workspace

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

type FilePreview struct {
	Path    string `json:"path"`
	Text    string `json:"text"`
	Format  string `json:"format"`
	DataURL string `json:"data_url,omitempty"`
}

// ReadFilePreview reads a specific file in the execution environment. Explicit
// absolute references can be outside session roots; relative paths stay rooted.
// This does not register directories or change the agent's write permissions.
func ReadFilePreview(ctx context.Context, path string, roots []string) (FilePreview, error) {
	if c := RemoteClient(ctx); c != nil {
		var result FilePreview
		err := c.Call(ctx, Request{Op: "read-file-preview", Path: path, Args: roots}, &result)
		return result, err
	}
	if path == "" || len(path) > 4096 || strings.ContainsRune(path, 0) {
		return FilePreview{}, fmt.Errorf("文件路径无效")
	}
	var err error
	if !filepath.IsAbs(path) {
		if len(roots) == 0 {
			return FilePreview{}, fmt.Errorf("文件路径无效")
		}
		path, err = BrowserPath(roots[0], filepath.ToSlash(path))
	} else {
		path, err = filepath.EvalSymlinks(path)
	}
	if err != nil {
		return FilePreview{}, fmt.Errorf("文件不存在、已移动或不可读取")
	}
	for _, part := range strings.Split(filepath.ToSlash(path), "/") {
		if strings.EqualFold(part, ".git") {
			return FilePreview{}, fmt.Errorf("不能预览 Git 内部文件")
		}
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return FilePreview{}, fmt.Errorf("仅支持预览普通文件")
	}
	f, err := os.Open(path)
	if err != nil {
		return FilePreview{}, fmt.Errorf("文件不可读取")
	}
	defer f.Close()
	info, err = f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return FilePreview{}, fmt.Errorf("文件不可读取")
	}
	header := make([]byte, 512)
	n, err := io.ReadFull(f, header)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return FilePreview{}, err
	}
	mime := http.DetectContentType(header[:n])
	image := mime == "image/png" || mime == "image/jpeg" || mime == "image/gif" || mime == "image/webp"
	limit, message := int64(TextPreviewLimit), "文本超过 512 KiB，无法预览"
	if image {
		limit, message = ImageLimit, "图片超过 10 MiB，无法预览"
	}
	if info.Size() > limit {
		return FilePreview{}, fmt.Errorf("%s", message)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return FilePreview{}, err
	}
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return FilePreview{}, err
	}
	if int64(len(raw)) > limit {
		return FilePreview{}, fmt.Errorf("%s", message)
	}
	if image {
		return FilePreview{Path: path, Format: "image", DataURL: "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(raw)}, nil
	}
	if !utf8.Valid(raw) || strings.ContainsRune(string(raw), 0) {
		return FilePreview{}, fmt.Errorf("此文件不是 UTF-8 文本或支持的图片，无法预览")
	}
	return FilePreview{Path: path, Format: "file", Text: strings.TrimPrefix(string(raw), "\ufeff")}, nil
}
