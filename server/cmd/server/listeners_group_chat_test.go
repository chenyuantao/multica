package main

import (
	"context"
	"sort"
	"testing"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func fakeGroupChatAudience(chats map[string][]string) groupChatAudience {
	return func(_ context.Context, issueID string) ([]string, bool) {
		userIDs, ok := chats[issueID]
		return userIDs, ok
	}
}

func recipients(fb *fakeBroadcaster) []string {
	out := make([]string, 0, len(fb.userCalls))
	for _, c := range fb.userCalls {
		out = append(out, c.userID)
	}
	sort.Strings(out)
	return out
}

func TestScopedListeners_GroupChatEventsReachOnlyMembers(t *testing.T) {
	for _, tc := range []struct {
		name    string
		typ     string
		payload any
	}{
		{"comment created", protocol.EventCommentCreated, map[string]any{"comment": map[string]any{"id": "c-1", "issue_id": "chat-1"}}},
		{"issue updated", protocol.EventIssueUpdated, map[string]any{"issue": map[string]any{"id": "chat-1"}}},
		{"top-level issue_id", protocol.EventCommentDeleted, map[string]any{"comment_id": "c-1", "issue_id": "chat-1"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bus := events.New()
			fb := &fakeBroadcaster{}
			registerScopedListeners(bus, fb, fakeGroupChatAudience(map[string][]string{"chat-1": {"u-1", "u-2"}}))

			bus.Publish(events.Event{Type: tc.typ, WorkspaceID: "ws-1", ActorType: "member", ActorID: "u-1", Payload: tc.payload})

			if len(fb.workspaceCalls) != 0 {
				t.Fatalf("group chat event reached workspace fanout: %+v", fb.workspaceCalls)
			}
			if got := recipients(fb); len(got) != 2 || got[0] != "u-1" || got[1] != "u-2" {
				t.Fatalf("recipients = %v, want [u-1 u-2]", got)
			}
		})
	}
}

func TestScopedListeners_OrdinaryIssueKeepsWorkspaceFanout(t *testing.T) {
	bus := events.New()
	fb := &fakeBroadcaster{}
	registerScopedListeners(bus, fb, fakeGroupChatAudience(map[string][]string{"chat-1": {"u-1"}}))

	bus.Publish(events.Event{
		Type: protocol.EventCommentCreated, WorkspaceID: "ws-1", ActorType: "member", ActorID: "u-1",
		Payload: map[string]any{"comment": map[string]any{"id": "c-1", "issue_id": "issue-1"}},
	})

	if len(fb.workspaceCalls) != 1 || len(fb.userCalls) != 0 {
		t.Fatalf("workspace=%d user=%d, want workspace fanout only", len(fb.workspaceCalls), len(fb.userCalls))
	}
}

func TestScopedListeners_GroupChatUpdatedRecipientOverride(t *testing.T) {
	bus := events.New()
	fb := &fakeBroadcaster{}
	registerScopedListeners(bus, fb, fakeGroupChatAudience(map[string][]string{"chat-1": {"u-1"}}))

	bus.Publish(events.Event{
		Type: protocol.EventGroupChatUpdated, WorkspaceID: "ws-1", ActorType: "member", ActorID: "u-1",
		Payload: map[string]any{"issue_id": "chat-1", "recipient_id": "removed-user"},
	})

	if got := recipients(fb); len(got) != 1 || got[0] != "removed-user" {
		t.Fatalf("recipients = %v, want only the removed person", got)
	}
	if len(fb.workspaceCalls) != 0 {
		t.Fatalf("group_chat:updated reached workspace fanout")
	}
}
