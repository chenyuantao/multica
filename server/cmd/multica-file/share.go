package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/daemon"
	"github.com/multica-ai/multica/server/internal/fileshare"
)

type shareConfig struct {
	Dir string `json:"dir"`
	// Machine is the knowledge path prefix this machine proposes. The server
	// uses the machine's runtime nickname instead when it has one, and the
	// daemon records the prefix in use as Root.
	Machine     string `json:"machine"`
	Root        string `json:"root,omitempty"`
	Visibility  string `json:"visibility"`
	WorkspaceID string `json:"workspace_id,omitempty"`
	// ServerURL lets `path` pick this machine's share for the server an
	// agent task talks to when several profiles share directories.
	ServerURL string `json:"server_url,omitempty"`
	// Enabled is nil for configs written before the runtime switch existed.
	// Nil means remote access is on.
	Enabled *bool `json:"enabled,omitempty"`
}

func (c shareConfig) accessEnabled() bool {
	if c.Enabled == nil {
		return true
	}
	return *c.Enabled
}

// same compares by value; Enabled is a pointer, so == would differ on every load.
func (c shareConfig) same(o shareConfig) bool {
	a, b := c, o
	a.Enabled, b.Enabled = nil, nil
	return a == b && c.accessEnabled() == o.accessEnabled()
}

// knowledgeRoot is the knowledge path prefix of this share.
func (c shareConfig) knowledgeRoot() string {
	if c.Root != "" {
		return c.Root
	}
	return c.Machine
}

func newShareCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "share [dir]",
		Short: "Publish a directory, or the current directory, as this machine's share",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runShare,
	}
	cmd.Flags().String("machine", "", "Knowledge path prefix when the machine has no name on the runtime page (default: host name)")
	cmd.Flags().String("visibility", "", "private or workspace; omit to keep the current setting")
	return cmd
}

func newUnshareCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "unshare",
		Short: "Stop publishing the directory",
		RunE:  runUnshare,
	}
}

func newVisibilityCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "visibility [private|workspace]",
		Short: "Show or set who can open the shared directory",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runVisibility,
	}
}

func newStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show the shared directory, visibility, and daemon",
		RunE:  runStatus,
	}
}

func runShare(cmd *cobra.Command, args []string) error {
	if err := refuseTaskContext("share"); err != nil {
		return err
	}
	profile := profileOf(cmd)
	dir := ""
	if len(args) == 1 {
		dir = args[0]
	} else {
		var err error
		dir, err = os.Getwd()
		if err != nil {
			return err
		}
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", abs)
	}
	cfg, err := loadShare(profile)
	if err != nil {
		cfg = shareConfig{Visibility: fileshare.VisibilityPrivate}
	}
	machine, _ := cmd.Flags().GetString("machine")
	if strings.TrimSpace(machine) == "" {
		machine = cfg.Machine
	}
	if strings.TrimSpace(machine) == "" {
		machine, err = os.Hostname()
		if err != nil {
			return err
		}
	}
	machine, err = fileshare.SanitizeMachine(machine)
	if err != nil {
		return fmt.Errorf("machine name %q cannot be used as a knowledge path", machine)
	}
	visibility, _ := cmd.Flags().GetString("visibility")
	if strings.TrimSpace(visibility) == "" {
		visibility = cfg.Visibility
	}
	visibility, err = fileshare.NormalizeVisibility(visibility)
	if err != nil {
		return err
	}
	login, _, err := requireLogin(profile)
	if err != nil {
		return err
	}
	if visibility == fileshare.VisibilityWorkspace && login.WorkspaceID == "" {
		return fmt.Errorf("workspace visibility needs a workspace; run multica workspace switch")
	}
	root := cfg.Root
	if login.WorkspaceID != cfg.WorkspaceID {
		root = ""
	}
	cfg = shareConfig{
		Dir:         abs,
		Machine:     machine,
		Root:        root,
		Visibility:  visibility,
		WorkspaceID: login.WorkspaceID,
		ServerURL:   strings.TrimRight(login.ServerURL, "/"),
	}
	daemonID, err := localDaemonID(profile, cfg)
	if err != nil {
		return fmt.Errorf("read this machine's daemon id: %w", err)
	}
	if err := saveShare(profile, cfg); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "sharing %s as %s/ (%s) for machine %s\n", cfg.Dir, cfg.knowledgeRoot(), cfg.Visibility, daemonID)
	fmt.Fprintf(os.Stderr, "run `multica-file daemon start` if the daemon is not already running\n")
	return nil
}

func runUnshare(cmd *cobra.Command, _ []string) error {
	if err := refuseTaskContext("unshare"); err != nil {
		return err
	}
	path, err := shareConfigPath(profileOf(cmd))
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	fmt.Fprintln(os.Stderr, "share removed")
	return nil
}

func runVisibility(cmd *cobra.Command, args []string) error {
	if err := refuseTaskContext("visibility"); err != nil {
		return err
	}
	profile := profileOf(cmd)
	cfg, err := loadShare(profile)
	if err != nil {
		return fmt.Errorf("no directory is shared yet")
	}
	if len(args) == 0 {
		fmt.Fprintln(os.Stdout, cfg.Visibility)
		return nil
	}
	visibility, err := fileshare.NormalizeVisibility(args[0])
	if err != nil {
		return err
	}
	if visibility == fileshare.VisibilityWorkspace {
		login, _, err := requireLogin(profile)
		if err != nil {
			return err
		}
		if login.WorkspaceID == "" {
			return fmt.Errorf("workspace visibility needs a workspace; run multica workspace switch")
		}
		cfg.WorkspaceID = login.WorkspaceID
	}
	cfg.Visibility = visibility
	if err := saveShare(profile, cfg); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "visibility is %s\n", cfg.Visibility)
	return nil
}

func runStatus(cmd *cobra.Command, _ []string) error {
	profile := profileOf(cmd)
	cfg, err := loadShare(profile)
	if daemonID, idErr := localDaemonID(profile, cfg); idErr == nil {
		fmt.Fprintf(os.Stdout, "machine: %s\n", daemonID)
	}
	if err != nil {
		fmt.Fprintln(os.Stdout, "share: none")
	} else {
		fmt.Fprintf(os.Stdout, "share: %s\n", cfg.Dir)
		fmt.Fprintf(os.Stdout, "path: %s/\n", cfg.knowledgeRoot())
		fmt.Fprintf(os.Stdout, "visibility: %s\n", cfg.Visibility)
		if cfg.WorkspaceID != "" {
			fmt.Fprintf(os.Stdout, "workspace: %s\n", cfg.WorkspaceID)
		}
	}
	if pid, alive := daemonAlive(profile); alive {
		fmt.Fprintf(os.Stdout, "daemon: running (pid %d)\n", pid)
	} else {
		fmt.Fprintln(os.Stdout, "daemon: stopped")
	}
	return nil
}

// localDaemonID is the id this machine's runtime daemon registers its runtimes
// under. The share is bound to it, so the runtime page shows it on this
// machine and each machine carries one share.
//
// Rebranded builds of the multica CLI (imultica, …) keep the same layout under
// their own ~/.<name>multica directory, so every such directory with a
// daemon.id is considered: a running daemon wins, then one configured for the
// share's workspace, then its server, then ~/.multica. With none on disk the
// id is minted the way the multica daemon would, except inside an agent task.
func localDaemonID(profile string, share shareConfig) (string, error) {
	if id := strings.TrimSpace(os.Getenv("MULTICA_DAEMON_ID")); id != "" {
		return id, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	if id := pickDaemonID(home, share); id != "" {
		return id, nil
	}
	if inTaskContext() {
		return "", errors.New("no runtime daemon id found on this machine")
	}
	return daemon.EnsureDaemonID(profile)
}

func pickDaemonID(home string, share shareConfig) string {
	dirs, _ := filepath.Glob(filepath.Join(home, ".*multica"))
	primary := filepath.Join(home, ".multica")
	sort.SliceStable(dirs, func(i, j int) bool { return dirs[i] == primary && dirs[j] != primary })
	best, bestScore := "", -1
	for _, dir := range dirs {
		data, err := os.ReadFile(filepath.Join(dir, "daemon.id"))
		id := strings.TrimSpace(string(data))
		if err != nil || id == "" {
			continue
		}
		score := daemonDirScore(dir, share)
		if score > bestScore {
			best, bestScore = id, score
		}
	}
	return best
}

func daemonDirScore(dir string, share shareConfig) int {
	pidFiles := []string{filepath.Join(dir, "daemon.pid")}
	configs := []string{filepath.Join(dir, "config.json")}
	if profiles, err := filepath.Glob(filepath.Join(dir, "profiles", "*")); err == nil {
		for _, p := range profiles {
			pidFiles = append(pidFiles, filepath.Join(p, "daemon.pid"))
			configs = append(configs, filepath.Join(p, "config.json"))
		}
	}
	score := 0
	for _, pidFile := range pidFiles {
		if _, alive := daemonAliveAt(pidFile); alive {
			score += 4
			break
		}
	}
	workspace, server := false, false
	for _, path := range configs {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var cfg cli.CLIConfig
		if json.Unmarshal(data, &cfg) != nil {
			continue
		}
		workspace = workspace || (share.WorkspaceID != "" && cfg.WorkspaceID == share.WorkspaceID)
		server = server || (share.ServerURL != "" && strings.TrimRight(cfg.ServerURL, "/") == share.ServerURL)
	}
	if workspace {
		score += 2
	}
	if server {
		score++
	}
	return score
}

func inTaskContext() bool {
	return strings.TrimSpace(os.Getenv(cli.TaskConfigRootEnv)) != ""
}

// hostMulticaDir is ~/.multica of the machine's user, also inside an agent
// task, where the CLI config itself is redirected to a private directory.
func hostMulticaDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".multica"), nil
}

func shareConfigPath(profile string) (string, error) {
	configPath, err := cli.CLIConfigPathForProfile(profile)
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(configPath), "file-share.json"), nil
}

func loadShare(profile string) (shareConfig, error) {
	path, err := shareConfigPath(profile)
	if err != nil {
		return shareConfig{}, err
	}
	return loadShareFile(path)
}

func loadShareFile(path string) (shareConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return shareConfig{}, err
	}
	var cfg shareConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return shareConfig{}, err
	}
	if cfg.Dir == "" || cfg.Machine == "" {
		return shareConfig{}, fmt.Errorf("share config is incomplete")
	}
	return cfg, nil
}

func saveShare(profile string, cfg shareConfig) error {
	path, err := shareConfigPath(profile)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o600)
}
