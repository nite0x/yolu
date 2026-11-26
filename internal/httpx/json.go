package httpx

import (
	"encoding/json"
	"io"
	"log"
	"net/http"

	"worktree-hub/internal/apitypes"
)

func Decode(w http.ResponseWriter, r *http.Request, v any) bool {
	return DecodeLimit(w, r, v, 1<<20)
}

func DecodeLimit(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		WriteError(w, 400, "请求格式不正确："+err.Error())
		return false
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		WriteError(w, 400, "请求只能包含一个 JSON 对象")
		return false
	}
	return true
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func WriteError(w http.ResponseWriter, status int, message string) {
	WriteErrorCode(w, status, "", message)
}

func WriteErrorCode(w http.ResponseWriter, status int, code, message string) {
	if code == "" {
		code = map[int]string{400: "invalid_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed", 409: "conflict", 413: "request_too_large", 429: "rate_limited", 500: "internal_error", 501: "not_supported", 503: "unavailable"}[status]
		if code == "" {
			code = "request_failed"
		}
	}
	WriteJSON(w, status, apitypes.APIErrorResponse{Error: message, Code: code, RequestID: w.Header().Get("X-Request-ID")})
}

func DbError(w http.ResponseWriter, err error) {
	log.Print(err)
	WriteErrorCode(w, 500, "storage_error", "保存数据失败，请查看服务日志")
}
