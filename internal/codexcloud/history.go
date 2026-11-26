package codexcloud

import (
	"context"
	"strings"
)

type Turn struct {
	ID     string
	Status string
}

func (c *Client) Turns(ctx context.Context, thread string) ([]Turn, error) {
	page, err := c.rpc(ctx, "ListTurns", message{}.text(1, thread).number(3, 20).number(4, 2))
	if err != nil {
		return nil, err
	}
	rows, err := page.nested(1)
	if err != nil {
		return nil, err
	}
	turns := make([]Turn, 0, len(rows))
	for _, row := range rows {
		if row.tag != 1 {
			continue
		}
		fields, err := decode(row.data)
		if err != nil || fields.text(4) == "" {
			return nil, errProtocol
		}
		turn := Turn{ID: fields.text(4)}
		switch fields.get(8).number {
		case 1:
			turn.Status = "completed"
		case 2:
			turn.Status = "interrupted"
		case 3:
			turn.Status = "failed"
		case 4:
			turn.Status = "running"
		default:
			return nil, errProtocol
		}
		turns = append(turns, turn)
	}
	return turns, nil
}

type Item struct {
	ID, TurnID, Kind, Text, Command, Output, Status string
	StartedAtMs, CompletedAtMs                      *int64
	ExitCode                                        *int
}

func (c *Client) Items(ctx context.Context, thread, turn, cursor string) ([]Item, string, error) {
	page, err := c.rpc(ctx, "ListItems", message{}.text(1, thread).text(2, turn).text(3, cursor).number(4, 60).number(5, 2))
	if err != nil {
		return nil, "", err
	}
	rows, err := page.nested(1)
	if err != nil {
		return nil, "", err
	}
	items := []Item{}
	for i := len(rows) - 1; i >= 0; i-- {
		if rows[i].tag != 1 {
			continue
		}
		entry, err := decode(rows[i].data)
		if err != nil {
			return nil, "", err
		}
		item, err := historyItem(entry)
		if err != nil {
			return nil, "", err
		}
		if item.ID != "" && item.TurnID != "" {
			items = append(items, item)
		}
	}
	return items, page.text(2), nil
}

func historyItem(entry fields) (Item, error) {
	item := Item{TurnID: entry.text(1), StartedAtMs: entry.timestamp(3), CompletedAtMs: entry.timestamp(4)}
	raw, err := entry.nested(2)
	if err != nil || len(raw) == 0 {
		return item, err
	}
	// Tags above the item oneof carry metadata such as item timestamps.
	var variant field
	for _, candidate := range raw {
		if candidate.tag <= 19 {
			variant = candidate
		}
	}
	value, err := decode(variant.data)
	if err != nil {
		return item, err
	}
	switch variant.tag {
	case 1:
		item.ID, item.Kind = value.text(3), "user"
		input, err := value.nested(2)
		if err != nil {
			return item, err
		}
		var parts []string
		for _, part := range input {
			p, err := decode(part.data)
			if err != nil {
				return item, err
			}
			text, err := p.nested(1)
			if err != nil {
				return item, err
			}
			if text.text(1) != "" {
				parts = append(parts, text.text(1))
			}
		}
		item.Text = strings.Join(parts, "\n")
	case 3:
		item.ID, item.Kind, item.Text = value.text(2), "assistant", value.text(6)
	case 7:
		item.ID, item.Kind, item.Command, item.Output = value.text(7), "command", value.text(2), value.text(1)
		switch value.get(12).number {
		case 1:
			item.Status = "inProgress"
		case 2:
			item.Status = "completed"
		case 3:
			item.Status = "failed"
		case 4:
			item.Status = "declined"
		}
		if item.Status != "inProgress" {
			for _, f := range value {
				if f.tag == 6 {
					code := int(f.number)
					item.ExitCode = &code
				}
			}
		}
	}
	return item, nil
}

func (f fields) timestamp(tag uint64) *int64 {
	value := int64(f.get(tag).number)
	if value <= 0 {
		return nil
	}
	return &value
}
