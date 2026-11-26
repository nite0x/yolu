// Package codexcloud speaks the native Codex Cloud preview protocol. Only the
// authenticated Codex Cloud origin receives the existing Codex login.
package codexcloud

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"worktree-hub/internal/codex"
)

const (
	origin        = "https://codex-cloud-backend.chatgpt.com"
	threadService = "/oaiproto.codex_app_server_backend.ThreadService/"
	maxResponse   = 16 << 20
)

var transport = &http.Client{
	Transport:     http.DefaultTransport,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	Timeout:       150 * time.Second,
}

type Client struct {
	token    string
	account  string
	identity string
}

func Open(ctx context.Context, open func(context.Context) (codex.SessionClient, error)) (*Client, error) {
	c, err := open(ctx)
	if err != nil {
		return nil, errors.New("无法连接本机 Codex，请确认 Codex CLI 已安装")
	}
	defer c.Close()
	var account struct {
		UserID  string `json:"userId"`
		Routing *struct {
			AccountID     string `json:"chatgptAccountId"`
			BackendOrigin string `json:"backendOrigin"`
		} `json:"workspaceRouting"`
	}
	if err := c.Call("account/read", map[string]any{"refreshToken": false}, &account); err != nil || account.UserID == "" || account.Routing == nil || account.Routing.AccountID == "" {
		return nil, errors.New("请在本机 Codex 使用 ChatGPT 登录并选择工作区")
	}
	if account.Routing.BackendOrigin != "" && account.Routing.BackendOrigin != "https://chatgpt.com" && account.Routing.BackendOrigin != "https://chat.openai.com" {
		return nil, errors.New("当前 Codex 登录的区域不支持云端对话")
	}
	var auth struct {
		Method string `json:"authMethod"`
		Token  string `json:"authToken"`
	}
	err = c.Call("getAuthStatus", map[string]any{"refreshToken": false, "includeToken": true}, &auth)
	if err != nil || auth.Method != "chatgpt" || auth.Token == "" {
		return nil, errors.New("无法读取 Codex 的 ChatGPT 登录状态，请更新 Codex CLI 并检查登录")
	}
	return &Client{
		token: auth.Token, account: account.Routing.AccountID,
		identity: fmt.Sprintf("%x", sha256.Sum256([]byte(account.Routing.AccountID+"\x00"+account.UserID))),
	}, nil
}

func (c *Client) Identity() string { return c.identity }

func (c *Client) request(ctx context.Context, method, path string, body io.Reader, grpc bool) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, origin+path, body)
	if err != nil {
		return nil, errProtocol
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("ChatGPT-Account-Id", c.account)
	if grpc {
		req.Header.Set("Content-Type", "application/grpc")
		req.Header.Set("TE", "trailers")
	} else {
		req.Header.Set("X-OpenAI-Product-SKU", "codex")
	}
	res, err := transport.Do(req)
	if err != nil {
		return nil, fmt.Errorf("无法连接 Codex Cloud: %w", err)
	}
	if res.StatusCode != http.StatusOK || res.ProtoMajor != 2 {
		res.Body.Close()
		if res.StatusCode == 401 || res.StatusCode == 403 {
			return nil, errors.New("Codex Cloud 拒绝访问，请检查 ChatGPT 登录和工作区权限")
		}
		return nil, fmt.Errorf("Codex Cloud 连接失败（HTTP %d）", res.StatusCode)
	}
	return res, nil
}

func (c *Client) rpc(ctx context.Context, name string, payload message) (fields, error) {
	frame := binary.BigEndian.AppendUint32([]byte{0}, uint32(len(payload)))
	res, err := c.request(ctx, http.MethodPost, threadService+name, bytes.NewReader(append(frame, payload...)), true)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxResponse+1))
	if err != nil {
		return nil, err
	}
	status := res.Trailer.Get("Grpc-Status")
	if status == "" {
		status = res.Header.Get("Grpc-Status")
	}
	if status != "0" {
		return nil, fmt.Errorf("Codex Cloud %s 请求未确认（gRPC %s）", name, status)
	}
	if len(raw) < 5 || len(raw) > maxResponse || raw[0] != 0 || int(binary.BigEndian.Uint32(raw[1:5])) != len(raw)-5 {
		return nil, errProtocol
	}
	return decode(raw[5:])
}

type Environment struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Shared bool   `json:"shared"`
}

func (c *Client) Environments(ctx context.Context) ([]Environment, error) {
	environments := []Environment{}
	seen := map[string]bool{}
	for _, scope := range []string{"user", "workspace"} {
		query := url.Values{"scope": {scope}, "limit": {"100"}, "omitDraft": {"true"}, "view": {"picker"}}
		for range 20 {
			res, err := c.request(ctx, http.MethodGet, "/v1/environment-configs?"+query.Encode(), nil, false)
			if err != nil {
				return nil, err
			}
			var page struct {
				Data []Environment `json:"data"`
				Next string        `json:"next_cursor"`
			}
			err = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&page)
			res.Body.Close()
			if err != nil || page.Data == nil {
				return nil, errProtocol
			}
			for _, env := range page.Data {
				if env.ID == "" || strings.TrimSpace(env.Name) == "" || seen[env.ID] {
					continue
				}
				seen[env.ID] = true
				env.Shared = scope == "workspace"
				environments = append(environments, env)
			}
			if page.Next == "" {
				break
			}
			if page.Next == query.Get("cursor") {
				return nil, errProtocol
			}
			query.Set("cursor", page.Next)
		}
	}
	return environments, nil
}

type Thread struct {
	ID    string
	Cwd   string
	Model string
}

func (c *Client) Start(ctx context.Context, environment string) (Thread, error) {
	managed := message{}.text(1, environment)
	selection := message{}.bytes(1, managed)
	environments := message{}.bytes(1, selection)
	payload := message{}.bytes(10, environments).bytes(28, message{}.text(1, "codex")).number(29, 1)
	warm, err := c.rpc(ctx, "Prewarm", payload)
	if err != nil {
		return Thread{}, err
	}
	thread, err := warm.nested(14)
	if err != nil || thread.text(14) == "" {
		return Thread{}, errProtocol
	}
	return Thread{ID: thread.text(14), Cwd: warm.text(4), Model: warm.text(7)}, nil
}

func (c *Client) Send(ctx context.Context, thread, requestID, text string) (string, error) {
	input := message{}.bytes(1, message{}.bytes(1, message{}.text(1, text)))
	payload := message{}.text(4, requestID).bytes(11, input).text(23, thread).number(30, 3)
	admission, err := c.rpc(ctx, "AddUserMessage", payload)
	if err != nil {
		return "", err
	}
	turn, err := admission.nested(1)
	if err != nil || admission.text(3) != requestID || turn.text(4) == "" {
		return "", errProtocol
	}
	return turn.text(4), nil
}

func (c *Client) Interrupt(ctx context.Context, thread, turn string) error {
	_, err := c.rpc(ctx, "InterruptTurn", message{}.text(1, thread).text(2, turn))
	return err
}
