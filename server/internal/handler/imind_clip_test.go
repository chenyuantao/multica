package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/imind"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestIMindClipPlaceholderPersistsContextAndDispatchesInItsFileChat(t *testing.T) {
	ctx := t.Context()
	article := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("# 本地剪藏文章\n\n受控模型提取的正文。"))
	}))
	defer article.Close()
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{DaemonID: "clip-daemon", Machine: "clip-test", OwnerUserID: testUserID, WorkspaceID: testWorkspaceID, Visibility: fileshare.VisibilityWorkspace, Enabled: true, IMindScopeRevision: true, IMindRename: true, IMindMedia: true}, t.TempDir())
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	h := *testHandler
	h.FileShares = hub
	defaultAgent := createHandlerTestAgent(t, "clip-default", nil)
	clipAgent := createHandlerTestAgent(t, "clip-specialist", nil)
	dbfx.Exec(t, `UPDATE workspace SET imind_default_agent_id=$2,imind_clip_agent_id=$3 WHERE id=$1`, testWorkspaceID, defaultAgent, clipAgent)
	t.Cleanup(func() {
		testPool.Exec(ctx, `UPDATE workspace SET imind_default_agent_id=NULL,imind_clip_agent_id=NULL WHERE id=$1`, testWorkspaceID)
	})
	var note iMindNoteResponse
	testutil.Call(t, h.PostIMindNotes, groupChatRequestAs(t, testUserID, http.MethodPost, "/api/imind/notes", map[string]any{"share_machine": "clip-test", "type": "clip", "title": "生成中的剪藏1", "source_url": article.URL, "content": "文章 https://example.com/article", "clip": map[string]string{"original_text": "文章 https://example.com/article", "prompt": "保留要点"}})).Want(http.StatusCreated).JSON(&note)
	if note.Type != "clip" || note.Clip == nil || note.Clip.Prompt != "保留要点" {
		t.Fatalf("placeholder lost context: %+v", note)
	}
	var reopened iMindNoteResponse
	testutil.Call(t, h.PostIMindNote, groupChatRequestAs(t, testUserID, http.MethodPost, "/api/imind/notes/get", map[string]string{"share_machine": "clip-test", "id": note.ID})).Want(http.StatusOK).JSON(&reopened)
	if reopened.Clip == nil || reopened.Clip.OriginalText != note.Clip.OriginalText {
		t.Fatal("clip context not persisted")
	}
	ensure := func() string {
		t.Helper()
		var out struct {
			IssueID string `json:"issue_id"`
		}
		testutil.Call(t, h.EnsureIMindChat, groupChatRequestAs(t, testUserID, http.MethodPost, "/ensure", map[string]string{"share_machine": "clip-test", "note_id": note.ID, "revision": note.Revision})).Want(http.StatusOK).JSON(&out)
		return out.IssueID
	}
	issueID := ensure()
	dbfx.Cleanup(t, `DELETE FROM imind_group_chat WHERE issue_id=$1`, issueID)
	if ensure() != issueID {
		t.Fatal("manual reopen created a second clipping chat")
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM issue_member WHERE issue_id=$1 AND member_type='agent' AND member_id IN ($2,$3)`, issueID, defaultAgent, clipAgent); n != 2 {
		t.Fatalf("configured processors joined=%d", n)
	}
	issue, err := h.Queries.GetIssue(ctx, parseUUID(issueID))
	if err != nil {
		t.Fatal(err)
	}
	commentID := dbfx.Comment(t, issueID, "剪藏这个链接 https://example.com/article，并保留要点")
	comment, err := h.Queries.GetComment(ctx, parseUUID(commentID))
	if err != nil {
		t.Fatal(err)
	}
	h.dispatchGroupChatReply(ctx, issue, comment)
	runs, err := h.Queries.ListActiveTasksByIssue(ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || uuidToString(runs[0].AgentID) != clipAgent {
		t.Fatalf("wrong clipping processor: %+v", runs)
	}
	context, ok := h.iMindNoteContext(ctx, issue)
	if !ok || !strings.Contains(context.Text, "write the clipped article into this existing iMind file") || !strings.Contains(context.Text, note.Revision) || !strings.Contains(context.Text, "保留要点") {
		t.Fatalf("missing writeback context: %+v", context)
	}
	// A failed write retains the same on-disk placeholder and its original URL.
	badRevision := groupChatRequestAs(t, testUserID, http.MethodPut, "/note", map[string]any{"share_machine": "clip-test", "revision": "stale", "title": "Article", "content": "clipped text", "transcript": ""})
	testutil.Call(t, h.PutIMindNote, withURLParam(badRevision, "id", note.ID)).Want(http.StatusConflict)
	testutil.Call(t, h.PostIMindNote, groupChatRequestAs(t, testUserID, http.MethodPost, "/get", map[string]string{"share_machine": "clip-test", "id": note.ID})).Want(http.StatusOK).JSON(&reopened)
	if reopened.Title != note.Title || reopened.Content != note.Content {
		t.Fatal("failed write destroyed placeholder")
	}
	// No clipping override goes through JEV even with a default agent present.
	dbfx.Exec(t, `UPDATE agent_task_queue SET status='cancelled' WHERE issue_id=$1`, issueID)
	dbfx.Exec(t, `UPDATE workspace SET imind_clip_agent_id=NULL WHERE id=$1`, testWorkspaceID)
	h.GroupChatDecider = &groupChatFilterEvaluator{choice: clipAgent}
	nextID := dbfx.Comment(t, issueID, "重试剪藏")
	next, err := h.Queries.GetComment(ctx, parseUUID(nextID))
	if err != nil {
		t.Fatal(err)
	}
	h.dispatchGroupChatReply(ctx, issue, next)
	runs, err = h.Queries.ListActiveTasksByIssue(ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || uuidToString(runs[0].AgentID) != clipAgent {
		t.Fatalf("JEV fallback not used: %+v", runs)
	}

	// The controlled executor fetches only our loopback fixture, then uses the
	// same authenticated document APIs exposed to an agent to update this file.
	// Completion goes through the production task service; no CLI is discovered.
	var other iMindNoteResponse
	testutil.Call(t, h.PostIMindNotes, groupChatRequestAs(t, testUserID, http.MethodPost, "/notes", map[string]any{"share_machine": "clip-test", "type": "note", "title": "Unrelated file", "content": "untouched"})).Want(http.StatusCreated).JSON(&other)
	dbfx.Exec(t, `UPDATE agent_task_queue SET status='running',started_at=now() WHERE id=$1`, runs[0].ID)
	var saved obsidianvault.FileContent
	testutil.Call(t, h.PostDocsFileContent, groupChatRequestAs(t, testUserID, http.MethodPost, "/api/docs/files/content", map[string]string{"path": note.Path})).Want(http.StatusOK).JSON(&saved)
	modelInput, err := imind.Parse(saved.Content, strings.TrimSuffix(path.Base(saved.Path), ".md"))
	if err != nil {
		t.Fatal(err)
	}
	fetched, err := http.Get(*modelInput.SourceURL)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(fetched.Body)
	fetched.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	modelInput.Content = string(body)
	raw, err := modelInput.Markdown()
	if err != nil {
		t.Fatal(err)
	}
	testutil.Call(t, h.PatchDocsFileContent, groupChatRequestAs(t, testUserID, http.MethodPatch, "/api/docs/files/content", map[string]string{"path": saved.Path, "op": "overwrite", "content": raw, "base_revision": saved.Revision})).Want(http.StatusOK)
	testutil.Call(t, h.PostDocsRename, groupChatRequestAs(t, testUserID, http.MethodPost, "/api/docs/files/rename", map[string]string{"path": saved.Path, "name": "本地剪藏文章.md"})).Want(http.StatusOK)
	if _, err := h.TaskService.CompleteTask(ctx, runs[0].ID, completeResult(t, "已剪藏并回写同一文件"), "", "", "", false, "", ""); err != nil {
		t.Fatal(err)
	}
	testutil.Call(t, h.PostIMindNote, groupChatRequestAs(t, testUserID, http.MethodPost, "/get", map[string]string{"share_machine": "clip-test", "id": note.ID})).Want(http.StatusOK).JSON(&reopened)
	if reopened.ID != note.ID || reopened.Title != "本地剪藏文章" || reopened.Clip == nil || *reopened.Clip != *note.Clip || reopened.SourceURL == nil || *reopened.SourceURL != article.URL || reopened.Content != string(body) {
		t.Fatalf("writeback lost file identity or clip metadata: %+v", reopened)
	}
	note = reopened
	if ensure() != issueID {
		t.Fatal("writeback or rename changed file chat")
	}
	var untouched iMindNoteResponse
	testutil.Call(t, h.PostIMindNote, groupChatRequestAs(t, testUserID, http.MethodPost, "/get", map[string]string{"share_machine": "clip-test", "id": other.ID})).Want(http.StatusOK).JSON(&untouched)
	if untouched.Revision != other.Revision || untouched.Content != other.Content {
		t.Fatal("clipping changed another file")
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM comment WHERE issue_id=$1 AND author_type='agent' AND content=$2`, issueID, "已剪藏并回写同一文件"); n != 1 {
		t.Fatalf("completion not visible in file chat: %d", n)
	}
}

func TestIMindClipInstructionsOnlyApplyToClipFiles(t *testing.T) {
	if got := imindClipInstructions(imind.Note{Type: "note"}, "ref", "rev"); got != "" {
		t.Fatal(got)
	}
	note := imind.Note{Type: "clip", Content: "old clipping placeholder"}
	if got := imindClipInstructions(note, "machine/iMind/file.md", "revision"); !strings.Contains(got, note.Content) {
		t.Fatal("legacy clip lacks recoverable context")
	}
}
