package obsidianvault

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadAssetFromShareRoot(t *testing.T) {
	root := t.TempDir()
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a}
	writeBytes(t, root, "Images/20261012_退休大潮_图01.png", png)

	got, err := ReadAsset(context.Background(), root, "Images/20261012_退休大潮_图01.png")
	if err != nil {
		t.Fatalf("ReadAsset: %v", err)
	}
	if got.Path != "Images/20261012_退休大潮_图01.png" || got.Name != "20261012_退休大潮_图01.png" || got.ContentType != "image/png" {
		t.Fatalf("asset = %#v", got)
	}
	raw, err := base64.StdEncoding.DecodeString(got.Data)
	if err != nil || string(raw) != string(png) {
		t.Fatalf("data = %q, err = %v", raw, err)
	}
}

func TestReadAssetRejectsNotesHiddenAndEscape(t *testing.T) {
	root := t.TempDir()
	writeBytes(t, root, "Images/a.png", []byte("png"))
	writeFile(t, root, "note.md", "text")
	writeBytes(t, root, ".hidden/a.png", []byte("png"))

	ctx := context.Background()
	if _, err := ReadAsset(ctx, root, "note.md"); !errors.Is(err, ErrNotFile) {
		t.Fatalf("note err = %v", err)
	}
	if _, err := ReadAsset(ctx, root, ".hidden/a.png"); !errors.Is(err, ErrNotFile) {
		t.Fatalf("hidden err = %v", err)
	}
	if _, err := ReadAsset(ctx, root, "../Images/a.png"); !errors.Is(err, ErrInvalidPath) {
		t.Fatalf("escape err = %v", err)
	}
	if _, err := ReadAsset(ctx, root, "Images/missing.png"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing err = %v", err)
	}
}

func TestReadAssetRejectsOversizedImage(t *testing.T) {
	root := t.TempDir()
	writeBytes(t, root, "big.png", []byte(strings.Repeat("x", maxAssetBytes+1)))
	if _, err := ReadAsset(context.Background(), root, "big.png"); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("err = %v", err)
	}
}

func writeBytes(t *testing.T, root, rel string, body []byte) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, body, 0o644); err != nil {
		t.Fatal(err)
	}
}
