package handler

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/multica-ai/multica/server/internal/imindasr"
	"github.com/multica-ai/multica/server/internal/middleware"
)

func TestIMindASRUnconfigured(t *testing.T) {
	t.Setenv("DASHSCOPE_API_KEY", "")
	t.Setenv("DASHSCOPE_WORKSPACE_ID", "")
	t.Setenv("DASHSCOPE_ASR_MESSAGE_URL", "")
	h := iMindTestHandler(t, t.TempDir())
	w := httptest.NewRecorder()
	h.IMindASR(w, iMindRequest(http.MethodGet, "/api/imind/asr?share_machine=mbp", ""))
	if w.Code != http.StatusServiceUnavailable || !strings.Contains(w.Body.String(), "imind_asr_unconfigured") {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}

func TestIMindASRRejectsShareBeforeUpgrade(t *testing.T) {
	h := iMindTestHandler(t, t.TempDir())
	for _, target := range []string{"/api/imind/asr", "/api/imind/asr?share_machine=other", "/api/imind/asr?share_machine=../mbp"} {
		w := httptest.NewRecorder()
		h.IMindASR(w, iMindRequest(http.MethodGet, target, ""))
		if w.Code != http.StatusNotFound {
			t.Fatalf("status %d body %s", w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	r := iMindRequest(http.MethodGet, "/api/imind/asr?share_machine=mbp", "")
	r = r.WithContext(context.Background())
	r.Header.Set("X-Workspace-ID", "ws-1")
	h.IMindASR(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("unvalidated workspace: status %d", w.Code)
	}
}

func TestIMindHandshakeMiddlewareRejectsBeforeHandler(t *testing.T) {
	t.Setenv("JWT_SECRET", "imind-test-only-not-a-real-secret")
	h := &Handler{}
	handler := middleware.Auth(nil, nil, nil, nil)(middleware.RequireWorkspaceMember(nil)(http.HandlerFunc(h.IMindASR)))
	for _, auth := range []string{"", "Bearer not-a-jwt"} {
		r := httptest.NewRequest(http.MethodGet, "/api/imind/asr?share_machine=mbp", nil)
		r.Header.Set("Authorization", auth)
		r.Header.Set("X-User-ID", "forged-user")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status %d body %s", w.Code, w.Body.String())
		}
	}
	for _, workspace := range []string{"", "invalid-id"} {
		r := httptest.NewRequest(http.MethodGet, "/api/imind/asr?share_machine=mbp", nil)
		r.Header.Set("X-User-ID", "11111111-1111-4111-8111-111111111111")
		r.Header.Set("X-Workspace-ID", workspace)
		w := httptest.NewRecorder()
		middleware.RequireWorkspaceMember(nil)(http.HandlerFunc(h.IMindASR)).ServeHTTP(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status %d body %s", w.Code, w.Body.String())
		}
	}
}

func TestIMindRoutesRemainAuthenticatedAndWorkspaceScoped(t *testing.T) {
	_, source, _, _ := runtime.Caller(0)
	file, err := parser.ParseFile(token.NewFileSet(), filepath.Join(filepath.Dir(source), "../../cmd/server/router.go"), nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var routes int
	ast.Inspect(file, func(node ast.Node) bool {
		group, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := group.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "Group" || len(group.Args) != 1 {
			return true
		}
		body, ok := group.Args[0].(*ast.FuncLit)
		if !ok {
			return true
		}
		authenticated := false
		for _, stmt := range body.Body.List {
			if middlewareCall(stmt, "Auth") {
				authenticated = true
			}
			call := statementCall(stmt)
			if call == nil || len(call.Args) != 2 {
				continue
			}
			path, ok := call.Args[0].(*ast.BasicLit)
			if !ok || path.Value != `"/api/imind"` {
				continue
			}
			routes++
			if !authenticated {
				t.Error("iMind route is outside Auth")
			}
			inner, ok := call.Args[1].(*ast.FuncLit)
			if !ok || len(inner.Body.List) < 2 || !middlewareCall(inner.Body.List[0], "RequireWorkspaceMember") {
				t.Error("iMind route lacks workspace membership gate")
				continue
			}
			foundASR := false
			for _, route := range inner.Body.List[1:] {
				call := statementCall(route)
				if call != nil && len(call.Args) == 2 {
					path, ok := call.Args[0].(*ast.BasicLit)
					if ok && path.Value == `"/asr"` {
						foundASR = true
					}
				}
			}
			if !foundASR {
				t.Error("ASR is outside protected iMind route")
			}
		}
		return true
	})
	if routes != 1 {
		t.Fatalf("protected iMind groups = %d", routes)
	}
	ast.Inspect(file, func(node ast.Node) bool {
		lit, ok := node.(*ast.BasicLit)
		if ok && lit.Value == `"/api/imind/asr"` {
			t.Error("unprotected standalone ASR route")
		}
		return true
	})
}

func statementCall(stmt ast.Stmt) *ast.CallExpr {
	expr, ok := stmt.(*ast.ExprStmt)
	if !ok {
		return nil
	}
	call, _ := expr.X.(*ast.CallExpr)
	return call
}

func middlewareCall(stmt ast.Stmt, name string) bool {
	call := statementCall(stmt)
	if call == nil || len(call.Args) != 1 {
		return false
	}
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || selector.Sel.Name != "Use" {
		return false
	}
	inner, ok := call.Args[0].(*ast.CallExpr)
	if !ok {
		return false
	}
	selector, ok = inner.Fun.(*ast.SelectorExpr)
	return ok && selector.Sel.Name == name
}

func TestIMindASRStartReadyFinalDoneWithFakeUpstream(t *testing.T) {
	var dialed atomic.Int32
	upErrors := make(chan error, 4)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		dialed.Add(1)
		if r.Header.Get("Authorization") != "Bearer imind-fake-key" {
			upErrors <- context.Canceled
			return
		}
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			upErrors <- err
			return
		}
		defer conn.Close()
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		var run struct {
			Header struct {
				Action string `json:"action"`
				TaskID string `json:"task_id"`
			} `json:"header"`
			Payload struct {
				Model string `json:"model"`
			} `json:"payload"`
		}
		if err := conn.ReadJSON(&run); err != nil {
			upErrors <- err
			return
		}
		if run.Header.Action != "run-task" || run.Payload.Model != "qwen-audio-3.1-asr-flash-message" {
			upErrors <- context.Canceled
			return
		}
		_ = conn.WriteJSON(map[string]any{"header": map[string]string{"event": "task-started"}})
		kind, audio, err := conn.ReadMessage()
		if err != nil {
			upErrors <- err
			return
		}
		if kind != websocket.BinaryMessage || string(audio) != string([]byte{1, 2}) {
			upErrors <- context.Canceled
			return
		}
		for _, final := range []bool{false, true} {
			_ = conn.WriteJSON(map[string]any{"header": map[string]string{"event": "result-generated"}, "payload": map[string]any{"output": map[string]any{"sentence": map[string]any{"sentence_id": 0, "begin_time": 170, "end_time": 920, "text": "测试转写", "sentence_end": final}}}})
		}
		var finish struct {
			Header struct {
				Action string `json:"action"`
				TaskID string `json:"task_id"`
			} `json:"header"`
		}
		if err := conn.ReadJSON(&finish); err != nil {
			upErrors <- err
			return
		}
		if finish.Header.Action != "finish-task" || finish.Header.TaskID != run.Header.TaskID {
			upErrors <- context.Canceled
			return
		}
		_ = conn.WriteJSON(map[string]any{"header": map[string]string{"event": "task-finished"}})
	}))
	defer up.Close()
	t.Setenv("DASHSCOPE_API_KEY", "imind-fake-key")
	t.Setenv("DASHSCOPE_WORKSPACE_ID", "")
	t.Setenv("DASHSCOPE_ASR_MESSAGE_URL", "ws"+strings.TrimPrefix(up.URL, "http"))
	h := iMindTestHandler(t, t.TempDir())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fixture := iMindRequest(http.MethodGet, "/", "")
		r.Header.Set("X-User-ID", "owner-1")
		h.IMindASR(w, r.WithContext(fixture.Context()))
	}))
	defer srv.Close()
	target := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/imind/asr?share_machine=mbp"
	for _, start := range []string{
		`{"type":"start","token":"obsolete-first-frame-token"}`,
		`{"type":"start","sample_rate_hz":44100,"format":"pcm_s16le"}`,
		`{"type":"start","sample_rate_hz":16000,"format":"mp3"}`,
		`{"type":"start","sample_rate_hz":16000,"format":"pcm_s16le","language":"en"}`,
	} {
		conn, _, err := websocket.DefaultDialer.Dial(target, nil)
		if err != nil {
			t.Fatal(err)
		}
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		_ = conn.WriteMessage(websocket.TextMessage, []byte(start))
		var out imindasr.ServerMessage
		if err := conn.ReadJSON(&out); err != nil {
			t.Fatal(err)
		}
		_ = conn.Close()
		if out.Type != "error" || out.Code != "asr_invalid_start" || dialed.Load() != 0 {
			t.Fatalf("invalid start output = %#v, upstream dials = %d", out, dialed.Load())
		}
	}
	conn, _, err := websocket.DefaultDialer.Dial(target, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_ = conn.WriteJSON(map[string]any{"type": "start", "sample_rate_hz": 16000, "format": "pcm_s16le", "language": "zh"})
	var out imindasr.ServerMessage
	if err := conn.ReadJSON(&out); err != nil || out.Type != "ready" {
		t.Fatalf("ready = %#v, error = %v", out, err)
	}
	_ = conn.WriteMessage(websocket.BinaryMessage, []byte{1, 2})
	_ = conn.WriteJSON(map[string]string{"type": "stop"})
	for _, kind := range []string{"partial", "final", "done"} {
		if err := conn.ReadJSON(&out); err != nil || out.Type != kind {
			t.Fatalf("expected %s, output = %#v, error = %v", kind, out, err)
		}
		if kind != "done" && (out.StartMS == nil || *out.StartMS != 170 || out.EndMS == nil || *out.EndMS != 920 || out.SentenceID == nil || *out.SentenceID != 0) {
			t.Fatalf("timestamps = %#v", out)
		}
	}
	if dialed.Load() != 1 {
		t.Fatalf("upstream dials = %d", dialed.Load())
	}
	select {
	case err := <-upErrors:
		t.Fatalf("fake upstream failed: %v", err)
	default:
	}
}
