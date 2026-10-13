package main

import (
	"testing"
)

func TestOperateCommandsAreRegistered(t *testing.T) {
	root := newRoot()
	want := map[string]bool{"chat": false, "task": false, "reminder": false, "contact": false, "ls": false, "share": false}
	for _, cmd := range root.Commands() {
		if _, ok := want[cmd.Name()]; ok {
			want[cmd.Name()] = true
		}
	}
	for name, found := range want {
		if !found {
			t.Errorf("missing command %s", name)
		}
	}
	if root.Name() != "multica-operate" && root.Name() != "multica-file" {
		t.Fatalf("root name = %s", root.Name())
	}
}
