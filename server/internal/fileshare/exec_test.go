package fileshare

import (
	"context"
	"encoding/json"
	"errors"
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

func TestExecDeleteChecksExpectedRevision(t *testing.T) {
	root := t.TempDir()
	ctx := t.Context()
	original, err := obsidianvault.Create(ctx, root, "note.md", "original")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := obsidianvault.Apply(ctx, root, obsidianvault.EditRequest{Path: "note.md", Op: "overwrite", Content: "external update", BaseRevision: original.Revision})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]string{"path": "note.md", "expected_revision": original.Revision})
	_, err = Exec(ctx, root, OpDelete, raw)
	var conflict *obsidianvault.ConflictError
	if !errors.As(err, &conflict) || conflict.Revision != updated.Revision {
		t.Fatalf("delete conflict = %v", err)
	}
	current, err := obsidianvault.Read(ctx, root, "note.md")
	if err != nil || current.Content != "external update" {
		t.Fatalf("current = %#v, err = %v", current, err)
	}
	raw, _ = json.Marshal(map[string]string{"path": "note.md", "expected_revision": updated.Revision})
	if _, err := Exec(ctx, root, OpDelete, raw); err != nil {
		t.Fatal(err)
	}
}

func TestExecIMindRejectsSymlinkEscapeWithoutChangingDocs(t *testing.T) {
	for _, linkRoot := range []bool{true, false} {
		t.Run(map[bool]string{true: "scope root", false: "note"}[linkRoot], func(t *testing.T) {
			root := t.TempDir()
			other := filepath.Join(root, "other")
			if err := os.Mkdir(other, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(other, "note.md"), []byte("keep"), 0o644); err != nil {
				t.Fatal(err)
			}
			if linkRoot {
				if err := os.Symlink(other, filepath.Join(root, "iMind")); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Mkdir(filepath.Join(root, "iMind"), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(filepath.Join(other, "note.md"), filepath.Join(root, "iMind", "note.md")); err != nil {
					t.Fatal(err)
				}
			}
			for _, op := range []string{OpRead, OpWrite, OpCreate, OpDelete} {
				raw := []byte(`{"scope":"imind","path":"iMind/note.md","op":"overwrite","content":"lost","base_revision":"old","expected_revision":"old"}`)
				if _, err := Exec(t.Context(), root, op, raw); !errors.Is(err, obsidianvault.ErrInvalidPath) {
					t.Errorf("%s error = %v", op, err)
				}
			}
			docs, err := Exec(t.Context(), root, OpRead, []byte(`{"path":"iMind/note.md"}`))
			if err != nil || docs.(ReadResult).Content != "keep" {
				t.Fatalf("docs = %#v, err = %v", docs, err)
			}
		})
	}
}

func TestExecIMindScopeRejectsPathsAndUnsupportedOperations(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "iMind"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"note.md", "other/note.md", "iMind/../note.md", "iMind/nested/note.md", "iMind/.hidden.md", `iMind/..\note.md`, "iMind", "/iMind/note.md"} {
		raw, _ := json.Marshal(map[string]string{"scope": "imind", "path": rel})
		if _, err := Exec(t.Context(), root, OpRead, raw); !errors.Is(err, obsidianvault.ErrInvalidPath) {
			t.Errorf("%q: %v", rel, err)
		}
	}
	for _, op := range []string{OpTree, OpSearch, OpMove, OpHierarchy, OpAsset} {
		if _, err := Exec(t.Context(), root, op, []byte(`{"scope":"imind","path":"iMind/note.md"}`)); !errors.Is(err, obsidianvault.ErrInvalidPath) {
			t.Errorf("%s: %v", op, err)
		}
	}
	if _, err := obsidianvault.Create(t.Context(), root, "iMind/note.md", "keep"); err != nil {
		t.Fatal(err)
	}
	if _, err := Exec(t.Context(), root, OpDelete, []byte(`{"scope":"imind","path":"iMind/note.md"}`)); !errors.Is(err, obsidianvault.ErrInvalidEdit) {
		t.Fatalf("无 revision 的 scoped delete: %v", err)
	}
	if _, err := Exec(t.Context(), root, OpRead, []byte(`{"scope":"unknown","path":"iMind/note.md"}`)); !errors.Is(err, obsidianvault.ErrInvalidPath) {
		t.Fatalf("未知 scope: %v", err)
	}
	if _, err := Exec(t.Context(), root, OpRead, []byte(`{"scope":42,"path":"iMind/note.md"}`)); !errors.Is(err, obsidianvault.ErrInvalidPath) {
		t.Fatalf("错误类型 scope: %v", err)
	}
	if _, err := Exec(t.Context(), root, OpDelete, []byte(`{"path":"iMind/note.md"}`)); err != nil {
		t.Fatalf("旧 docs delete 不兼容: %v", err)
	}
}

func TestHubScopedReadDoesNotTrustUnscopedCache(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "other"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "other", "note.md"), []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "other"), filepath.Join(root, "iMind")); err != nil {
		t.Fatal(err)
	}
	hub := NewHub()
	peer := NewLocal(ShareMeta{Machine: "mbp"}, root)
	if _, err := hub.Read(t.Context(), peer, "iMind/note.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := hub.ReadScoped(t.Context(), peer, "iMind/note.md", IMindScope); !errors.Is(err, obsidianvault.ErrInvalidPath) {
		t.Fatalf("缓存绕过 scope: %v", err)
	}
}

func TestHelloIMindCapabilityIsOptional(t *testing.T) {
	for _, capable := range []bool{false, true} {
		meta, err := AcceptHello(Envelope{Type: "hello", DaemonID: "daemon-1", Machine: "mbp", IMindScopeRevision: capable}, "owner-1")
		if err != nil || meta.IMindScopeRevision != capable {
			t.Fatalf("hello = %#v, err = %v", meta, err)
		}
	}
}

func TestSanitizeMachine(t *testing.T) {
	if _, err := SanitizeMachine("../x"); err == nil {
		t.Fatal("parent path must be rejected")
	}
	got, err := SanitizeMachine("Tao-MBP")
	if err != nil || got != "Tao-MBP" {
		t.Fatalf("got %q err %v", got, err)
	}
}
