package codexcloud

import "testing"

func TestDecodeThreadSummaries(t *testing.T) {
	environments := message{}.
		bytes(1, message{}.text(1, "/other").text(2, "other-env")).
		bytes(1, message{}.text(1, "/workspace/apix").text(2, "apix-env"))
	thread := message{}.number(5, 42).text(6, "/workspace/apix").bytes(8, environments).
		text(14, "thread-1").text(15, "model").text(17, "Cloud task").text(21, "First message").
		number(24, 46).number(32, 44)
	ephemeral := message{}.number(9, 1).text(14, "temporary-thread")
	response, err := decode(message{}.bytes(1, message{}.bytes(1, thread).bytes(1, ephemeral)))
	if err != nil {
		t.Fatal(err)
	}
	got, err := decodeThreadSummaries(response)
	want := ThreadSummary{
		Thread: Thread{ID: "thread-1", Cwd: "/workspace/apix", Model: "model"},
		Name:   "Cloud task", Preview: "First message", EnvironmentID: "apix-env", CreatedAt: 42, UpdatedAt: 46,
	}
	if err != nil || len(got) != 1 || got[0] != want {
		t.Fatalf("summaries = %+v, error = %v", got, err)
	}
}
