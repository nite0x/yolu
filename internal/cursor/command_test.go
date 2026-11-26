package cursor

import (
	"reflect"
	"testing"
)

func TestCursorPermissionFlags(t *testing.T) {
	for _, tc := range []struct {
		permission string
		want       []string
	}{
		{"", []string{}}, {"ask", []string{"--sandbox", "enabled"}}, {"auto", []string{"--auto-review"}}, {"full", []string{"--force"}},
	} {
		got := ACPFlagsForPermission(tc.permission, []string{"/workspace/extra path"})
		want := append(tc.want, "--add-dir", "/workspace/extra path")
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%q: %v, want %v", tc.permission, got, want)
		}
	}
}
