package codexcloud

import "testing"

func TestHistoryItemWithCloudMetadata(t *testing.T) {
	agent := message{}.text(2, "item-id").text(6, "Cloud reply")
	item := message{}.bytes(3, agent).number(20, 100).number(21, 200)
	raw := message{}.text(1, "turn-id").bytes(2, item).number(3, 100).number(4, 200)
	fields, err := decode(raw)
	if err != nil {
		t.Fatal(err)
	}
	got, err := historyItem(fields)
	if err != nil {
		t.Fatal(err)
	}
	if got.Kind != "assistant" || got.ID != "item-id" || got.TurnID != "turn-id" || got.Text != "Cloud reply" || got.CompletedAtMs == nil || *got.CompletedAtMs != 200 {
		t.Fatalf("cloud item metadata obscured the message: %+v", got)
	}
}
