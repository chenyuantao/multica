package fileshare

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/multica-ai/multica/server/internal/obsidianvault"
)

const (
	OpTree            = "tree"
	OpChildren        = "children"
	OpHierarchy       = "hierarchy"
	OpRead            = "read"
	OpAsset           = "asset"
	OpIMindMediaRead  = "imind_media_read"
	OpIMindMediaWrite = "imind_media_write"
	OpWrite           = "write"
	OpCreate          = "create"
	OpMove            = "move"
	OpMkdir           = "mkdir"
	OpRename          = "rename"
	OpDelete          = "delete"
	OpSearch          = "search"
)

const IMindScope = "imind"

const iMindDir = "iMind"

type pathPayload struct {
	Path string `json:"path"`
}

type deletePayload struct {
	Path             string `json:"path"`
	ExpectedRevision string `json:"expected_revision,omitempty"`
}

type readPayload struct {
	Path       string `json:"path"`
	IfRevision string `json:"if_revision,omitempty"`
	Scope      string `json:"scope,omitempty"`
}

// ReadResult is a note, or a confirmation that the caller's revision is still
// current. NotModified responses omit the body so an unchanged note is not
// copied off the machine again.
type ReadResult struct {
	obsidianvault.FileContent
	NotModified bool `json:"not_modified,omitempty"`
}

type createPayload struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type movePayload struct {
	Path string `json:"path"`
	Dest string `json:"dest"`
}

type renamePayload struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

type searchPayload struct {
	Q string `json:"q"`
}

type imindMediaPayload struct {
	Path      string `json:"path"`
	Content   []byte `json:"content,omitempty"`
	Offset    int64  `json:"offset,omitempty"`
	ChunkSize int    `json:"chunk_size,omitempty"`
	Complete  bool   `json:"complete,omitempty"`
	Size      int64  `json:"size,omitempty"`
	UploadID  string `json:"upload_id,omitempty"`
}

const imindMediaChunkSize = 512 << 10

// Exec runs one knowledge operation against a local directory. Listing and
// search stay on this machine; only the result is returned to the caller.
func Exec(ctx context.Context, root, op string, payload json.RawMessage) (any, error) {
	ctx = obsidianvault.WithSkipDirs(ctx, ShareDirs...)
	if len(payload) == 0 {
		payload = []byte(`{}`)
	}
	var scope struct {
		Scope string `json:"scope"`
	}
	if err := json.Unmarshal(payload, &scope); err != nil {
		switch op {
		case OpWrite:
			return nil, obsidianvault.ErrInvalidEdit
		case OpSearch:
			return nil, obsidianvault.ErrQueryRequired
		default:
			return nil, obsidianvault.ErrInvalidPath
		}
	}
	if scope.Scope != "" {
		if scope.Scope != IMindScope {
			return nil, obsidianvault.ErrInvalidPath
		}
		if op == OpIMindMediaRead || op == OpIMindMediaWrite {
			return execIMindMedia(root, op, payload)
		}
		return execIMind(ctx, root, op, payload)
	}
	switch op {
	case OpTree:
		return obsidianvault.Tree(ctx, root)
	case OpChildren:
		var req pathPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		return obsidianvault.Children(ctx, root, req.Path)
	case OpHierarchy:
		var req pathPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		return obsidianvault.Hierarchy(ctx, root, req.Path)
	case OpRead:
		var req readPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		file, err := obsidianvault.Read(ctx, root, req.Path)
		if err != nil {
			return nil, err
		}
		if req.IfRevision != "" && req.IfRevision == file.Revision {
			file.Content = ""
			return ReadResult{FileContent: file, NotModified: true}, nil
		}
		return ReadResult{FileContent: file}, nil
	case OpAsset:
		var req pathPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		return obsidianvault.ReadAsset(ctx, root, req.Path)
	case OpWrite:
		var req obsidianvault.EditRequest
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidEdit
		}
		return obsidianvault.Apply(ctx, root, req)
	case OpCreate:
		var req createPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		return obsidianvault.Create(ctx, root, req.Path, req.Content)
	case OpMove:
		var req movePayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		return obsidianvault.Move(ctx, root, req.Path, req.Dest)
	case OpMkdir:
		var req pathPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		return obsidianvault.Mkdir(ctx, root, req.Path)
	case OpRename:
		var req renamePayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		return obsidianvault.Rename(ctx, root, req.Path, req.Name)
	case OpDelete:
		var req deletePayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrInvalidPath
		}
		if req.ExpectedRevision != "" {
			return nil, obsidianvault.RemoveIfRevision(ctx, root, req.Path, req.ExpectedRevision)
		}
		return nil, obsidianvault.Remove(ctx, root, req.Path)
	case OpSearch:
		var req searchPayload
		if err := json.Unmarshal(payload, &req); err != nil {
			return nil, obsidianvault.ErrQueryRequired
		}
		return obsidianvault.Search(ctx, root, req.Q)
	default:
		return nil, obsidianvault.ErrInvalidPath
	}
}

// execIMindMedia confines binary assets to iMind/media/<note UUID>/<file>.
func execIMindMedia(root, op string, payload json.RawMessage) (any, error) {
	var req imindMediaPayload
	if err := json.Unmarshal(payload, &req); err != nil || !validIMindMediaPath(req.Path) {
		return nil, obsidianvault.ErrInvalidPath
	}
	sharedRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, obsidianvault.ErrUnavailable
	}
	sharedRoot, err = filepath.EvalSymlinks(sharedRoot)
	if err != nil {
		return nil, obsidianvault.ErrUnavailable
	}
	// Resolve each directory without following a link, including the existing iMind root.
	dirs := []string{filepath.Join(sharedRoot, iMindDir), filepath.Join(sharedRoot, iMindDir, "media"), filepath.Join(sharedRoot, iMindDir, "media", strings.Split(req.Path, "/")[2])}
	for _, dir := range dirs {
		info, statErr := os.Lstat(dir)
		if errors.Is(statErr, os.ErrNotExist) && op == OpIMindMediaWrite {
			if err := os.Mkdir(dir, 0700); err != nil && !errors.Is(err, os.ErrExist) {
				return nil, err
			}
			info, statErr = os.Lstat(dir)
		}
		if statErr != nil {
			return nil, obsidianvault.ErrNotFound
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, obsidianvault.ErrInvalidPath
		}
		if !info.IsDir() {
			return nil, obsidianvault.ErrNotDir
		}
	}
	target := filepath.Join(sharedRoot, filepath.FromSlash(req.Path))
	info, statErr := os.Lstat(target)
	if statErr == nil && (!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0) {
		return nil, obsidianvault.ErrInvalidPath
	}
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return nil, statErr
	}
	maxSize := int64(16 << 20)
	if filepath.Base(target) == "audio.wav" {
		maxSize = 64 << 20
	}
	if statErr == nil && info.Size() > maxSize {
		return nil, obsidianvault.ErrInvalidEdit
	}
	if op == OpIMindMediaRead {
		if statErr != nil {
			return nil, obsidianvault.ErrNotFound
		}
		if req.Offset < 0 || req.Offset > info.Size() {
			return nil, obsidianvault.ErrInvalidPath
		}
		chunkSize := req.ChunkSize
		if chunkSize <= 0 || chunkSize > imindMediaChunkSize {
			chunkSize = imindMediaChunkSize
		}
		file, err := os.Open(target)
		if errors.Is(err, os.ErrNotExist) {
			return nil, obsidianvault.ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		defer file.Close()
		length := int64(chunkSize)
		if remain := info.Size() - req.Offset; remain < length {
			length = remain
		}
		data := make([]byte, length)
		if _, err := file.ReadAt(data, req.Offset); err != nil && !errors.Is(err, io.EOF) {
			return nil, err
		}
		return imindMediaPayload{Path: req.Path, Content: data, Offset: req.Offset, Size: info.Size(), Complete: req.Offset+length >= info.Size()}, nil
	}
	if op != OpIMindMediaWrite || len(req.Content) == 0 || len(req.Content) > imindMediaChunkSize || req.Offset < 0 {
		return nil, obsidianvault.ErrInvalidEdit
	}
	if len(req.UploadID) != 32 {
		return nil, obsidianvault.ErrInvalidEdit
	}
	for _, c := range req.UploadID {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return nil, obsidianvault.ErrInvalidEdit
		}
	}
	part := filepath.Join(filepath.Dir(target), ".imind-upload-"+req.UploadID)
	partInfo, partErr := os.Lstat(part)
	if partErr == nil && (partInfo.Mode()&os.ModeSymlink != 0 || !partInfo.Mode().IsRegular()) {
		return nil, obsidianvault.ErrInvalidPath
	}
	if partErr != nil && !errors.Is(partErr, os.ErrNotExist) {
		return nil, partErr
	}
	flags := os.O_WRONLY | os.O_CREATE
	if req.Offset == 0 {
		flags |= os.O_TRUNC
	} else {
		flags |= os.O_APPEND
	}
	tmp, err := os.OpenFile(part, flags, 0600)
	if err != nil {
		return nil, err
	}
	info, err = tmp.Stat()
	if err != nil {
		tmp.Close()
		return nil, err
	}
	if info.Size() != req.Offset || req.Offset+int64(len(req.Content)) > maxSize {
		tmp.Close()
		return nil, obsidianvault.ErrInvalidEdit
	}
	if _, err := tmp.Write(req.Content); err != nil {
		tmp.Close()
		return nil, err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return nil, err
	}
	if err := tmp.Close(); err != nil {
		return nil, err
	}
	newSize := req.Offset + int64(len(req.Content))
	if req.Complete {
		if err := os.Rename(part, target); err != nil {
			return nil, err
		}
	}
	return map[string]any{"path": req.Path, "size": newSize, "complete": req.Complete}, nil
}

func validIMindMediaPath(p string) bool {
	parts := strings.Split(p, "/")
	if len(parts) != 4 || parts[0] != iMindDir || parts[1] != "media" || !validIMindUUID(parts[2]) {
		return false
	}
	name := parts[3]
	if name == "audio.wav" {
		return true
	}
	if len(name) < 5 || strings.ContainsAny(name, "\\\x00") || strings.HasPrefix(name, ".") {
		return false
	}
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".png" && ext != ".webp" {
		return false
	}
	stem := strings.TrimSuffix(name, filepath.Ext(name))
	if len(stem) < 16 {
		return false
	}
	for _, r := range stem {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return true
}

func validIMindUUID(s string) bool {
	if len(s) != 36 || s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' || s[14] != '4' {
		return false
	}
	for i, r := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			continue
		}
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f') {
			return false
		}
	}
	return true
}

// execIMind confines operations to a physical first-level directory; unscoped docs retain symlink behavior.
func execIMind(ctx context.Context, root, op string, payload json.RawMessage) (any, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		return nil, obsidianvault.ErrInvalidPath
	}
	var rel string
	if err := json.Unmarshal(fields["path"], &rel); err != nil {
		return nil, obsidianvault.ErrInvalidPath
	}
	name := strings.TrimPrefix(rel, iMindDir+"/")
	switch op {
	case OpChildren, OpMkdir:
		if rel != iMindDir {
			return nil, obsidianvault.ErrInvalidPath
		}
	case OpRead, OpWrite, OpCreate, OpDelete, OpRename:
		if name == rel || name == "" || strings.HasPrefix(name, ".") || strings.ContainsAny(name, "/\\\x00") || !strings.EqualFold(filepath.Ext(name), ".md") {
			return nil, obsidianvault.ErrInvalidPath
		}
	default:
		return nil, obsidianvault.ErrInvalidPath
	}
	sharedRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, obsidianvault.ErrUnavailable
	}
	sharedRoot, err = filepath.EvalSymlinks(sharedRoot)
	if err != nil {
		return nil, obsidianvault.ErrUnavailable
	}
	scopedRoot := filepath.Join(sharedRoot, iMindDir)
	info, err := os.Lstat(scopedRoot)
	if errors.Is(err, os.ErrNotExist) {
		if op == OpMkdir {
			return obsidianvault.Mkdir(ctx, sharedRoot, iMindDir)
		}
		return nil, obsidianvault.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, obsidianvault.ErrInvalidPath
	}
	if !info.IsDir() {
		return nil, obsidianvault.ErrNotDir
	}
	if op == OpMkdir {
		return nil, obsidianvault.ErrExists
	}
	if op == OpChildren {
		out, err := obsidianvault.Children(ctx, scopedRoot, "")
		if err != nil {
			return nil, err
		}
		out.Path = iMindDir
		nodes := make([]obsidianvault.Node, 0, len(out.Nodes))
		for _, node := range out.Nodes {
			info, err := os.Lstat(filepath.Join(scopedRoot, node.Name))
			if err != nil || !info.Mode().IsRegular() || node.Type != obsidianvault.TypeFile {
				continue
			}
			node.Path = iMindDir + "/" + node.Name
			nodes = append(nodes, node)
		}
		out.Nodes = nodes
		return out, nil
	}
	info, err = os.Lstat(filepath.Join(scopedRoot, name))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, obsidianvault.ErrInvalidPath
		}
		if !info.Mode().IsRegular() {
			return nil, obsidianvault.ErrNotFile
		}
	}
	if op == OpRename {
		var dest string
		if json.Unmarshal(fields["name"], &dest) != nil || dest == "" || strings.HasPrefix(dest, ".") || strings.ContainsAny(dest, "/\\\x00") || !strings.HasSuffix(dest, ".md") {
			return nil, obsidianvault.ErrInvalidPath
		}
	}
	if op == OpDelete {
		var revision string
		if json.Unmarshal(fields["expected_revision"], &revision) != nil || strings.TrimSpace(revision) == "" {
			return nil, obsidianvault.ErrInvalidEdit
		}
	}
	delete(fields, "scope")
	fields["path"], err = json.Marshal(name)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		return nil, err
	}
	out, err := Exec(ctx, scopedRoot, op, raw)
	if err != nil {
		return nil, err
	}
	switch result := out.(type) {
	case ReadResult:
		result.Path = iMindDir + "/" + result.Path
		return result, nil
	case obsidianvault.FileContent:
		result.Path = iMindDir + "/" + result.Path
		return result, nil
	case obsidianvault.MoveResult:
		result.From = iMindDir + "/" + result.From
		result.Path = iMindDir + "/" + result.Path
		return result, nil
	default:
		return out, nil
	}
}
