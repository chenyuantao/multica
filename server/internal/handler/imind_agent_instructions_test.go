package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/imind"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

func TestIMindBackendDistributesGuideToExistingDirectories(t *testing.T) {
	for _, initial := range []string{"", "<!-- imind:managed-agent-instructions -->\nold rules\n", "user-owned instructions\n"} {
		t.Run(initial, func(t *testing.T) {
			root := t.TempDir()
			if err := os.Mkdir(filepath.Join(root, iMindDir), 0o755); err != nil {
				t.Fatal(err)
			}
			guide := filepath.Join(root, iMindDir, "AGENTS.md")
			if initial != "" {
				if err := os.WriteFile(guide, []byte(initial), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			h := iMindTestHandler(t, root)
			for i := 0; i < 2; i++ {
				w := httptest.NewRecorder()
				h.PostIMindBootstrap(w, iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"mbp"}`))
				if w.Code != http.StatusOK {
					t.Fatalf("bootstrap = %d %s", w.Code, w.Body.String())
				}
			}
			want := imind.AgentInstructions
			if initial == "user-owned instructions\n" {
				want = initial
			}
			got, err := os.ReadFile(guide)
			if err != nil || string(got) != want {
				t.Fatalf("unexpected distributed guide: %v", err)
			}
		})
	}
}

func TestIMindBackendGuidePreservesSymlink(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, iMindDir), 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(target, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, iMindDir, "AGENTS.md")); err != nil {
		t.Fatal(err)
	}
	h := iMindTestHandler(t, root)
	w := httptest.NewRecorder()
	h.PostIMindBootstrap(w, iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"mbp"}`))
	if w.Code != http.StatusOK {
		t.Fatalf("bootstrap = %d %s", w.Code, w.Body.String())
	}
	got, err := os.ReadFile(target)
	if err != nil || string(got) != "keep" {
		t.Fatalf("symlink target changed: %v", err)
	}
}

type iMindGuideConflictPeer struct {
	fileshare.Peer
	wrote bool
}

func (p *iMindGuideConflictPeer) Call(ctx context.Context, op string, payload any, dest any) error {
	if op == fileshare.OpWrite {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		var req obsidianvault.EditRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			return err
		}
		if req.Scope != fileshare.IMindScope || req.BaseRevision == "" {
			return errors.New("guide update must carry scope and read revision")
		}
		p.wrote = true
		return obsidianvault.ErrConflict
	}
	return p.Peer.Call(ctx, op, payload, dest)
}

func TestIMindBackendGuideAcceptsConcurrentEdit(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, iMindDir), 0o755); err != nil {
		t.Fatal(err)
	}
	const old = "<!-- imind:managed-agent-instructions -->\nold rules\n"
	guide := filepath.Join(root, iMindDir, "AGENTS.md")
	if err := os.WriteFile(guide, []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}
	h := iMindTestHandler(t, root)
	peer := &iMindGuideConflictPeer{Peer: h.FileShares.Get("mbp")}
	if err := distributeIMindAgentInstructions(t.Context(), peer); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(guide)
	if !peer.wrote || err != nil || string(got) != old {
		t.Fatalf("concurrent edit was not preserved: wrote=%v err=%v", peer.wrote, err)
	}
}
