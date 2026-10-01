package main

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/groupchat"
	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/internal/service"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/dbid"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// An agent's group chat reply is posted as a thinking bubble and later filled
// in place. The bubble must not notify, and the fill must, or a chat whose
// only other speaker is an agent (a direct chat with it) never shows unread:
// the bubble's notification is read while the user waits in the chat.
func TestNotification_GroupChatReplyNotifiesWhenFilled(t *testing.T) {
	ctx := context.Background()
	queries := db.New(testPool)
	bus := newNotificationBus(t, queries)

	subEmail := "notif-group-chat-reply@multica.ai"
	subID := createTestUser(t, subEmail)
	t.Cleanup(func() { cleanupTestUser(t, subEmail) })

	issueID := createTestIssue(t, testWorkspaceID, testUserID)
	t.Cleanup(func() {
		testPool.Exec(context.Background(), `DELETE FROM comment WHERE issue_id = $1`, issueID)
		cleanupInboxForIssue(t, issueID)
		cleanupTestIssue(t, issueID)
	})
	addTestSubscriber(t, issueID, "member", subID, "manual")

	var created []events.Event
	bus.Subscribe(protocol.EventCommentCreated, func(e events.Event) {
		created = append(created, e)
	})

	issue, err := queries.GetIssue(ctx, util.MustParseUUID(issueID))
	if err != nil {
		t.Fatalf("GetIssue: %v", err)
	}
	agentID := dbid.NewV7()
	svc := service.NewTaskService(queries, testPool, nil, bus)
	svc.OpenGroupChatThinking(ctx, issue, db.AgentTaskQueue{ID: dbid.NewV7(), AgentID: agentID})

	if len(created) != 1 {
		t.Fatalf("expected the thinking bubble to be posted once, got %d comment:created events", len(created))
	}
	bubble, _ := created[0].Payload.(map[string]any)["comment"].(map[string]any)
	bubbleID, _ := bubble["id"].(string)
	if bubble["content"] != groupchat.ThinkingMessage || bubbleID == "" {
		t.Fatalf("unexpected thinking bubble payload: %v", bubble)
	}
	if items := inboxItemsForRecipient(t, queries, subID); len(items) != 0 {
		t.Fatalf("thinking bubble created %d inbox rows, want 0", len(items))
	}

	reply := handler.CommentResponse{
		ID:         bubbleID,
		IssueID:    issueID,
		AuthorType: "agent",
		AuthorID:   util.UUIDToString(agentID),
		Content:    "the finished reply",
		Type:       "comment",
	}
	publishUpdated := func(flagged bool) {
		payload := map[string]any{
			"comment":      reply,
			"issue_title":  issue.Title,
			"issue_status": issue.Status,
		}
		if flagged {
			payload[groupchat.PayloadReply] = true
		}
		bus.Publish(events.Event{
			Type:        protocol.EventCommentUpdated,
			WorkspaceID: testWorkspaceID,
			ActorType:   "agent",
			ActorID:     util.UUIDToString(agentID),
			Payload:     payload,
		})
	}

	publishUpdated(true)
	items := inboxItemsForRecipient(t, queries, subID)
	if len(items) != 1 {
		t.Fatalf("filled reply created %d inbox rows, want 1", len(items))
	}
	if items[0].Type != "new_comment" || items[0].Body.String != "the finished reply" {
		t.Fatalf("reply notification = %q %q, want new_comment with the reply text", items[0].Type, items[0].Body.String)
	}
	var details map[string]string
	if err := json.Unmarshal(items[0].Details, &details); err != nil || details["comment_id"] != bubbleID {
		t.Fatalf("reply notification details = %s, want comment_id %s", items[0].Details, bubbleID)
	}

	publishUpdated(false)
	if items := inboxItemsForRecipient(t, queries, subID); len(items) != 1 {
		t.Fatalf("an ordinary comment edit created inbox rows: have %d, want 1", len(items))
	}
}
