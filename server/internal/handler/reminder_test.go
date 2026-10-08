package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func newReminder(t *testing.T, title, dueDate string) ReminderResponse {
	t.Helper()
	return newReminderWith(t, map[string]any{"title": title, "due_date": dueDate})
}

func newReminderWith(t *testing.T, body map[string]any) ReminderResponse {
	t.Helper()
	var reminder ReminderResponse
	testutil.Call(t, testHandler.CreateReminder, groupChatRequestAs(t, testUserID, "POST", "/api/reminders", body)).Want(http.StatusCreated).JSON(&reminder)
	t.Cleanup(func() {
		ctx := context.Background()
		for _, sql := range []string{
			`DELETE FROM agent_task_queue WHERE issue_id = $1`,
			`DELETE FROM inbox_item WHERE issue_id = $1`,
			`DELETE FROM issue_member WHERE issue_id = $1`,
			`DELETE FROM issue_subscriber WHERE issue_id = $1`,
			`DELETE FROM comment WHERE issue_id = $1`,
			`DELETE FROM issue WHERE id = $1`,
		} {
			testPool.Exec(ctx, sql, reminder.ID)
		}
	})
	return reminder
}

func listRemindersAs(t *testing.T, userID, query string) []ReminderResponse {
	t.Helper()
	var out struct {
		Reminders []ReminderResponse `json:"reminders"`
	}
	testutil.Call(t, testHandler.ListReminders, groupChatRequestAs(t, userID, "GET", "/api/reminders"+query, nil)).Want(http.StatusOK).JSON(&out)
	return out.Reminders
}

func postReminderMessage(t *testing.T, reminderID, content string) *testutil.Response {
	t.Helper()
	return testutil.Call(t, testHandler.CreateComment, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/issues/"+reminderID+"/comments", map[string]string{
		"content": content,
	}), "id", reminderID))
}

func hasReminder(reminders []ReminderResponse, id string) bool {
	for _, r := range reminders {
		if r.ID == id {
			return true
		}
	}
	return false
}

func TestReminderListsOnlyOnTheReminderPage(t *testing.T) {
	other := groupChatWorkspaceMember(t, "Reminder Other", "reminder-other@multica.test")
	reminder := newReminder(t, "Book the venue", "2026-10-08")
	if reminder.Status != "todo" || reminder.DueDate == nil || *reminder.DueDate != "2026-10-08" || reminder.Description != "" {
		t.Fatalf("reminder = %+v, want todo due 2026-10-08 with no description", reminder)
	}
	if len(reminder.Members) != 1 || reminder.Members[0].MemberType != "member" || reminder.Members[0].MemberID != testUserID {
		t.Fatalf("members = %+v, want only the creator", reminder.Members)
	}
	postReminderMessage(t, reminder.ID, "quasarium venue details").Want(http.StatusCreated)

	if !hasReminder(listRemindersAs(t, testUserID, "?from=2026-10-05&to=2026-10-11"), reminder.ID) {
		t.Fatal("reminder missing from its week")
	}
	if hasReminder(listRemindersAs(t, testUserID, "?from=2026-10-12&to=2026-10-18"), reminder.ID) {
		t.Fatal("reminder listed in another week")
	}
	if hasReminder(listRemindersAs(t, testUserID, "?status=done"), reminder.ID) {
		t.Fatal("open reminder listed as done")
	}
	if hasReminder(listRemindersAs(t, other, ""), reminder.ID) {
		t.Fatal("another member sees the reminder")
	}
	testutil.Call(t, testHandler.ListReminders, groupChatRequestAs(t, testUserID, "GET", "/api/reminders?status=later", nil)).Want(http.StatusBadRequest)

	var chats struct {
		Chats []GroupChatResponse `json:"chats"`
	}
	testutil.Call(t, testHandler.ListGroupChats, groupChatRequestAs(t, testUserID, "GET", "/api/group-chats", nil)).Want(http.StatusOK).JSON(&chats)
	for _, c := range chats.Chats {
		if c.ID == reminder.ID {
			t.Fatal("reminder appears in the IM chat list")
		}
	}
	var hits struct {
		Hits []GroupChatSearchHit `json:"hits"`
	}
	testutil.Call(t, testHandler.SearchGroupChats, groupChatRequestAs(t, testUserID, "GET", "/api/group-chats/search?q=quasarium", nil)).Want(http.StatusOK).JSON(&hits)
	if len(hits.Hits) != 0 {
		t.Fatalf("IM search hits = %+v, want none from the reminder", hits.Hits)
	}
	var issues struct {
		Issues []IssueResponse `json:"issues"`
	}
	testutil.Call(t, testHandler.ListIssues, newRequest("GET", "/api/issues?creator_id="+testUserID+"&limit=200", nil)).Want(http.StatusOK).JSON(&issues)
	for _, issue := range issues.Issues {
		if issue.ID == reminder.ID {
			t.Fatal("reminder appears in the issue list")
		}
	}
}

func TestReminderWithoutAgentStartsNoRun(t *testing.T) {
	reminder := newReminder(t, "Water the plants", "")
	postReminderMessage(t, reminder.ID, "every two days").Want(http.StatusCreated)
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1`, reminder.ID); n != 0 {
		t.Fatalf("tasks = %d, want none without an agent", n)
	}
}

func TestReminderMentionAddsTheAgentAndStartsIt(t *testing.T) {
	agentID := createHandlerTestAgent(t, "reminder-mentioned-agent", nil)
	reminder := newReminder(t, "Draft the launch post", "")

	testutil.Call(t, testHandler.AddGroupChatMember, withURLParam(groupChatRequestAs(t, testUserID, "POST", "/api/group-chats/"+reminder.ID+"/members", map[string]string{
		"member_type": "agent", "member_id": agentID,
	}), "id", reminder.ID)).Want(http.StatusBadRequest)

	postReminderMessage(t, reminder.ID, "[@Writer](mention://agent/"+agentID+") draft it").Want(http.StatusCreated)
	if n := dbfx.Count(t, `SELECT count(*) FROM issue_member WHERE issue_id = $1 AND member_type = 'agent' AND member_id = $2`, reminder.ID, agentID); n != 1 {
		t.Fatalf("agent memberships = %d, want the mentioned agent added", n)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, reminder.ID, agentID); n != 1 {
		t.Fatalf("tasks = %d, want one run for the mentioned agent", n)
	}

	// Mentioning it again keeps a single membership.
	postReminderMessage(t, reminder.ID, "[@Writer](mention://agent/"+agentID+") shorter please").Want(http.StatusCreated)
	if n := dbfx.Count(t, `SELECT count(*) FROM issue_member WHERE issue_id = $1 AND member_type = 'agent'`, reminder.ID); n != 1 {
		t.Fatalf("agent memberships = %d, want one", n)
	}
}

func TestReminderTitleMentionAssignsWithoutAMessage(t *testing.T) {
	agentID := createHandlerTestAgent(t, "reminder-title-agent", nil)
	title := "[@Writer](mention://agent/" + agentID + ") draft the launch post"
	reminder := newReminder(t, title, "")

	var agentMembers int
	for _, m := range reminder.Members {
		if m.MemberType == "agent" && m.MemberID == agentID {
			agentMembers++
		}
	}
	if agentMembers != 1 {
		t.Fatalf("members = %+v, want the title mention to add the agent", reminder.Members)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, reminder.ID, agentID); n != 1 {
		t.Fatalf("tasks = %d, want one run for the agent named in the title", n)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM comment WHERE issue_id = $1`, reminder.ID); n != 0 {
		t.Fatalf("comments = %d, want the title mention to assign without a message", n)
	}
}

func TestReminderTitleEditStartsOnlyNewlyMentionedAgents(t *testing.T) {
	agentID := createHandlerTestAgent(t, "reminder-title-edit-agent", nil)
	otherID := createHandlerTestAgent(t, "reminder-title-edit-other", nil)
	reminder := newReminder(t, "Draft the launch post", "")
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1`, reminder.ID); n != 0 {
		t.Fatalf("tasks = %d, want none before a mention", n)
	}

	mention := "[@Writer](mention://agent/" + agentID + ") draft the launch post"
	testutil.Call(t, testHandler.UpdateIssue, withURLParam(groupChatRequestAs(t, testUserID, "PUT", "/api/issues/"+reminder.ID, map[string]any{
		"title": mention,
	}), "id", reminder.ID)).Want(http.StatusOK)
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, reminder.ID, agentID); n != 1 {
		t.Fatalf("tasks = %d, want one run after the title gains a mention", n)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM comment WHERE issue_id = $1`, reminder.ID); n != 0 {
		t.Fatalf("comments = %d, want no message for a title assignment", n)
	}

	// Rewording keeps the same agent, so it must not start another run.
	testutil.Call(t, testHandler.UpdateIssue, withURLParam(groupChatRequestAs(t, testUserID, "PUT", "/api/issues/"+reminder.ID, map[string]any{
		"title": "[@Writer](mention://agent/" + agentID + ") shorter please",
	}), "id", reminder.ID)).Want(http.StatusOK)
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, reminder.ID, agentID); n != 1 {
		t.Fatalf("tasks = %d, want the existing run kept when the mention stays", n)
	}

	testutil.Call(t, testHandler.UpdateIssue, withURLParam(groupChatRequestAs(t, testUserID, "PUT", "/api/issues/"+reminder.ID, map[string]any{
		"title": "[@Writer](mention://agent/" + otherID + ") take a look",
	}), "id", reminder.ID)).Want(http.StatusOK)
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, reminder.ID, otherID); n != 1 {
		t.Fatalf("tasks = %d, want a run for the newly named agent", n)
	}
	if n := dbfx.Count(t, `SELECT count(*) FROM agent_task_queue WHERE issue_id = $1 AND agent_id = $2`, reminder.ID, agentID); n != 1 {
		t.Fatalf("tasks = %d, want the first agent's run left in place", n)
	}
}

func TestReminderKeepsItsDayOrderAndPendingPin(t *testing.T) {
	later := newReminderWith(t, map[string]any{"title": "Second", "due_date": "2026-10-09", "position": 5})
	first := newReminderWith(t, map[string]any{"title": "First", "due_date": "2026-10-09", "position": 1})
	if later.Position != 5 || first.Position != 1 || first.Pending || first.UpdatedAt == "" {
		t.Fatalf("created = %+v / %+v, want the given positions, not pending, with updated_at", later, first)
	}

	var order []string
	for _, r := range listRemindersAs(t, testUserID, "?from=2026-10-09&to=2026-10-09") {
		if r.ID == first.ID || r.ID == later.ID {
			order = append(order, r.ID)
		}
	}
	if len(order) != 2 || order[0] != first.ID || order[1] != later.ID {
		t.Fatalf("order = %v, want position order [%s %s]", order, first.ID, later.ID)
	}

	testutil.Call(t, testHandler.SetIssueMetadataKey, withURLParams(groupChatRequestAs(t, testUserID, "PUT", "/api/issues/"+later.ID+"/metadata/"+reminderPendingKey, map[string]any{
		"value": true,
	}), "id", later.ID, "key", reminderPendingKey)).Want(http.StatusOK)
	for _, r := range listRemindersAs(t, testUserID, "") {
		if r.ID == later.ID && !r.Pending {
			t.Fatal("pinned reminder not listed as pending")
		}
		if r.ID == first.ID && r.Pending {
			t.Fatal("unpinned reminder listed as pending")
		}
	}
}
