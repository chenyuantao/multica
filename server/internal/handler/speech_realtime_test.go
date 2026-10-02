package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSpeechRealtimeUnconfigured(t *testing.T) {
	t.Setenv("DASHSCOPE_API_KEY", "")
	h := &Handler{}
	req := httptest.NewRequest(http.MethodGet, "/api/speech/realtime", nil)
	w := httptest.NewRecorder()
	h.SpeechRealtime(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "speech_unconfigured") {
		t.Fatalf("body = %s", w.Body.String())
	}
}
