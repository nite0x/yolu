package session

import (
	"net/http"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
)

func (a *Service) UploadAttachmentHandler(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string `json:"name"`
		Data []byte `json:"data"`
	}
	if !httpx.DecodeLimit(w, r, &input, chatRequestLimit) {
		return
	}
	if input.Data == nil {
		httpx.WriteError(w, 400, "缺少文件内容")
		return
	}
	ctx := execution.WithClient(r.Context(), a.Execution.Remote)
	path, err := execution.StoreAttachment(ctx, a.Execution.DataDir, input.Name, input.Data)
	if err != nil {
		httpx.WriteError(w, 400, "附件保存失败："+err.Error())
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"path": path})
}
