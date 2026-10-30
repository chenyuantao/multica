// Command multica-operate is the agent-facing Multica client: knowledge,
// chats, task groups, reminders, and contacts. It also publishes a local
// directory through the knowledge API.
//
// It reuses the multica CLI login. A daemon stays attached for the share;
// the server asks this process for listings and file bodies, and the
// directory itself is not uploaded.
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
		Use:   "multica-operate",
		Short: "Operate Multica knowledge, chats, reminders, and contacts",
		Long: `Operate the signed-in user's Multica workspace: knowledge notes, group chats, task groups, reminders, and contacts.

Agents run this inside a task with the task login. People sharing a folder from their own computer use "multica-operate share".

The command reuses the login saved by "multica login". A daemon stays connected and serves remote reads and writes from this disk, so shared files are not copied up front.

Each machine has one share, bound to the daemon id its multica runtimes register under, and it appears on that machine in the runtimes page. Paths show up in knowledge under the machine name; knowledge holds nothing but these shares. Set visibility to workspace to let every member and agent in the workspace use the directory.

"ls", "search", "read", "write" and "mv" reach any share this login may use. "chat", "task", "reminder", and "contact" call the workspace APIs as the user the login belongs to.`,
	}
	// main prints the error once.
	root.SilenceErrors = true
	root.PersistentFlags().String("profile", "", "Configuration profile name shared with the multica CLI")
	root.AddCommand(newLoginCmd(), newShareCmd(), newUnshareCmd(), newVisibilityCmd(), newStatusCmd(), newPathCmd(), newDaemonCmd(),
		newLsCmd(), newSearchCmd(), newReadCmd(), newWriteCmd(), newMvCmd(), newRenameCmd(),
		newChatCmd(), newTaskCmd(), newReminderCmd(), newContactCmd())
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
