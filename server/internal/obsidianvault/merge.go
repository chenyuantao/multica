package obsidianvault

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
)

func composeEdit(ctx context.Context, current FileContent, req EditRequest, base string, haveBase bool) (string, error) {
	if req.Resolve != "" && req.Resolve != "merge" {
		return "", ErrInvalidEdit
	}
	rev := strings.TrimSpace(req.BaseRevision)
	if current.Revision == rev {
		return applyChanges(current.Content, req.Changes)
	}
	if req.Resolve != "merge" {
		return "", &ConflictError{ModifiedAt: current.ModifiedAt, Revision: current.Revision}
	}
	if !haveBase {
		return "", &ConflictError{
			ModifiedAt: current.ModifiedAt,
			Revision:   current.Revision,
			Reason:     "base version not found",
		}
	}
	if contentRevision([]byte(base)) != rev {
		return "", ErrInvalidEdit
	}
	ours, err := applyChanges(base, req.Changes)
	if err != nil {
		return "", err
	}
	merged, clean, err := merge3(ctx, ours, base, current.Content)
	if err != nil {
		return "", err
	}
	if !clean {
		return "", &MergeConflictError{Content: merged, Revision: current.Revision}
	}
	return merged, nil
}

// merge3 combines ours and theirs against base. clean is false when the
// result still contains conflict markers; that text is not written.
func merge3(ctx context.Context, ours, base, theirs string) (string, bool, error) {
	dir, err := os.MkdirTemp("", "docs-merge-*")
	if err != nil {
		return "", false, err
	}
	defer os.RemoveAll(dir)
	oursPath, err := writeTemp(dir, "ours", ours)
	if err != nil {
		return "", false, err
	}
	basePath, err := writeTemp(dir, "base", base)
	if err != nil {
		return "", false, err
	}
	theirsPath, err := writeTemp(dir, "theirs", theirs)
	if err != nil {
		return "", false, err
	}
	out, err := runMerge(ctx, "git", "merge-file", "-p", "--diff3",
		"-L", "ours", "-L", "base", "-L", "theirs",
		oursPath, basePath, theirsPath)
	if err != nil && errors.Is(err, exec.ErrNotFound) {
		out, err = runMerge(ctx, "diff3", "-m",
			"-L", "ours", "-L", "base", "-L", "theirs",
			oursPath, basePath, theirsPath)
	}
	if err == nil {
		return out, true, nil
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 1 {
		return out, false, nil
	}
	return "", false, err
}

func runMerge(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil && !errors.Is(err, exec.ErrNotFound) {
		if strings.TrimSpace(stderr.String()) != "" && !isExitOne(err) {
			return stdout.String(), err
		}
	}
	return stdout.String(), err
}

func isExitOne(err error) bool {
	var exit *exec.ExitError
	return errors.As(err, &exit) && exit.ExitCode() == 1
}

func writeTemp(dir, name, body string) (string, error) {
	f, err := os.CreateTemp(dir, name+"-*")
	if err != nil {
		return "", err
	}
	path := f.Name()
	if _, err := f.WriteString(body); err != nil {
		f.Close()
		return "", err
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	return path, nil
}
