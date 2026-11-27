package codex

import "fmt"

func ListSessions(c SessionClient, params map[string]any) (SessionPage, error) {
	params["sourceKinds"] = []string{"cli", "vscode", "appServer"}
	params["sortKey"] = "updated_at"
	params["limit"] = 50
	var page SessionPage
	err := c.Call("thread/list", params, &page)
	if page.Data == nil {
		page.Data = []Session{}
	}
	return page, err
}

func ReadSession(c SessionClient, id string) (Session, error) {
	var response struct {
		Thread Session `json:"thread"`
	}
	err := c.Call("thread/read", map[string]any{"threadId": id, "includeTurns": false}, &response)
	if err == nil && (response.Thread.ID != id || response.Thread.Cwd == "") {
		err = fmt.Errorf("对话元数据不完整，无法继续")
	}
	return response.Thread, err
}
