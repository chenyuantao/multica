package handler

import (
	"archive/zip"
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func skillHubZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("---\nname: trip-assistant\ndescription: Plan a trip\n---\n\nAsk for the city.\n")); err != nil {
		t.Fatal(err)
	}
	script, err := zw.Create("scripts/query.js")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := script.Write([]byte("console.log('ok')\n")); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestFetchFromSkillHub(t *testing.T) {
	archive := skillHubZip(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/download" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("slug") != "@org-rdj3h8zv/ctripaitravelassistant" {
			t.Errorf("slug = %q", r.URL.Query().Get("slug"))
		}
		w.Header().Set("Content-Type", "application/zip")
		_, _ = w.Write(archive)
	}))
	defer srv.Close()

	previous := skillHubAPIBase
	skillHubAPIBase = srv.URL
	t.Cleanup(func() { skillHubAPIBase = previous })

	got, err := fetchFromSkillHub(t.Context(), srv.Client(), "https://skillhub.cn/skills/org-rdj3h8zv/ctripaitravelassistant")
	if err != nil {
		t.Fatal(err)
	}
	if got.name != "trip-assistant" || !strings.Contains(got.content, "Ask for the city.") {
		t.Fatalf("skill = %#v", got)
	}
	if len(got.files) != 1 || got.files[0].path != "scripts/query.js" {
		t.Fatalf("files = %#v", got.files)
	}
	if got.origin["type"] != "skillhub" || got.origin["slug"] != "ctripaitravelassistant" || got.origin["owner"] != "org-rdj3h8zv" {
		t.Fatalf("origin = %#v", got.origin)
	}
	if got.origin["source_url"] != "https://skillhub.cn/skills/org-rdj3h8zv/ctripaitravelassistant" {
		t.Fatalf("source_url = %#v", got.origin["source_url"])
	}
}

func TestFetchFromSkillHubRejectsForeignRedirect(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://evil.example/skill.zip", http.StatusFound)
	}))
	defer srv.Close()

	previous := skillHubAPIBase
	skillHubAPIBase = srv.URL
	t.Cleanup(func() { skillHubAPIBase = previous })

	_, err := fetchFromSkillHub(t.Context(), srv.Client(), "https://www.skillhub.cn/skills/org-rdj3h8zv/ctripaitravelassistant")
	if err == nil || !strings.Contains(err.Error(), "evil.example") {
		t.Fatalf("err = %v", err)
	}
}

func TestDetectImportSourceSkillHub(t *testing.T) {
	source, normalized, err := detectImportSource("skillhub.cn/skills/org-rdj3h8zv/ctripaitravelassistant")
	if err != nil || source != sourceSkillHub || normalized != "https://skillhub.cn/skills/org-rdj3h8zv/ctripaitravelassistant" {
		t.Fatalf("source=%v normalized=%s err=%v", source, normalized, err)
	}
	if _, _, err := detectImportSource("https://example.com/skills/a/b"); err == nil || !strings.Contains(err.Error(), "skillhub.cn") {
		t.Fatalf("err = %v", err)
	}
}
