package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/fileshare"
)

func newPathCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "path [local-path | knowledge-path]",
		Short: "Show the shared directory, or map a path between disk and knowledge",
		Long: `Without an argument, prints the directory this machine shares, its knowledge path prefix, and whether knowledge can reach it now.

With an argument, prints the matching local and knowledge paths and whether the file shows up in knowledge. An argument that starts with the knowledge prefix (for example mbp/notes/a.md) is a knowledge path; anything else is a local path, relative to the current directory.

Works inside an agent task: it reads the share this machine publishes and checks knowledge with the task's own login. When the machine has no share, it prints "shared: no" ({"shared": false} with --json) and the reason. Exits with status 1 when nothing is shared, or when the path would not show up in knowledge.`,
		Args: cobra.MaximumNArgs(1),
		RunE: runPath,
	}
	cmd.Flags().Bool("json", false, "Print the result as JSON")
	cmd.Flags().Bool("offline", false, "Skip the knowledge check against the server")
	return cmd
}

type pathReport struct {
	Shared        bool   `json:"shared"`
	DaemonID      string `json:"daemon_id,omitempty"`
	Dir           string `json:"dir"`
	KnowledgeRoot string `json:"knowledge_root"`
	Visibility    string `json:"visibility"`
	Enabled       bool   `json:"enabled"`
	DaemonRunning bool   `json:"daemon_running"`
	// Reachable is nil when the server check was skipped.
	Reachable  *bool  `json:"reachable,omitempty"`
	ReachError string `json:"reach_error,omitempty"`

	Local     string `json:"local,omitempty"`
	Knowledge string `json:"knowledge,omitempty"`
	Exists    *bool  `json:"exists,omitempty"`
	Listed    *bool  `json:"listed,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// noShareReport is printed instead of pathReport when the machine has no
// share the caller can use, so --json always yields an object to check.
type noShareReport struct {
	Shared   bool   `json:"shared"`
	DaemonID string `json:"daemon_id,omitempty"`
	Reason   string `json:"reason"`
}

var (
	errOutsideShare = errors.New("path is outside the shared directory")
	errNotShared    = errors.New("no directory is shared from this machine")
)

// notSharedError carries the reason a share could not be found.
type notSharedError struct{ reason string }

func (e *notSharedError) Error() string { return errNotShared.Error() + ": " + e.reason }
func (e *notSharedError) Unwrap() error { return errNotShared }

func runPath(cmd *cobra.Command, args []string) error {
	cmd.SilenceUsage = true
	profile := profileOf(cmd)
	asJSON, _ := cmd.Flags().GetBool("json")
	daemonID, _ := localDaemonID(profile)
	cfg, pidFile, err := findShare(profile)
	if err != nil {
		var notShared *notSharedError
		if !errors.As(err, &notShared) {
			return err
		}
		none := noShareReport{DaemonID: daemonID, Reason: notShared.reason}
		if asJSON {
			if encErr := printJSON(none); encErr != nil {
				return encErr
			}
		} else {
			fmt.Fprintln(os.Stdout, "shared: no")
			fmt.Fprintf(os.Stdout, "reason: %s\n", none.Reason)
			if none.DaemonID != "" {
				fmt.Fprintf(os.Stdout, "machine: %s\n", none.DaemonID)
			}
		}
		return errNotShared
	}
	report := pathReport{
		Shared:        true,
		DaemonID:      daemonID,
		Dir:           cfg.Dir,
		KnowledgeRoot: cfg.Machine + "/",
		Visibility:    cfg.Visibility,
		Enabled:       cfg.accessEnabled(),
	}
	_, report.DaemonRunning = daemonAliveAt(pidFile)

	var failure error
	knowledgePath := cfg.Machine
	isDir := true
	if len(args) == 1 {
		local, rel, err := resolveSharePath(cfg, args[0])
		if err != nil {
			return err
		}
		report.Local = local
		report.Knowledge = fileshare.Join(cfg.Machine, rel)
		info, statErr := os.Stat(local)
		exists := statErr == nil
		report.Exists = &exists
		if exists {
			isDir = info.IsDir()
		} else {
			isDir = filepath.Ext(local) == ""
		}
		reason := knowledgeFilter(rel, isDir)
		if reason == "" && !exists {
			reason = "does not exist on disk"
		}
		listed := reason == ""
		report.Listed = &listed
		report.Reason = reason
		if !listed {
			failure = fmt.Errorf("%s is not in knowledge: %s", report.Knowledge, reason)
		}
		knowledgePath = report.Knowledge
	}
	if !report.Enabled && failure == nil {
		failure = errors.New("remote access is off for this share")
	}

	offline, _ := cmd.Flags().GetBool("offline")
	if !offline && report.Enabled && (report.Listed == nil || *report.Listed) {
		reachErr := checkKnowledge(profile, knowledgePath, isDir)
		reachable := reachErr == nil
		report.Reachable = &reachable
		if reachErr != nil {
			report.ReachError = reachErr.Error()
			if failure == nil {
				failure = fmt.Errorf("knowledge cannot open %s: %w", knowledgePath, reachErr)
			}
		}
	}

	if asJSON {
		if err := printJSON(report); err != nil {
			return err
		}
	} else {
		printPathReport(report)
	}
	return failure
}

func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	return enc.Encode(v)
}

func printPathReport(r pathReport) {
	onOff := func(v bool, on, off string) string {
		if v {
			return on
		}
		return off
	}
	fmt.Fprintln(os.Stdout, "shared: yes")
	fmt.Fprintf(os.Stdout, "dir: %s\n", r.Dir)
	fmt.Fprintf(os.Stdout, "knowledge_root: %s\n", r.KnowledgeRoot)
	fmt.Fprintf(os.Stdout, "visibility: %s\n", r.Visibility)
	fmt.Fprintf(os.Stdout, "access: %s\n", onOff(r.Enabled, "on", "off"))
	fmt.Fprintf(os.Stdout, "daemon: %s\n", onOff(r.DaemonRunning, "running", "stopped"))
	if r.DaemonID != "" {
		fmt.Fprintf(os.Stdout, "machine: %s\n", r.DaemonID)
	}
	if r.Local != "" {
		fmt.Fprintf(os.Stdout, "local: %s\n", r.Local)
		fmt.Fprintf(os.Stdout, "knowledge: %s\n", r.Knowledge)
		if r.Listed != nil {
			if *r.Listed {
				fmt.Fprintln(os.Stdout, "listed: yes")
			} else {
				fmt.Fprintf(os.Stdout, "listed: no (%s)\n", r.Reason)
			}
		}
	}
	if r.Reachable != nil {
		if *r.Reachable {
			fmt.Fprintln(os.Stdout, "reachable: yes")
		} else {
			fmt.Fprintf(os.Stdout, "reachable: no (%s)\n", r.ReachError)
		}
	}
}

// findShare returns this machine's share and the daemon's pid file. Inside an
// agent task the CLI config is private to the task, so the share is read from
// the machine user's ~/.multica, matched to the task's server and workspace.
func findShare(profile string) (shareConfig, string, error) {
	if !inTaskContext() {
		path, err := shareConfigPath(profile)
		if err != nil {
			return shareConfig{}, "", err
		}
		cfg, err := loadShareFile(path)
		if errors.Is(err, os.ErrNotExist) {
			return shareConfig{}, "", &notSharedError{"this machine has never shared a directory; run `multica-file share <dir>` to share one"}
		}
		if err != nil {
			return shareConfig{}, "", &notSharedError{fmt.Sprintf("the share settings in %s cannot be read (%v); run `multica-file share <dir>` again", path, err)}
		}
		return cfg, filepath.Join(filepath.Dir(path), "file-daemon.pid"), nil
	}
	dir, err := hostMulticaDir()
	if err != nil {
		return shareConfig{}, "", err
	}
	candidates := []string{filepath.Join(dir, "file-share.json")}
	profiles, _ := filepath.Glob(filepath.Join(dir, "profiles", "*", "file-share.json"))
	candidates = append(candidates, profiles...)
	server := strings.TrimRight(strings.TrimSpace(os.Getenv("MULTICA_SERVER_URL")), "/")
	workspace := strings.TrimSpace(os.Getenv("MULTICA_WORKSPACE_ID"))
	var others []string
	unreadable := 0
	for _, path := range candidates {
		cfg, err := loadShareFile(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			unreadable++
			continue
		}
		if (server != "" && cfg.ServerURL != "" && cfg.ServerURL != server) ||
			(workspace != "" && cfg.WorkspaceID != "" && cfg.WorkspaceID != workspace) {
			others = append(others, cfg.Machine+"/")
			continue
		}
		return cfg, filepath.Join(filepath.Dir(path), "file-daemon.pid"), nil
	}
	const hint = "the machine's user can run `multica-file share <dir>` outside an agent task"
	switch {
	case len(others) > 0:
		return shareConfig{}, "", &notSharedError{fmt.Sprintf("this machine shares %s only with another server or workspace; %s", strings.Join(others, ", "), hint)}
	case unreadable > 0:
		return shareConfig{}, "", &notSharedError{"this machine's share settings cannot be read; " + hint}
	default:
		return shareConfig{}, "", &notSharedError{"this machine has never shared a directory; " + hint}
	}
}

// resolveSharePath maps an argument to its absolute local path and its path
// below the share root, slash-separated. Symlinks are resolved on both sides
// so /tmp and /private/tmp style aliases still match.
func resolveSharePath(cfg shareConfig, arg string) (local, rel string, err error) {
	prefix := cfg.Machine + "/"
	if arg == cfg.Machine || strings.HasPrefix(arg, prefix) {
		rest := strings.Trim(strings.TrimPrefix(arg, cfg.Machine), "/")
		for _, segment := range strings.Split(rest, "/") {
			if segment == ".." {
				return "", "", errOutsideShare
			}
		}
		return filepath.Join(cfg.Dir, filepath.FromSlash(rest)), rest, nil
	}
	abs, err := filepath.Abs(arg)
	if err != nil {
		return "", "", err
	}
	root := resolveExisting(cfg.Dir)
	relPath, err := filepath.Rel(root, resolveExisting(abs))
	if err != nil || relPath == ".." || strings.HasPrefix(relPath, ".."+string(filepath.Separator)) {
		return "", "", fmt.Errorf("%w %s: %s", errOutsideShare, cfg.Dir, abs)
	}
	if relPath == "." {
		relPath = ""
	}
	return abs, filepath.ToSlash(relPath), nil
}

// resolveExisting resolves symlinks in the longest existing prefix of path,
// so a file that is about to be written still maps through a linked parent.
func resolveExisting(path string) string {
	path = filepath.Clean(path)
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}
	parent := filepath.Dir(path)
	if parent == path {
		return path
	}
	return filepath.Join(resolveExisting(parent), filepath.Base(path))
}

// knowledgeFilter says why a path below the share root is left out of
// knowledge, or "" when it is listed. It mirrors the vault walk: hidden
// names, the skipped build directories, and non-Markdown files.
func knowledgeFilter(rel string, isDir bool) string {
	if rel == "" {
		return ""
	}
	segments := strings.Split(rel, "/")
	for i, segment := range segments {
		if strings.HasPrefix(segment, ".") {
			return fmt.Sprintf("%q is hidden", segment)
		}
		if (i < len(segments)-1 || isDir) && slices.Contains(fileshare.ShareDirs, segment) {
			return fmt.Sprintf("%q directories are not shared", segment)
		}
	}
	if !isDir && !strings.EqualFold(filepath.Ext(rel), ".md") {
		return "only Markdown (.md) files are shared"
	}
	return ""
}

// checkKnowledge opens the path through the server, as an agent would.
func checkKnowledge(profile, knowledgePath string, isDir bool) error {
	client, err := knowledgeClient(profile)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	endpoint := "/api/docs/files/hierarchy"
	if isDir {
		endpoint = "/api/docs/children"
	}
	var out json.RawMessage
	return client.PostJSON(ctx, endpoint, map[string]string{"path": knowledgePath}, &out)
}

func knowledgeClient(profile string) (*cli.APIClient, error) {
	if inTaskContext() {
		server := strings.TrimSpace(os.Getenv("MULTICA_SERVER_URL"))
		token := strings.TrimSpace(os.Getenv("MULTICA_TOKEN"))
		if server == "" || token == "" {
			return nil, errors.New("the task has no Multica login")
		}
		return cli.NewAPIClient(server, os.Getenv("MULTICA_WORKSPACE_ID"), token), nil
	}
	cfg, err := cli.LoadCLIConfigForProfile(profile)
	if err != nil || strings.TrimSpace(cfg.Token) == "" || strings.TrimSpace(cfg.ServerURL) == "" {
		return nil, errors.New("not logged in; run `multica login`")
	}
	return cli.NewAPIClient(cfg.ServerURL, cfg.WorkspaceID, cfg.Token), nil
}
