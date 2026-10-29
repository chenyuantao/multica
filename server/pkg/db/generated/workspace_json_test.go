package db

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"reflect"
	"testing"
)

func TestWorkspaceJSONOmitsIMindCredential(t *testing.T) {
	// A fixture sentinel verifies direct and nested serialization without real secrets.
	sentinel := []byte("imind-credential-test-sentinel")
	workspace := Workspace{Name: "Visible workspace", ImindDeepseekKey: sentinel}
	field, ok := reflect.TypeOf(workspace).FieldByName("ImindDeepseekKey")
	if !ok || field.Tag.Get("json") != "-" {
		t.Fatal("workspace credential must opt out of JSON serialization")
	}
	for _, value := range []any{workspace, &workspace, []Workspace{workspace}, map[string]any{"workspace": workspace}} {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(raw, []byte("imind_deepseek_key")) || bytes.Contains(raw, sentinel) || bytes.Contains(raw, []byte(base64.StdEncoding.EncodeToString(sentinel))) {
			t.Fatal("workspace JSON exposed its credential")
		}
		if !bytes.Contains(raw, []byte("Visible workspace")) {
			t.Fatal("test did not serialize workspace")
		}
	}
}
