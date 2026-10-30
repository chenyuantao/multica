package handler

import (
	"context"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestEnsureIMindChatIsIdempotentAndFileAccessGated(t *testing.T) {
	ctx := t.Context()
	root := t.TempDir()
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{
		DaemonID: "imind-daemon-test", Machine: "imind-chat-test", OwnerUserID: testUserID,
		WorkspaceID: testWorkspaceID, Visibility: fileshare.VisibilityWorkspace, Enabled: true,
		IMindScopeRevision: true, IMindRename: true, IMindMedia: true,
	}, root)
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	h := *testHandler
	h.FileShares = hub
	memberB := groupChatWorkspaceMember(t, "iMind chat member", "imind-chat-member@multica.test")

	var note iMindNoteResponse
	createReq := groupChatRequestAs(t, testUserID, http.MethodPost, "/api/imind/notes", map[string]any{
		"share_machine": "imind-chat-test", "type": "note", "title": "Chat note", "content": "saved content",
	})
	testutil.Call(t, h.PostIMindNotes, createReq).Want(http.StatusCreated).JSON(&note)
	listUnread := func(userID string) []struct {
		ShareMachine string `json:"share_machine"`
		NoteID       string `json:"note_id"`
		IssueID      string `json:"issue_id"`
		UnreadCount  int64  `json:"unread_count"`
	} {
		t.Helper()
		var out struct {
			Chats []struct {
				ShareMachine string `json:"share_machine"`
				NoteID       string `json:"note_id"`
				IssueID      string `json:"issue_id"`
				UnreadCount  int64  `json:"unread_count"`
			} `json:"chats"`
		}
		testutil.Call(t, h.ListIMindChatUnread, groupChatRequestAs(t, userID, http.MethodGet,
			"/api/imind/chats/unread", nil)).Want(http.StatusOK).JSON(&out)
		return out.Chats
	}
	if got := listUnread(testUserID); len(got) != 0 {
		t.Fatalf("listing unread created a chat: %+v", got)
	}

	ensure := func(userID string) map[string]any {
		t.Helper()
		var out map[string]any
		testutil.Call(t, h.EnsureIMindChat, groupChatRequestAs(t, userID, http.MethodPost, "/api/imind/chats/ensure", map[string]string{
			"share_machine": "imind-chat-test", "note_id": note.ID, "revision": note.Revision,
		})).Want(http.StatusOK).JSON(&out)
		return out
	}
	results := make(chan map[string]any, 2)
	var wg sync.WaitGroup
	for _, userID := range []string{testUserID, memberB} {
		wg.Add(1)
		go func(userID string) { defer wg.Done(); results <- ensure(userID) }(userID)
	}
	wg.Wait()
	close(results)
	var pair []map[string]any
	for result := range results {
		pair = append(pair, result)
	}
	if len(pair) != 2 {
		t.Fatalf("expected 2 successful ensure responses, got %d", len(pair))
	}
	first, second := pair[0], pair[1]
	if first["issue_id"] != second["issue_id"] || first["joined"] != true || second["joined"] != true {
		t.Fatalf("ensure responses differ or did not join: first=%v second=%v", first, second)
	}
	var count int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM imind_group_chat WHERE workspace_id=$1 AND share_root_id=$2 AND note_id=$3`, testWorkspaceID, imindShareRootID(peer.Meta()), note.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("association count=%d, want 1", count)
	}
	issueID := first["issue_id"].(string)
	for _, userID := range []string{testUserID, memberB} {
		rows := listUnread(userID)
		if len(rows) != 1 || rows[0].ShareMachine != "imind-chat-test" || rows[0].NoteID != note.ID || rows[0].IssueID != issueID || rows[0].UnreadCount != 0 {
			t.Fatalf("wrong note chat unread mapping for %s: %+v", userID, rows)
		}
	}
	dbfx.Exec(t, `INSERT INTO inbox_item (workspace_id, recipient_type, recipient_id, type, title, issue_id, read, details)
		VALUES ($1, 'member', $2, 'new_comment', 'Chat note', $3, false, jsonb_build_object('comment_id', $4::text))`,
		testWorkspaceID, memberB, issueID, "00000000-0000-0000-0000-00000000c101")
	if got := listUnread(memberB)[0].UnreadCount; got != 1 {
		t.Fatalf("file chat unread count = %d, want 1", got)
	}
	testutil.Call(t, h.MarkGroupChatRead, withURLParam(groupChatRequestAs(t, memberB, http.MethodPost,
		"/api/group-chats/"+issueID+"/read", nil), "id", issueID)).Want(http.StatusOK)
	if got := listUnread(memberB)[0].UnreadCount; got != 0 {
		t.Fatalf("file chat unread count after read = %d, want 0", got)
	}
	dbfx.Cleanup(t, `DELETE FROM imind_group_chat WHERE issue_id=$1`, issueID)
	var renamed iMindNoteResponse
	renameReq := groupChatRequestAs(t, testUserID, http.MethodPut, "/api/imind/notes/"+note.ID, map[string]any{"share_machine": "imind-chat-test", "revision": note.Revision, "title": "Renamed Chat note", "content": "saved content", "transcript": ""})
	testutil.Call(t, h.PutIMindNote, withURLParam(renameReq, "id", note.ID)).Want(http.StatusOK).JSON(&renamed)
	note = renamed
	if got := ensure(testUserID); got["issue_id"] != issueID {
		t.Fatal("rename changed chat identity")
	}

	secondNoteReq := groupChatRequestAs(t, testUserID, http.MethodPost, "/api/imind/notes", map[string]any{"share_machine": "imind-chat-test", "type": "note", "title": "Different note", "content": "separate"})
	var secondNote iMindNoteResponse
	testutil.Call(t, h.PostIMindNotes, secondNoteReq).Want(http.StatusCreated).JSON(&secondNote)
	var isolated map[string]any
	testutil.Call(t, h.EnsureIMindChat, groupChatRequestAs(t, testUserID, http.MethodPost, "/api/imind/chats/ensure", map[string]string{"share_machine": "imind-chat-test", "note_id": secondNote.ID, "revision": secondNote.Revision})).Want(http.StatusOK).JSON(&isolated)
	dbfx.Cleanup(t, `DELETE FROM imind_group_chat WHERE issue_id=$1`, isolated["issue_id"])
	if isolated["issue_id"] == issueID {
		t.Fatalf("different note reused chat %s", issueID)
	}

	// Default processors are configured only by managers and apply after a
	// chat already exists. The test runtime never executes a user-installed CLI.
	agentA := createHandlerTestAgent(t, "imind-processor-a", nil)
	agentB := createHandlerTestAgent(t, "imind-processor-b", nil)
	t.Cleanup(func() {
		testPool.Exec(ctx, `UPDATE workspace SET imind_default_agent_id=NULL WHERE id=$1`, testWorkspaceID)
	})
	setDefault := func(user string, agent any, status int) {
		t.Helper()
		testutil.Call(t, h.PutIMindDefaultAgent, groupChatRequestAs(t, user, http.MethodPut, "/api/imind/settings/default-agent", map[string]any{"agent_id": agent})).Want(status)
	}
	setDefault(memberB, agentA, http.StatusForbidden)
	setDefault(testUserID, agentA, http.StatusOK)
	issue, err := h.Queries.GetIssue(ctx, parseUUID(issueID))
	if err != nil {
		t.Fatal(err)
	}
	if got, configured := h.imindDefaultProcessor(ctx, issue, parseUUID(testUserID)); !configured || uuidToString(got) != agentA {
		t.Fatal("default processor was not joined")
	}
	setDefault(testUserID, agentB, http.StatusOK)
	commentID := dbfx.Comment(t, issueID, "default processor request")
	comment, err := h.Queries.GetComment(ctx, parseUUID(commentID))
	if err != nil {
		t.Fatal(err)
	}
	h.dispatchGroupChatReply(ctx, issue, comment)
	runs, err := h.Queries.ListActiveTasksByIssue(ctx, issue.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || uuidToString(runs[0].AgentID) != agentB {
		t.Fatalf("default changed but wrong runs queued: %+v", runs)
	}
	defaultRun := runs[0]
	setDefault(testUserID, nil, http.StatusOK)
	h.GroupChatDecider = &groupChatFilterEvaluator{choice: agentA}
	isolatedIssue, err := h.Queries.GetIssue(ctx, parseUUID(isolated["issue_id"].(string)))
	if err != nil {
		t.Fatal(err)
	}
	fallbackCommentID := dbfx.Comment(t, uuidToString(isolatedIssue.ID), "JEV processor request")
	fallbackComment, err := h.Queries.GetComment(ctx, parseUUID(fallbackCommentID))
	if err != nil {
		t.Fatal(err)
	}
	h.dispatchGroupChatReply(ctx, isolatedIssue, fallbackComment)
	fallbackRuns, err := h.Queries.ListActiveTasksByIssue(ctx, isolatedIssue.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(fallbackRuns) != 1 || uuidToString(fallbackRuns[0].AgentID) != agentA {
		t.Fatalf("JEV did not enqueue selected agent: %+v", fallbackRuns)
	}
	wrongCancel := withURLParams(groupChatRequestAs(t, testUserID, http.MethodPost, "/cancel", nil), "id", issueID, "taskId", uuidToString(fallbackRuns[0].ID))
	testutil.Call(t, h.CancelTask, wrongCancel).Want(http.StatusNotFound)
	rightCancel := withURLParams(groupChatRequestAs(t, testUserID, http.MethodPost, "/cancel", nil), "id", issueID, "taskId", uuidToString(defaultRun.ID))
	testutil.Call(t, h.CancelTask, rightCancel).Want(http.StatusOK)
	var unaffected string
	if err := testPool.QueryRow(ctx, `SELECT status FROM agent_task_queue WHERE id=$1`, fallbackRuns[0].ID).Scan(&unaffected); err != nil {
		t.Fatal(err)
	}
	if unaffected == "cancelled" {
		t.Fatal("cancelling a file run affected the other file")
	}

	// Controlled executor results follow the production completion path; no
	// installed agent binary is discovered or launched by this regression.
	setDefault(testUserID, agentB, http.StatusOK)
	responseTriggerID := dbfx.Comment(t, issueID, "default response request")
	responseTrigger, err := h.Queries.GetComment(ctx, parseUUID(responseTriggerID))
	if err != nil {
		t.Fatal(err)
	}
	h.dispatchGroupChatReply(ctx, issue, responseTrigger)
	responseRuns, err := h.Queries.ListActiveTasksByIssue(ctx, issue.ID)
	if err != nil || len(responseRuns) != 1 {
		t.Fatalf("response runs=%v err=%v", responseRuns, err)
	}
	for _, result := range []struct{ runID, chatID, agentID, text string }{
		{uuidToString(responseRuns[0].ID), issueID, agentB, "default processor completed response"},
		{uuidToString(fallbackRuns[0].ID), uuidToString(isolatedIssue.ID), agentA, "JEV selected processor completed response"},
	} {
		dbfx.Exec(t, `UPDATE agent_task_queue SET status='running',started_at=now() WHERE id=$1`, result.runID)
		if _, err := h.TaskService.CompleteTask(ctx, parseUUID(result.runID), completeResult(t, result.text), "", "", "", false, "", ""); err != nil {
			t.Fatal(err)
		}
		if n := dbfx.Count(t, `SELECT count(*) FROM comment WHERE issue_id=$1 AND author_type='agent' AND author_id=$2 AND content=$3`, result.chatID, result.agentID, result.text); n != 1 {
			t.Fatalf("controlled executor reply count=%d", n)
		}
	}

	// A member's group-chat membership does not outlive access to its source file.
	hub.Unregister(peer)
	if users := h.FilterIMindChatAudience(ctx, issueID, []string{testUserID, memberB}); len(users) != 0 {
		t.Fatalf("revoked file still receives realtime: %v", users)
	}
	req := newRequestAs(testUserID, http.MethodGet, "/api/issues/"+issueID, nil)
	req = withURLParam(req, "id", issueID)
	w := httptest.NewRecorder()
	_, ok := h.loadIssueForUser(w, req, issueID)
	if ok || w.Code != http.StatusNotFound {
		t.Fatalf("revoked file access: ok=%v status=%d", ok, w.Code)
	}
}

func TestIMindShareRootIdentitySurvivesMachineRenameOnly(t *testing.T) {
	meta := fileshare.ShareMeta{OwnerUserID: "owner", DaemonID: "daemon", Machine: "old-name", Dir: "/Users/owner/Shared"}
	rename := meta
	rename.Machine = "new-name"
	if imindShareRootID(meta) != imindShareRootID(rename) {
		t.Fatal("machine nickname changed stable root identity")
	}
	otherRoot := meta
	otherRoot.Dir = "/Users/owner/Other"
	if imindShareRootID(meta) == imindShareRootID(otherRoot) {
		t.Fatal("different share root reused identity")
	}
	otherOwner := meta
	otherOwner.OwnerUserID = "other"
	if imindShareRootID(meta) == imindShareRootID(otherOwner) {
		t.Fatal("different owner reused identity")
	}
}

func TestIMindChatBindingWaitersReleasePoolConnections(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	config := testPool.Config().Copy()
	config.MaxConns = 2
	config.MinConns = 0
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	h := *testHandler
	h.TxStarter = pool
	holder, err := h.beginIMindChatBinding(ctx, "imind-pool-test")
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback(ctx)
	done := make(chan error, 1)
	go func() {
		waiter, err := h.beginIMindChatBinding(ctx, "imind-pool-test")
		if err == nil {
			err = waiter.Rollback(ctx)
		}
		done <- err
	}()
	deadline := time.Now().Add(time.Second)
	for pool.Stat().AcquireCount() < 3 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if pool.Stat().AcquireCount() < 3 {
		t.Fatal("waiter did not release and retry its connection")
	}
	createCtx, stop := context.WithTimeout(ctx, time.Second)
	defer stop()
	connection, err := pool.Acquire(createCtx)
	if err != nil {
		t.Fatalf("lock holder cannot acquire issue creation connection: %v", err)
	}
	connection.Release()
	if err := holder.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestIMindMentionJoinsAgentBeforeSendingAndOverridesProcessors(t *testing.T) {
	h := *testHandler
	hub := fileshare.NewHub()
	peer := fileshare.NewLocal(fileshare.ShareMeta{DaemonID: "mention-test", Machine: "mention-test", OwnerUserID: testUserID, WorkspaceID: testWorkspaceID, Visibility: fileshare.VisibilityWorkspace, Enabled: true, IMindScopeRevision: true, IMindRename: true, IMindMedia: true}, t.TempDir())
	if err := hub.Register(peer); err != nil {
		t.Fatal(err)
	}
	h.FileShares = hub
	processor := createHandlerTestAgent(t, "mention-default", nil)
	chosen := createHandlerTestAgent(t, "chosen agent", nil)
	archived := createHandlerTestAgent(t, "archived mention", nil)
	dbfx.Exec(t, `UPDATE agent SET archived_at=now() WHERE id=$1`, archived)
	actor := groupChatWorkspaceMember(t, "mention participant", "mention-participant@multica.test")
	dbfx.Exec(t, `UPDATE workspace SET imind_default_agent_id=$2,imind_clip_agent_id=$2 WHERE id=$1`, testWorkspaceID, processor)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `UPDATE workspace SET imind_default_agent_id=NULL,imind_clip_agent_id=NULL WHERE id=$1`, testWorkspaceID)
	})
	for _, kind := range []string{"note", "clip"} {
		t.Run(kind, func(t *testing.T) {
			var note iMindNoteResponse
			testutil.Call(t, h.PostIMindNotes, groupChatRequestAs(t, testUserID, "POST", "/notes", map[string]any{"share_machine": "mention-test", "type": kind, "title": "Mentions"})).Want(201).JSON(&note)
			var chat struct {
				ID string `json:"issue_id"`
			}
			for _, user := range []string{testUserID, actor} {
				testutil.Call(t, h.EnsureIMindChat, groupChatRequestAs(t, user, "POST", "/ensure", map[string]string{"share_machine": "mention-test", "note_id": note.ID, "revision": note.Revision})).Want(200).JSON(&chat)
			}
			dbfx.Cleanup(t, `DELETE FROM imind_group_chat WHERE issue_id=$1`, chat.ID)

			rejectedID := uuid.NewString()
			testutil.Call(t, h.CreateComment, withURLParam(groupChatRequestAs(t, actor, "POST", "/comments", map[string]string{"content": "[@archived](mention://agent/" + archived + ") process file", "client_id": rejectedID}), "id", chat.ID)).Want(400)
			if n := dbfx.Count(t, `SELECT count(*) FROM comment WHERE issue_id=$1 AND client_id=$2`, chat.ID, rejectedID); n != 0 {
				t.Fatal("failed admission saved a message")
			}
			clientID := uuid.NewString()
			for i := 0; i < 2; i++ {
				status := 201
				if i == 1 {
					status = 200
				}
				testutil.Call(t, h.CreateComment, withURLParam(groupChatRequestAs(t, actor, "POST", "/comments", map[string]string{"content": "[@chosen agent](mention://agent/" + chosen + ") please process this file", "client_id": clientID}), "id", chat.ID)).Want(status)
			}
			if n := dbfx.Count(t, `SELECT count(*) FROM issue_member WHERE issue_id=$1 AND member_type='agent' AND member_id=$2`, chat.ID, chosen); n != 1 {
				t.Fatalf("memberships=%d", n)
			}
			if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id=$1 AND agent_id=$2`, chat.ID, chosen); n != 1 {
				t.Fatalf("selected runs=%d", n)
			}
			if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id=$1 AND agent_id=$2`, chat.ID, processor); n != 0 {
				t.Fatalf("default processor intercepted explicit mention: %d", n)
			}
		})
	}
}
