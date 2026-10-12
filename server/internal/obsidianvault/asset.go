package obsidianvault

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// maxAssetBytes is the largest image a note embed may pull across the
// file-share connection. The bytes travel base64-encoded inside the JSON
// response, so this cap is the decoded size.
const maxAssetBytes = 8 << 20

// Asset is one image file from a vault. Data is standard base64.
type Asset struct {
	Path        string `json:"path"`
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Data        string `json:"data"`
}

// ReadAsset returns an image stored in the vault. rel is relative to the
// share root, which is the machine's vault root — not a note's directory.
// Only image files are readable; notes stay on Read.
func ReadAsset(ctx context.Context, root, rel string) (Asset, error) {
	if err := ctx.Err(); err != nil {
		return Asset{}, err
	}
	root, err := resolveRoot(root)
	if err != nil {
		return Asset{}, err
	}
	cleaned, err := cleanRel(rel)
	if err != nil {
		return Asset{}, err
	}
	if cleaned == "" || hasHiddenSegment(cleaned) || !isImage(path.Base(cleaned)) {
		return Asset{}, ErrNotFile
	}
	resolved, cleaned, err := open(root, cleaned)
	if err != nil {
		return Asset{}, err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Asset{}, ErrNotFound
		}
		return Asset{}, err
	}
	if info.IsDir() || !isImage(info.Name()) {
		return Asset{}, ErrNotFile
	}
	if info.Size() > maxAssetBytes {
		return Asset{}, ErrTooLarge
	}
	data, err := os.ReadFile(resolved)
	if err != nil {
		return Asset{}, err
	}
	if int64(len(data)) > maxAssetBytes {
		return Asset{}, ErrTooLarge
	}
	return Asset{
		Path:        cleaned,
		Name:        path.Base(cleaned),
		ContentType: imageContentType(path.Ext(cleaned)),
		Data:        base64.StdEncoding.EncodeToString(data),
	}, nil
}

func isImage(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico":
		return true
	default:
		return false
	}
}

func imageContentType(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".bmp":
		return "image/bmp"
	case ".avif":
		return "image/avif"
	case ".ico":
		return "image/x-icon"
	default:
		return "application/octet-stream"
	}
}
