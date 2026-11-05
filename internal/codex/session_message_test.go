package codex

import (
	"bufio"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestSessionMessageDrainsOversizedFrameAndRetainsFollowingReply(t *testing.T) {
	reader := bufio.NewReaderSize(strings.NewReader(strings.Repeat("x", 200)+"\n{\"id\":2}\n"), 16)
	if _, err := readSessionMessage(reader, 100); !errors.Is(err, ErrSessionMessageTooLarge) {
		t.Fatalf("expected size error, got %v", err)
	}
	raw, err := readSessionMessage(reader, 100)
	if err != nil || string(raw) != "{\"id\":2}\n" {
		t.Fatalf("next reply lost: %q %v", raw, err)
	}
	if _, err := readSessionMessage(reader, 100); !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
}

func TestSessionMessageAcceptsFinalFrameWithoutNewline(t *testing.T) {
	raw, err := readSessionMessage(bufio.NewReader(strings.NewReader("{}")), 2)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("%q %v", raw, err)
	}
}
