package typesafe

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDisabledClientDoesNotDial(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := New(Config{BaseURL: srv.URL, HTTPClient: srv.Client()})
	if c.Enabled() {
		t.Fatal("empty key should disable the client")
	}
	_, err := c.Evaluate(context.Background(), "hi", map[string]any{
		"mode": map[string]any{"type": "choice", "instructions": "x", "criteria": map[string]any{"none": "n"}},
	})
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
	if called {
		t.Fatal("disabled client dialed the server")
	}
}

func TestEvaluateParsesAnswers(t *testing.T) {
	var gotAuth, gotPath, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"model": "jev-1.13.0",
			"answers": {
				"mode": {"type": "choice", "choice": "parallel", "confidence": 0.8, "probabilities": {"parallel": 0.8, "none": 0.2}},
				"speak": {"type": "noul", "noul": 0.91}
			},
			"usage": {"input_tokens": 10, "output_tokens": 4}
		}`)
	}))
	defer srv.Close()

	c := New(Config{APIKey: "secret", BaseURL: srv.URL, Model: "jev-latest", HTTPClient: srv.Client()})
	answers, err := c.Evaluate(context.Background(), map[string]any{"latest": "hi"}, map[string]any{
		"mode": map[string]string{"type": "choice"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer secret" {
		t.Fatalf("auth = %q", gotAuth)
	}
	if gotPath != "/v1/systemone" {
		t.Fatalf("path = %q", gotPath)
	}
	if !strings.Contains(gotBody, `"model":"jev-latest"`) {
		t.Fatalf("body = %s", gotBody)
	}
	if answers["mode"].Choice != "parallel" || answers["mode"].Confidence != 0.8 {
		t.Fatalf("mode = %+v", answers["mode"])
	}
	if answers["speak"].Noul != 0.91 {
		t.Fatalf("noul = %v", answers["speak"].Noul)
	}
}

func TestEvaluateRejectsNonOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusUnauthorized)
	}))
	defer srv.Close()
	c := New(Config{APIKey: "secret", BaseURL: srv.URL, HTTPClient: srv.Client()})
	_, err := c.Evaluate(context.Background(), "x", map[string]any{"q": map[string]any{"type": "noul", "instructions": "y"}})
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("err = %v", err)
	}
}
