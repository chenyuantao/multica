package obsidianvault

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const maxHistoryScan = 20

// version is one File recovery snapshot or one Obsidian Sync version.
// Numbers start at 1 for the newest. The bytes live outside the note:
// local snapshots are in Obsidian's global app data, and Sync versions are
// on the Sync service. Both are read through the running Obsidian CLI.
type version struct {
	Source  string
	Version int
	Label   string
}

type cliRunner func(ctx context.Context, vault string, args []string) (string, error)

var runCLI cliRunner = defaultRunCLI

// FindRevision scans CLI history for the snapshot whose bytes hash to revision.
func FindRevision(ctx context.Context, root, rel, revision string) (string, error) {
	root, cleaned, err := noteRoot(ctx, root, rel)
	if err != nil {
		return "", err
	}
	for _, source := range []string{"local", "sync"} {
		raw, err := runCLI(ctx, root, historyArgs(source, cleaned))
		if err != nil {
			if cliDown(err) {
				return "", ErrCLIUnavailable
			}
			continue
		}
		versions := parseVersions(raw, source)
		if len(versions) > maxHistoryScan {
			versions = versions[:maxHistoryScan]
		}
		for _, version := range versions {
			body, err := runCLI(ctx, root, readArgs(source, cleaned, version.Version))
			if err != nil {
				continue
			}
			if text, ok := revisionMatch(body, revision); ok {
				return text, nil
			}
		}
	}
	return "", &ConflictError{Reason: "base version not found"}
}

func noteRoot(ctx context.Context, root, rel string) (string, string, error) {
	if err := ctx.Err(); err != nil {
		return "", "", err
	}
	root, err := resolveRoot(root)
	if err != nil {
		return "", "", err
	}
	_, cleaned, err := openNote(root, rel)
	if err != nil {
		return "", "", err
	}
	return root, cleaned, nil
}

func historyArgs(source, rel string) []string {
	cmd := "history"
	if source == "sync" {
		cmd = "sync:history"
	}
	return []string{cmd, "path=" + rel}
}

func readArgs(source, rel string, version int) []string {
	cmd := "history:read"
	if source == "sync" {
		cmd = "sync:read"
	}
	return []string{cmd, "path=" + rel, "version=" + strconv.Itoa(version)}
}

func parseVersions(raw, source string) []version {
	out := make([]version, 0)
	seen := map[int]struct{}{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		token := strings.Trim(fields[0], ".):")
		token = strings.TrimPrefix(token, "v")
		n, err := strconv.Atoi(token)
		if err != nil || n <= 0 {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		label := ""
		if len(fields) > 1 {
			label = strings.Join(fields[1:], " ")
		}
		out = append(out, version{Source: source, Version: n, Label: label})
	}
	return out
}

func revisionMatch(body, revision string) (string, bool) {
	if contentRevision([]byte(body)) == revision {
		return body, true
	}
	trimmed := strings.TrimSuffix(body, "\n")
	if trimmed != body && contentRevision([]byte(trimmed)) == revision {
		return trimmed, true
	}
	return "", false
}

func cliDown(err error) bool {
	return errors.Is(err, ErrCLIUnavailable)
}

func defaultRunCLI(ctx context.Context, vault string, args []string) (string, error) {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
	}
	bin := strings.TrimSpace(os.Getenv("OBSIDIAN_CLI"))
	if bin == "" {
		bin = "obsidian"
	}
	if id := vaultID(vault); id != "" {
		args = append([]string{"vault=" + id}, args...)
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = vault
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return "", ErrCLIUnavailable
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		if len(msg) > 400 {
			msg = msg[:400]
		}
		return "", fmt.Errorf("%w: %s", ErrCLIFailed, msg)
	}
	if stdout.Len() > maxNoteBytes {
		return "", ErrTooLarge
	}
	return stdout.String(), nil
}

func vaultID(root string) string {
	if id := strings.TrimSpace(os.Getenv("OBSIDIAN_VAULT_ID")); id != "" {
		return id
	}
	configPath := obsidianConfigPath()
	if configPath == "" {
		return ""
	}
	raw, err := os.ReadFile(configPath)
	if err != nil {
		return ""
	}
	var cfg struct {
		Vaults map[string]struct {
			Path string `json:"path"`
		} `json:"vaults"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return ""
	}
	want, err := filepath.EvalSymlinks(root)
	if err != nil {
		want = root
	}
	for id, vault := range cfg.Vaults {
		got, err := filepath.EvalSymlinks(vault.Path)
		if err != nil {
			got = vault.Path
		}
		if got == want {
			return id
		}
	}
	return ""
}

func obsidianConfigPath() string {
	if runtime.GOOS == "windows" {
		appData := os.Getenv("APPDATA")
		if appData == "" {
			return ""
		}
		return filepath.Join(appData, "obsidian", "obsidian.json")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support", "obsidian", "obsidian.json")
	}
	if xdg := strings.TrimSpace(os.Getenv("XDG_CONFIG_HOME")); xdg != "" {
		return filepath.Join(xdg, "obsidian", "obsidian.json")
	}
	return filepath.Join(home, ".config", "obsidian", "obsidian.json")
}
