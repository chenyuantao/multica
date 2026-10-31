package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"testing"
	"time"

	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/imind"
	"github.com/multica-ai/multica/server/internal/obsidianvault"
	"github.com/multica-ai/multica/server/internal/testutil"
	"github.com/multica-ai/multica/server/internal/util/secretbox"
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
	box, err := secretbox.New(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	h.IMindSecretBox = box
	testutil.Call(t, h.PutIMindDeepSeek, groupChatRequestAs(t, testUserID, "PUT", "/settings", map[string]string{"api_key": "test-secret"})).Want(200)
	t.Cleanup(func() {
		testPool.Exec(ctx, `UPDATE workspace SET imind_deepseek_key=NULL WHERE id=$1`, testWorkspaceID)
	})
	gate := make(chan struct{})
	defer func() {
		select {
		case <-gate:
		default:
			close(gate)
		}
	}()
	h.IMindClipHTTP = &http.Client{Transport: imindNamingTransport(func(r *http.Request) (*http.Response, error) {
		<-gate
		if r.Method != "GET" || r.URL.String() != article.URL || r.Header.Get("Authorization") != "" {
			t.Fatalf("wrong static fetch: %v", r)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/html; charset=utf-8"}}, Body: io.NopCloser(strings.NewReader("<html><title>本地文章</title><body>静态文章主题</body></html>"))}, nil
	})}
	h.IMindNamingHTTP = &http.Client{Transport: imindNamingTransport(func(r *http.Request) (*http.Response, error) {
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(payload.Messages[1].Content, "静态文章主题") || !strings.Contains(payload.Messages[1].Content, article.URL) {
			t.Fatal("naming lacks static HTML or URL")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"{\"title\":\"静态文章初始标题\",\"summary\":\"初始摘要\"}"}}]}`))}, nil
	})}

	defaultAgent := createHandlerTestAgent(t, "clip-default", nil)
	clipAgent := createHandlerTestAgent(t, "clip-specialist", nil)
	dbfx.Exec(t, `UPDATE workspace SET imind_default_agent_id=$2,imind_clip_agent_id=$3 WHERE id=$1`, testWorkspaceID, defaultAgent, clipAgent)
	t.Cleanup(func() {
		testPool.Exec(ctx, `UPDATE workspace SET imind_default_agent_id=NULL,imind_clip_agent_id=NULL WHERE id=$1`, testWorkspaceID)
	})

	var note iMindNoteResponse
	testutil.Call(t, h.PostIMindNotes, groupChatRequestAs(t, testUserID, http.MethodPost, "/api/imind/notes", map[string]any{"share_machine": "clip-test", "type": "clip", "title": "生成中的剪藏1", "source_url": article.URL, "content": "文章 https://example.com/article", "clip": map[string]string{"original_text": "文章 https://example.com/article", "prompt": "保留要点"}})).Want(http.StatusCreated).JSON(&note)
	if note.Title != "生成中的剪藏" || note.Content != "" {
		t.Fatalf("placeholder not created immediately: %+v", note)
	}
	close(gate)
	deadline := time.Now().Add(3 * time.Second)
	for {
		var current iMindNoteResponse
		testutil.Call(t, h.PostIMindNote, groupChatRequestAs(t, testUserID, "POST", "/get", map[string]string{"share_machine": "clip-test", "id": note.ID})).Want(200).JSON(&current)
		if current.Title == "静态文章初始标题" {
			if current.Revision != note.Revision {
				t.Fatal("initial naming changed the clipping revision")
			}
			note = current
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("background initial naming did not complete: %+v", current)
		}
		time.Sleep(10 * time.Millisecond)
	}
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

func TestIMindInitialClipNamingRetriesAndPreservesPlaceholder(t *testing.T) {
	h := *testHandler
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{DaemonID: "clip-retry", Machine: "clip-retry", OwnerUserID: testUserID, WorkspaceID: testWorkspaceID, Visibility: fileshare.VisibilityWorkspace, Enabled: true, IMindScopeRevision: true, IMindRename: true, IMindMedia: true}, t.TempDir())
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	h.FileShares = hub
	box, err := secretbox.New(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	h.IMindSecretBox = box
	testutil.Call(t, h.PutIMindDeepSeek, groupChatRequestAs(t, testUserID, "PUT", "/settings", map[string]string{"api_key": "test-key"})).Want(200)
	t.Cleanup(func() {
		testPool.Exec(t.Context(), `UPDATE workspace SET imind_deepseek_key=NULL WHERE id=$1`, testWorkspaceID)
	})
	for _, tc := range []struct {
		name                        string
		failFetch, failName, edited bool
		want                        string
	}{
		{"fetch failure", true, false, false, "生成中的剪藏"},
		{"model failure", false, true, false, "生成中的剪藏"},
		{"retry succeeds", false, false, false, "网页标题"},
		{"completed body wins", false, false, true, "生成中的剪藏"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var created iMindNoteResponse
			testutil.Call(t, h.PostIMindNotes, groupChatRequestAs(t, testUserID, "POST", "/notes", map[string]any{"share_machine": "clip-retry", "type": "clip", "title": "unused", "content": "original paste"})).Want(201).JSON(&created)
			file, err := h.FileShares.ReadScoped(t.Context(), peer, strings.TrimPrefix(created.Path, "clip-retry/"), fileshare.IMindScope)
			if err != nil {
				t.Fatal(err)
			}
			var chat struct {
				IssueID string `json:"issue_id"`
			}
			testutil.Call(t, h.EnsureIMindChat, groupChatRequestAs(t, testUserID, "POST", "/ensure", map[string]string{"share_machine": "clip-retry", "note_id": created.ID, "revision": created.Revision})).Want(200).JSON(&chat)
			dbfx.Cleanup(t, `DELETE FROM imind_group_chat WHERE issue_id=$1`, chat.IssueID)
			note := created.Note
			source := "https://example.com/article"
			note.SourceURL = &source
			fetches, names := 0, 0
			h.IMindClipHTTP = &http.Client{Transport: imindNamingTransport(func(*http.Request) (*http.Response, error) {
				fetches++
				status := 200
				if tc.failFetch {
					status = 403
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("<title>网页标题</title>"))}, nil
			})}
			h.IMindNamingHTTP = &http.Client{Transport: imindNamingTransport(func(*http.Request) (*http.Response, error) {
				names++
				body := `{"choices":[{"message":{"content":"{\"title\":\"网页标题\",\"summary\":\"摘要\"}"}}]}`
				if tc.failName || names == 1 {
					body = `{"choices":[]}`
				}
				if tc.edited && names == 2 {
					changed := created.Note
					changed.Content = "完整正文"
					raw, err := changed.Markdown()
					if err != nil {
						t.Fatal(err)
					}
					var out obsidianvault.FileContent
					if err := peer.Call(t.Context(), fileshare.OpWrite, obsidianvault.EditRequest{Path: file.Path, Op: "overwrite", Content: raw, BaseRevision: file.Revision, Scope: fileshare.IMindScope}, &out); err != nil {
						t.Fatal(err)
					}
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
			})}
			h.nameInitialIMindClip(t.Context(), parseUUID(testWorkspaceID), peer, note, file)
			var current iMindNoteResponse
			testutil.Call(t, h.PostIMindNote, groupChatRequestAs(t, testUserID, "POST", "/get", map[string]string{"share_machine": "clip-retry", "id": note.ID})).Want(200).JSON(&current)
			issue, err := h.Queries.GetIssue(t.Context(), parseUUID(chat.IssueID))
			if err != nil || issue.Title != "iMind · "+current.Title {
				t.Fatalf("initial naming chat title=%q filename=%q err=%v", issue.Title, current.Title, err)
			}
			if !strings.HasPrefix(current.Title, tc.want) || current.Clip == nil || current.Clip.OriginalText != "original paste" || fetches != 2 {
				t.Fatalf("unexpected result: %+v fetches=%d names=%d", current, fetches, names)
			}
			if tc.edited && current.Content != "完整正文" {
				t.Fatal("initial naming overwrote completed article")
			}
			if !tc.edited && current.Revision != file.Revision {
				t.Fatal("initial naming changed body revision")
			}
		})
	}
}
