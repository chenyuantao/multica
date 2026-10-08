package fileshare

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

func TestExecReadSkipsUnchangedBody(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(root, "node_modules"), 0o755)
	os.WriteFile(filepath.Join(root, "node_modules", "skip.md"), []byte("skip"), 0o644)

	treeRaw, err := Exec(context.Background(), root, OpTree, nil)
	if err != nil {
		t.Fatal(err)
	}
	tree := treeRaw.(obsidianvault.TreeResult)
	if len(tree.Nodes) != 1 || tree.Nodes[0].Name != "note.md" {
		t.Fatalf("tree = %#v", tree)
	}

	firstRaw, err := Exec(context.Background(), root, OpRead, []byte(`{"path":"note.md"}`))
	if err != nil {
		t.Fatal(err)
	}
	first := firstRaw.(ReadResult)
	if first.NotModified || first.Content != "hello" || first.Revision == "" {
		t.Fatalf("first = %#v", first)
	}
	again, err := Exec(context.Background(), root, OpRead, []byte(`{"path":"note.md","if_revision":"`+first.Revision+`"}`))
	if err != nil {
		t.Fatal(err)
	}
	second := again.(ReadResult)
	if !second.NotModified || second.Content != "" || second.Revision != first.Revision {
		t.Fatalf("second = %#v", second)
	}
}

func TestHubReadUsesCachedBody(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	peer := NewLocal(ShareMeta{DaemonID: "daemon-1", Machine: "mbp", OwnerUserID: "user-1", Visibility: VisibilityPrivate, Enabled: true}, root)
	hub := NewHub()
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	file, err := hub.Read(context.Background(), peer, "note.md")
	if err != nil {
		t.Fatal(err)
	}
	if file.Content != "hello" {
		t.Fatalf("content = %q", file.Content)
	}
	var sawRevision string
	counting := &countingPeer{Local: peer, onRead: func(payload any) {
		raw, _ := json.Marshal(payload)
		var req readPayload
		_ = json.Unmarshal(raw, &req)
		sawRevision = req.IfRevision
	}}
	// The hub caches against the machine name, so the second read can go
	// through a peer that records the conditional request.
	file, err = hub.Read(context.Background(), counting, "note.md")
	if err != nil {
		t.Fatal(err)
	}
	if file.Content != "hello" || sawRevision == "" {
		t.Fatalf("content = %q revision sent = %q", file.Content, sawRevision)
	}
}

type countingPeer struct {
	*Local
	onRead func(any)
}

func (p *countingPeer) Call(ctx context.Context, op string, payload any, dest any) error {
	if op == OpRead && p.onRead != nil {
		p.onRead(payload)
	}
	return p.Local.Call(ctx, op, payload, dest)
}

func TestSanitizeMachine(t *testing.T) {
	if _, err := SanitizeMachine("system"); err == nil {
		t.Fatal("system must be reserved")
	}
	if _, err := SanitizeMachine("../x"); err == nil {
		t.Fatal("parent path must be rejected")
	}
	got, err := SanitizeMachine("Tao-MBP")
	if err != nil || got != "Tao-MBP" {
		t.Fatalf("got %q err %v", got, err)
	}
}
