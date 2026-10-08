package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/fileshare"
	"github.com/multica-ai/multica/server/internal/selfexec"
)

func newDaemonCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "daemon",
		Short: "Run the file-share daemon",
	}
	start := &cobra.Command{
		Use:   "start",
		Short: "Start the daemon in the background",
		RunE:  runDaemonStart,
	}
	start.Flags().Bool("foreground", false, "Run in this terminal instead of the background")
	cmd.AddCommand(start)
	cmd.AddCommand(&cobra.Command{Use: "stop", Short: "Stop the daemon", RunE: runDaemonStop})
	cmd.AddCommand(&cobra.Command{Use: "status", Short: "Show whether the daemon is running", RunE: runDaemonStatus})
	run := &cobra.Command{Use: "run", Hidden: true, RunE: runDaemonLoop}
	cmd.AddCommand(run)
	return cmd
}

func runDaemonStart(cmd *cobra.Command, _ []string) error {
	if err := refuseTaskContext("daemon start"); err != nil {
		return err
	}
	profile := profileOf(cmd)
	if _, _, err := requireLogin(profile); err != nil {
		return err
	}
	if pid, alive := daemonAlive(profile); alive {
		return fmt.Errorf("daemon is already running (pid %d)", pid)
	}
	foreground, _ := cmd.Flags().GetBool("foreground")
	if foreground {
		return runDaemonLoop(cmd, nil)
	}
	exe, err := selfexec.Resolve()
	if err != nil {
		return err
	}
	args := []string{"daemon", "run"}
	if profile != "" {
		args = append([]string{"--profile", profile}, args...)
	}
	child := exec.Command(exe, args...)
	logPath, err := daemonLogPath(profile)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return err
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	child.Stdout = logFile
	child.Stderr = logFile
	child.SysProcAttr = detachAttr()
	if err := child.Start(); err != nil {
		_ = logFile.Close()
		return err
	}
	if err := writePID(profile, child.Process.Pid); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "daemon started (pid %d)\n", child.Process.Pid)
	return nil
}

func runDaemonStop(cmd *cobra.Command, _ []string) error {
	if err := refuseTaskContext("daemon stop"); err != nil {
		return err
	}
	profile := profileOf(cmd)
	pid, alive := daemonAlive(profile)
	if !alive {
		_ = removePID(profile)
		fmt.Fprintln(os.Stderr, "daemon is not running")
		return nil
	}
	if err := signalPID(pid); err != nil {
		return err
	}
	_ = removePID(profile)
	fmt.Fprintf(os.Stderr, "stopped daemon (pid %d)\n", pid)
	return nil
}

func runDaemonStatus(cmd *cobra.Command, _ []string) error {
	pid, alive := daemonAlive(profileOf(cmd))
	if !alive {
		fmt.Fprintln(os.Stdout, "stopped")
		return nil
	}
	fmt.Fprintf(os.Stdout, "running (pid %d)\n", pid)
	return nil
}

func runDaemonLoop(cmd *cobra.Command, _ []string) error {
	if err := refuseTaskContext("daemon run"); err != nil {
		return err
	}
	profile := profileOf(cmd)
	if err := writePID(profile, os.Getpid()); err != nil {
		return err
	}
	defer removePID(profile)
	ctx, cancel := notifyShutdown(context.Background())
	defer cancel()
	var backoff time.Duration
	for ctx.Err() == nil {
		wait := serveOnce(ctx, profile)
		if wait <= 0 {
			wait = time.Second
		}
		if backoff < 15*time.Second {
			backoff += time.Second
		}
		if wait < backoff {
			wait = backoff
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
	return nil
}

func serveOnce(ctx context.Context, profile string) time.Duration {
	cfg, err := loadShare(profile)
	if err != nil {
		fmt.Fprintln(os.Stderr, "waiting for a shared directory")
		return 2 * time.Second
	}
	login, _, err := requireLogin(profile)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 5 * time.Second
	}
	info, err := os.Stat(cfg.Dir)
	if err != nil || !info.IsDir() {
		fmt.Fprintf(os.Stderr, "shared directory %s is not available\n", cfg.Dir)
		return 5 * time.Second
	}
	socketURL, err := shareSocketURL(login.ServerURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 5 * time.Second
	}
	header := http.Header{}
	header.Set("Authorization", "Bearer "+login.Token)
	if login.WorkspaceID != "" {
		header.Set("X-Workspace-ID", login.WorkspaceID)
	}
	dialCtx, cancelDial := context.WithTimeout(ctx, 20*time.Second)
	conn, _, err := websocket.DefaultDialer.DialContext(dialCtx, socketURL, header)
	cancelDial()
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect: %v\n", err)
		return 3 * time.Second
	}
	defer conn.Close()
	enabled := cfg.accessEnabled()
	hello := fileshare.Envelope{
		Type:        "hello",
		Machine:     cfg.Machine,
		WorkspaceID: cfg.WorkspaceID,
		Visibility:  cfg.Visibility,
		Dir:         cfg.Dir,
		Enabled:     &enabled,
	}
	if err := conn.WriteJSON(hello); err != nil {
		fmt.Fprintf(os.Stderr, "hello: %v\n", err)
		return 3 * time.Second
	}
	var ready fileshare.Envelope
	if err := conn.ReadJSON(&ready); err != nil {
		fmt.Fprintf(os.Stderr, "ready: %v\n", err)
		return 3 * time.Second
	}
	if ready.Type == "error" {
		fmt.Fprintln(os.Stderr, ready.ErrorText("server rejected the share"))
		return 5 * time.Second
	}
	fmt.Fprintf(os.Stderr, "sharing %s as %s/\n", cfg.Dir, cfg.Machine)
	serveCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go watchShare(serveCtx, profile, cfg, cancel)
	if err := fileshare.ServeConn(serveCtx, conn, cfg.Dir, func(update fileshare.ConfigUpdate) {
		next := cfg
		next.Visibility = update.Visibility
		enabled := update.Enabled
		next.Enabled = &enabled
		if err := saveShare(profile, next); err != nil {
			fmt.Fprintf(os.Stderr, "save share settings: %v\n", err)
		}
	}); err != nil && ctx.Err() == nil {
		fmt.Fprintf(os.Stderr, "connection closed: %v\n", err)
	}
	return time.Second
}

func watchShare(ctx context.Context, profile string, current shareConfig, cancel context.CancelFunc) {
	path, err := shareConfigPath(profile)
	if err != nil {
		return
	}
	initial, _ := os.Stat(path)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			next, err := loadShare(profile)
			info, statErr := os.Stat(path)
			if err != nil || statErr != nil || next != current || (initial != nil && info != nil && !info.ModTime().Equal(initial.ModTime())) {
				cancel()
				return
			}
		}
	}
}

func pidPath(profile string) (string, error) {
	configPath, err := shareConfigPath(profile)
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(configPath), "file-daemon.pid"), nil
}

func daemonLogPath(profile string) (string, error) {
	configPath, err := shareConfigPath(profile)
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(configPath), "file-daemon.log"), nil
}

func writePID(profile string, pid int) error {
	path, err := pidPath(profile)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(strconv.Itoa(pid)+"\n"), 0o644)
}

func removePID(profile string) error {
	path, err := pidPath(profile)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func readPID(profile string) (int, error) {
	path, err := pidPath(profile)
	if err != nil {
		return 0, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(data)))
}

func daemonAlive(profile string) (int, bool) {
	pid, err := readPID(profile)
	if err != nil || pid <= 0 {
		return 0, false
	}
	if !processAlive(pid) {
		return pid, false
	}
	return pid, true
}
