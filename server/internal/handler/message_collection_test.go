package handler

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
)

func TestMessageCollectionIsPrivateAndNewestFirst(t *testing.T) {
	other := groupChatWorkspaceMember(t, "Collection Other", "collection-other@multica.test")
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM message_collection WHERE workspace_id = $1`, testWorkspaceID)
	})

	var first, second MessageCollectionResponse
	testutil.Call(t, testHandler.CreateMessageCollection, groupChatRequestAs(t, testUserID, "POST", "/api/message-collections", map[string]string{
		"content":      "first line\nsecond line",
		"source_title": "Design",
		"sender_name":  "Ada",
	})).Want(http.StatusCreated).JSON(&first)
	testutil.Call(t, testHandler.CreateMessageCollection, groupChatRequestAs(t, testUserID, "POST", "/api/message-collections", map[string]string{
		"content":      "later note",
		"source_title": "Ada",
		"sender_name":  "Grace",
	})).Want(http.StatusCreated).JSON(&second)

	var listed struct {
		Collections []MessageCollectionResponse `json:"collections"`
	}
	testutil.Call(t, testHandler.ListMessageCollections, groupChatRequestAs(t, testUserID, "GET", "/api/message-collections", nil)).Want(http.StatusOK).JSON(&listed)
	if len(listed.Collections) < 2 || listed.Collections[0].ID != second.ID || listed.Collections[1].ID != first.ID {
		t.Fatalf("list = %#v, want %s then %s", listed.Collections, second.ID, first.ID)
	}
	if listed.Collections[1].Content != "first line\nsecond line" || listed.Collections[1].SourceTitle != "Design" || listed.Collections[1].SenderName != "Ada" {
		t.Fatalf("saved snapshot = %#v", listed.Collections[1])
	}

	var others struct {
		Collections []MessageCollectionResponse `json:"collections"`
	}
	testutil.Call(t, testHandler.ListMessageCollections, groupChatRequestAs(t, other, "GET", "/api/message-collections", nil)).Want(http.StatusOK).JSON(&others)
	if len(others.Collections) != 0 {
		t.Fatalf("other member saw %d collections", len(others.Collections))
	}
	testutil.Call(t, testHandler.DeleteMessageCollection, withURLParam(groupChatRequestAs(t, other, "DELETE", "/api/message-collections/"+first.ID, nil), "id", first.ID)).Want(http.StatusNotFound)
	testutil.Call(t, testHandler.DeleteMessageCollection, withURLParam(groupChatRequestAs(t, testUserID, "DELETE", "/api/message-collections/"+first.ID, nil), "id", first.ID)).Want(http.StatusNoContent)

	testutil.Call(t, testHandler.ListMessageCollections, groupChatRequestAs(t, testUserID, "GET", "/api/message-collections", nil)).Want(http.StatusOK).JSON(&listed)
	for _, item := range listed.Collections {
		if item.ID == first.ID {
			t.Fatal("deleted collection is still listed")
		}
	}
}

func TestMessageCollectionRejectsEmptyAndOversizedContent(t *testing.T) {
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM message_collection WHERE workspace_id = $1`, testWorkspaceID)
	})
	testutil.Call(t, testHandler.CreateMessageCollection, groupChatRequestAs(t, testUserID, "POST", "/api/message-collections", map[string]string{
		"content":      "   ",
		"source_title": "Design",
		"sender_name":  "Ada",
	})).Want(http.StatusBadRequest)
	testutil.Call(t, testHandler.CreateMessageCollection, groupChatRequestAs(t, testUserID, "POST", "/api/message-collections", map[string]string{
		"content":      "hello",
		"source_title": "  ",
		"sender_name":  "Ada",
	})).Want(http.StatusBadRequest)
	testutil.Call(t, testHandler.CreateMessageCollection, groupChatRequestAs(t, testUserID, "POST", "/api/message-collections", map[string]string{
		"content":      strings.Repeat("x", collectionMaxBytes+1),
		"source_title": "Design",
		"sender_name":  "Ada",
	})).Want(http.StatusBadRequest)
}
