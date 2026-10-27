package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func iMindRequest(method, target, body string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("X-User-ID", "owner-1")
	return req
}

func iMindNoteRequest(method, target, id, body string) *http.Request {
	req := iMindRequest(method, target, body)
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("id", id)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}

func TestIMindCreatesFixedDirectoryAndListsNotes(t *testing.T) {
	h := docsShareHandler(t, t.TempDir())

	bootstrap := httptest.NewRecorder()
	h.PostIMindBootstrap(bootstrap, iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"mbp"}`))
	var boot map[string]string
	decodeDocs(t, bootstrap, http.StatusOK, &boot)
	if boot["path"] != "mbp/iMind" {
		t.Fatalf("bootstrap = %#v", boot)
	}

	create := httptest.NewRecorder()
	h.PostIMindNotes(create, iMindRequest(http.MethodPost, "/api/imind/notes", `{
		"share_machine":"mbp",
		"type":"recording",
		"title":"产品周会",
		"tags":["工作"],
		"content":"# 产品周会",
		"audio":{"duration_ms":1200,"format":"pcm_s16le","sample_rate_hz":16000}
	}`))
	var created iMindNoteResponse
	decodeDocs(t, create, http.StatusCreated, &created)
	if !strings.HasPrefix(created.Path, "mbp/iMind/") || created.ID == "" || created.Revision == "" {
		t.Fatalf("created = %#v", created)
	}

	list := httptest.NewRecorder()
	h.PostIMindNotesList(list, iMindRequest(http.MethodPost, "/api/imind/notes/list", `{"share_machine":"mbp","tag":"工作"}`))
	var result struct {
		Notes []iMindNoteResponse `json:"notes"`
	}
	decodeDocs(t, list, http.StatusOK, &result)
	if len(result.Notes) != 1 || result.Notes[0].ID != created.ID || result.Notes[0].Title != "产品周会" {
		t.Fatalf("list = %#v", result)
	}

	update := httptest.NewRecorder()
	h.PutIMindNote(update, iMindNoteRequest(http.MethodPut, "/api/imind/notes/"+created.ID, created.ID, `{
		"share_machine":"mbp",
		"revision":"`+created.Revision+`",
		"title":"产品周会（已整理）",
		"tags":["工作"],
		"content":"# 已整理",
		"transcript":"<!-- transcript: 00:00.000 -->\n会议开始"
	}`))
	var updated iMindNoteResponse
	decodeDocs(t, update, http.StatusOK, &updated)
	if updated.Title != "产品周会（已整理）" || updated.Revision == created.Revision {
		t.Fatalf("updated = %#v", updated)
	}

	deleteW := httptest.NewRecorder()
	h.DeleteIMindNote(deleteW, iMindNoteRequest(http.MethodDelete, "/api/imind/notes/"+created.ID, created.ID, `{"share_machine":"mbp","revision":"`+updated.Revision+`"}`))
	var deleted map[string]string
	decodeDocs(t, deleteW, http.StatusOK, &deleted)
	if deleted["id"] != created.ID {
		t.Fatalf("delete = %#v", deleted)
	}
}

func TestIMindRejectsUnknownShare(t *testing.T) {
	h := docsShareHandler(t, t.TempDir())
	w := httptest.NewRecorder()
	h.PostIMindBootstrap(w, iMindRequest(http.MethodPost, "/api/imind/bootstrap", `{"share_machine":"other"}`))
	var body map[string]string
	decodeDocs(t, w, http.StatusNotFound, &body)
	if body["code"] != "imind_share_not_found" {
		t.Fatalf("body = %#v", body)
	}
}
