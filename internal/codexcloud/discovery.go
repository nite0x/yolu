package codexcloud

import "context"

// ThreadSummary is metadata from the native thread navigator.
type ThreadSummary struct {
	Thread
	Name          string
	Preview       string
	EnvironmentID string
	CreatedAt     int64
	UpdatedAt     int64
}

func (c *Client) ListThreads(ctx context.Context, archived bool, cursor string) ([]ThreadSummary, string, error) {
	var archiveFlag uint64
	if archived {
		archiveFlag = 1
	}
	// Recency descending, with the backend's default sources and all originators.
	payload := message{}.text(1, cursor).number(2, 50).number(3, 3).number(4, 2).number(5, archiveFlag).bytes(6, nil)
	response, err := c.rpc(ctx, "ListThreads", payload)
	if err != nil {
		return nil, "", err
	}
	threads, err := decodeThreadSummaries(response)
	return threads, response.text(2), err
}

func decodeThreadSummaries(response fields) ([]ThreadSummary, error) {
	if response.get(1).tag == 0 {
		return nil, errProtocol
	}
	list, err := response.nested(1)
	if err != nil {
		return nil, err
	}
	threads := make([]ThreadSummary, 0, len(list))
	for _, value := range list {
		if value.tag != 1 {
			continue
		}
		thread, err := decode(value.data)
		if err != nil {
			return nil, err
		}
		if thread.text(14) == "" || thread.get(9).number != 0 {
			continue
		}
		updated := thread.get(24).number
		if updated == 0 {
			updated = thread.get(32).number
		}
		if updated == 0 {
			updated = thread.get(5).number
		}
		summary := ThreadSummary{
			Thread: Thread{ID: thread.text(14), Cwd: thread.text(6), Model: thread.text(15)},
			Name:   thread.text(17), Preview: thread.text(21),
			CreatedAt: int64(thread.get(5).number), UpdatedAt: int64(updated),
		}
		environments, err := thread.nested(8)
		if err != nil {
			return nil, err
		}
		for _, value := range environments {
			if value.tag != 1 {
				continue
			}
			environment, err := decode(value.data)
			if err != nil {
				return nil, err
			}
			id := environment.text(2)
			if id != "" && (summary.EnvironmentID == "" || environment.text(1) == summary.Cwd) {
				summary.EnvironmentID = id
			}
		}
		threads = append(threads, summary)
	}
	return threads, nil
}
