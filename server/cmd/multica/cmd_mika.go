package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

var mikaCmd = &cobra.Command{
	Use:   "mika",
	Short: "Turn one instruction into a task group",
}

var mikaAgentsCmd = &cobra.Command{
	Use:   "agents",
	Short: "List agents Mika may put in a task group",
	RunE:  runMikaAgents,
}

var mikaCandidatesCmd = &cobra.Command{
	Use:   "candidates",
	Short: "Rank existing groups for continuing an instruction",
	RunE:  runMikaCandidates,
}

var mikaStartCmd = &cobra.Command{
	Use:   "start",
	Short: "Create or reuse a task group and post the instruction as the person",
	RunE:  runMikaStart,
}

func init() {
	mikaAgentsCmd.Flags().String("output", "json", "Output format: table or json")
	mikaCandidatesCmd.Flags().String("query", "", "The instruction to match against existing groups")
	mikaCandidatesCmd.Flags().String("output", "json", "Output format: table or json")
	mikaStartCmd.Flags().String("title", "", "Title for a new task group")
	mikaStartCmd.Flags().String("chat-id", "", "Existing group to continue; empty creates one")
	mikaStartCmd.Flags().String("content", "", "Instruction posted as the person")
	mikaStartCmd.Flags().String("mention-agent-id", "", "Agent named at the start of the instruction")
	mikaStartCmd.Flags().StringArray("member", nil, "Extra member as type:id, for example agent:<uuid>")
	mikaStartCmd.Flags().String("output", "json", "Output format: table or json")

	mikaCmd.AddCommand(mikaAgentsCmd)
	mikaCmd.AddCommand(mikaCandidatesCmd)
	mikaCmd.AddCommand(mikaStartCmd)
}

func runMikaAgents(cmd *cobra.Command, _ []string) error {
	client, ctx, cancel, err := mikaClient(cmd)
	if err != nil {
		return err
	}
	defer cancel()
	var out any
	if err := client.GetJSON(ctx, "/api/mika/agents", &out); err != nil {
		return fmt.Errorf("list agents: %w", err)
	}
	return cli.PrintJSON(os.Stdout, out)
}

func runMikaCandidates(cmd *cobra.Command, _ []string) error {
	client, ctx, cancel, err := mikaClient(cmd)
	if err != nil {
		return err
	}
	defer cancel()
	query, _ := cmd.Flags().GetString("query")
	query = strings.TrimSpace(query)
	if query == "" {
		return fmt.Errorf("--query is required")
	}
	var out any
	if err := client.PostJSON(ctx, "/api/mika/task-chats/candidates", map[string]string{"query": query}, &out); err != nil {
		return fmt.Errorf("rank task chats: %w", err)
	}
	return cli.PrintJSON(os.Stdout, out)
}

func runMikaStart(cmd *cobra.Command, _ []string) error {
	client, ctx, cancel, err := mikaClient(cmd)
	if err != nil {
		return err
	}
	defer cancel()
	content, _ := cmd.Flags().GetString("content")
	content = strings.TrimSpace(content)
	if content == "" {
		return fmt.Errorf("--content is required")
	}
	title, _ := cmd.Flags().GetString("title")
	chatID, _ := cmd.Flags().GetString("chat-id")
	mention, _ := cmd.Flags().GetString("mention-agent-id")
	rawMembers, _ := cmd.Flags().GetStringArray("member")
	members := make([]map[string]string, 0, len(rawMembers))
	for _, raw := range rawMembers {
		kind, id, ok := strings.Cut(raw, ":")
		kind, id = strings.TrimSpace(kind), strings.TrimSpace(id)
		if !ok || kind == "" || id == "" {
			return fmt.Errorf("--member %q must be type:id", raw)
		}
		members = append(members, map[string]string{"member_type": kind, "member_id": id})
	}
	body := map[string]any{
		"title":            strings.TrimSpace(title),
		"chat_id":          strings.TrimSpace(chatID),
		"content":          content,
		"mention_agent_id": strings.TrimSpace(mention),
		"members":          members,
	}
	var out any
	if err := client.PostJSON(ctx, "/api/mika/task-chats", body, &out); err != nil {
		return fmt.Errorf("start task chat: %w", err)
	}
	return cli.PrintJSON(os.Stdout, out)
}

func mikaClient(cmd *cobra.Command) (*cli.APIClient, context.Context, context.CancelFunc, error) {
	client, err := newAPIClient(cmd)
	if err != nil {
		return nil, nil, nil, err
	}
	if client.WorkspaceID == "" {
		if _, err := requireWorkspaceID(cmd); err != nil {
			return nil, nil, nil, err
		}
	}
	ctx, cancel := cli.APIContext(context.Background())
	return client, ctx, cancel, nil
}
