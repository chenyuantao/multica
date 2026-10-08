// Command multica-file publishes a local directory through the knowledge API.
// It reuses the multica CLI login and keeps a daemon attached to the server.
// The server asks this process for listings and file bodies; the directory
// itself is not uploaded.
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

func main() {
	if err := newRoot().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func newRoot() *cobra.Command {
	root := &cobra.Command{
		Use:   "multica-file",
		Short: "Share a local directory with Multica knowledge",
		Long: `Share a directory on this machine with the signed-in Multica user and the agents they own.

The command reuses the login saved by "multica login". A daemon stays connected and serves remote reads and writes from this disk, so the files are not copied up front.

Paths show up in knowledge under the machine name. The deployment vault stays under system/. Set visibility to workspace to let every member and agent in the workspace use the directory.`,
	}
	root.PersistentFlags().String("profile", "", "Configuration profile name shared with the multica CLI")
	root.AddCommand(newLoginCmd(), newShareCmd(), newUnshareCmd(), newVisibilityCmd(), newStatusCmd(), newDaemonCmd())
	return root
}

func profileOf(cmd *cobra.Command) string {
	profile, _ := cmd.Flags().GetString("profile")
	if profile == "" {
		profile = os.Getenv("MULTICA_PROFILE")
	}
	return profile
}

func refuseTaskContext(command string) error {
	if os.Getenv("MULTICA_TASK_CONFIG_ROOT") != "" || os.Getenv("MULTICA_DAEMON_PORT") != "" || os.Getenv("MULTICA_AGENT_ID") != "" {
		return fmt.Errorf("%s cannot run inside an agent task", command)
	}
	return nil
}
