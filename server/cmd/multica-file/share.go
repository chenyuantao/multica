package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/daemon"
	"github.com/multica-ai/multica/server/internal/fileshare"
)

type shareConfig struct {
	Dir         string `json:"dir"`
	Machine     string `json:"machine"`
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

func newShareCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "share [dir]",
		Short: "Publish a directory, or the current directory, as this machine's share",
		Args:  cobra.MaximumNArgs(1),
		RunE:  runShare,
	}
	cmd.Flags().String("machine", "", "Knowledge path prefix for this machine (default: host name)")
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
	cfg = shareConfig{
		Dir:         abs,
		Machine:     machine,
		Visibility:  visibility,
		WorkspaceID: login.WorkspaceID,
		ServerURL:   strings.TrimRight(login.ServerURL, "/"),
	}
	daemonID, err := localDaemonID(profile)
	if err != nil {
		return fmt.Errorf("read this machine's daemon id: %w", err)
	}
	if err := saveShare(profile, cfg); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "sharing %s as %s/ (%s) for machine %s\n", cfg.Dir, cfg.Machine, cfg.Visibility, daemonID)
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
	if daemonID, err := localDaemonID(profile); err == nil {
		fmt.Fprintf(os.Stdout, "machine: %s\n", daemonID)
	}
	cfg, err := loadShare(profile)
	if err != nil {
		fmt.Fprintln(os.Stdout, "share: none")
	} else {
		fmt.Fprintf(os.Stdout, "share: %s\n", cfg.Dir)
		fmt.Fprintf(os.Stdout, "path: %s/\n", cfg.Machine)
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

// localDaemonID is the id this machine's multica daemon registers its runtimes
// under. The share is bound to it, so the runtime page shows it on this
// machine and each machine carries one share.
func localDaemonID(profile string) (string, error) {
	if id := strings.TrimSpace(os.Getenv("MULTICA_DAEMON_ID")); id != "" {
		return id, nil
	}
	if inTaskContext() {
		// The task's config root is private; read the machine's id without
		// minting one there.
		dir, err := hostMulticaDir()
		if err != nil {
			return "", err
		}
		data, err := os.ReadFile(filepath.Join(dir, "daemon.id"))
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(string(data)), nil
	}
	return daemon.EnsureDaemonID(profile)
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
