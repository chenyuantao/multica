package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIMindASRUnconfigured(t *testing.T) {
	t.Setenv("DASHSCOPE_API_KEY", "")
	t.Setenv("DASHSCOPE_WORKSPACE_ID", "")
	t.Setenv("DASHSCOPE_ASR_MESSAGE_URL", "")
	h := &Handler{}
	w := httptest.NewRecorder()
	h.IMindASR(w, httptest.NewRequest(http.MethodGet, "/api/imind/asr", nil))
	if w.Code != http.StatusServiceUnavailable || !strings.Contains(w.Body.String(), "imind_asr_unconfigured") {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}
