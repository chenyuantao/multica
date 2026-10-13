package main

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
)

func newChatCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "chat",
		Short: "List, open, and message group chats",
	}
	cmd.AddCommand(newChatListCmd(), newChatSearchCmd(), newChatGetCmd(), newChatCreateCmd(), newChatDirectCmd(),
		newChatMessagesCmd(), newChatSendCmd(), newChatPinCmd(), newChatReadCmd(), newChatStatusCmd(), newChatMemberCmd())
	return cmd
}

func newChatListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List the user's group chats",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return operateGet(cmd, "/api/group-chats")
		},
	}
}

func newChatSearchCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "search <query>",
		Short: "Search the user's chat messages",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return operateGet(cmd, "/api/group-chats/search?q="+url.QueryEscape(args[0]))
		},
	}
}

func newChatGetCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "get <chat-id>",
		Short: "Get one group chat",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return operateGet(cmd, "/api/group-chats/"+url.PathEscape(args[0]))
		},
	}
}

func newChatCreateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "create --title <title>",
		Short: "Create a group chat",
		Args:  cobra.NoArgs,
		RunE:  runChatCreate,
	}
	cmd.Flags().String("title", "", "Chat title")
	cmd.Flags().StringArray("member", nil, "Member as type:id, for example agent:<uuid>")
	return cmd
}

func runChatCreate(cmd *cobra.Command, _ []string) error {
	title, _ := cmd.Flags().GetString("title")
	title = strings.TrimSpace(title)
	if title == "" {
		return fmt.Errorf("--title is required")
	}
	raw, _ := cmd.Flags().GetStringArray("member")
	members, err := parseMembers(raw)
	if err != nil {
		return err
	}
	return operatePost(cmd, "/api/group-chats", map[string]any{"title": title, "members": members})
}

func newChatDirectCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "direct --member-type <member|agent> --member-id <uuid>",
		Short: "Open the direct chat with a person or agent",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			kind, _ := cmd.Flags().GetString("member-type")
			id, _ := cmd.Flags().GetString("member-id")
			kind, id = strings.TrimSpace(kind), strings.TrimSpace(id)
			if kind == "" || id == "" {
				return fmt.Errorf("--member-type and --member-id are required")
			}
			return operatePost(cmd, "/api/group-chats/direct", map[string]string{"member_type": kind, "member_id": id})
		},
	}
	cmd.Flags().String("member-type", "", "member or agent")
	cmd.Flags().String("member-id", "", "Person or agent id")
	return cmd
}

func newChatMessagesCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "messages <chat-id>",
		Short: "List messages in a chat",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return operateGet(cmd, "/api/issues/"+url.PathEscape(args[0])+"/comments")
		},
	}
}

func newChatSendCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "send <chat-id> --content <text>",
		Short: "Send a message in a chat",
		Long:  "Inside an agent task the message is authored by the agent. To start work as the person, use \"task start\".",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			content, _ := cmd.Flags().GetString("content")
			content = strings.TrimSpace(content)
			if content == "" {
				return fmt.Errorf("--content is required")
			}
			return operatePost(cmd, "/api/issues/"+url.PathEscape(args[0])+"/comments", map[string]string{"content": content})
		},
	}
	cmd.Flags().String("content", "", "Message text")
	return cmd
}

func newChatPinCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "pin <chat-id>",
		Short: "Pin or unpin a chat",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			pinned, _ := cmd.Flags().GetBool("pinned")
			return operatePatch(cmd, "/api/group-chats/"+url.PathEscape(args[0])+"/pin", map[string]bool{"pinned": pinned})
		},
	}
	cmd.Flags().Bool("pinned", true, "Set false to unpin")
	return cmd
}

func newChatReadCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "read <chat-id>",
		Short: "Mark a chat as read",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return operatePost(cmd, "/api/group-chats/"+url.PathEscape(args[0])+"/read", map[string]any{})
		},
	}
}

func newChatStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status <chat-id> <todo|in_progress|done|cancelled>",
		Short: "Change a task chat's status",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			return operatePut(cmd, "/api/issues/"+url.PathEscape(args[0]), map[string]string{"status": args[1]})
		},
	}
}

func newChatMemberCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "member", Short: "Add or remove a chat member"}
	add := &cobra.Command{
		Use:   "add <chat-id> --member-type <member|agent> --member-id <uuid>",
		Short: "Add a member",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			kind, _ := cmd.Flags().GetString("member-type")
			id, _ := cmd.Flags().GetString("member-id")
			if strings.TrimSpace(kind) == "" || strings.TrimSpace(id) == "" {
				return fmt.Errorf("--member-type and --member-id are required")
			}
			return operatePost(cmd, "/api/group-chats/"+url.PathEscape(args[0])+"/members", map[string]string{
				"member_type": strings.TrimSpace(kind), "member_id": strings.TrimSpace(id),
			})
		},
	}
	add.Flags().String("member-type", "", "member or agent")
	add.Flags().String("member-id", "", "Person or agent id")
	remove := &cobra.Command{
		Use:   "remove <chat-id> --member-type <member|agent> --member-id <uuid>",
		Short: "Remove a member",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			kind, _ := cmd.Flags().GetString("member-type")
			id, _ := cmd.Flags().GetString("member-id")
			if strings.TrimSpace(kind) == "" || strings.TrimSpace(id) == "" {
				return fmt.Errorf("--member-type and --member-id are required")
			}
			return operateDelete(cmd, "/api/group-chats/"+url.PathEscape(args[0])+"/members/"+url.PathEscape(strings.TrimSpace(kind))+"/"+url.PathEscape(strings.TrimSpace(id)))
		},
	}
	remove.Flags().String("member-type", "", "member or agent")
	remove.Flags().String("member-id", "", "Person or agent id")
	cmd.AddCommand(add, remove)
	return cmd
}

func newTaskCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "task",
		Short: "Choose an agent and start or reuse a task group",
	}
	agents := &cobra.Command{
		Use:   "agents",
		Short: "List agents this user may put in a task group",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return operateGet(cmd, "/api/mika/agents")
		},
	}
	candidates := &cobra.Command{
		Use:   "candidates --query <text>",
		Short: "Rank existing groups for an instruction",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			query, _ := cmd.Flags().GetString("query")
			query = strings.TrimSpace(query)
			if query == "" {
				return fmt.Errorf("--query is required")
			}
			return operatePost(cmd, "/api/mika/task-chats/candidates", map[string]string{"query": query})
		},
	}
	candidates.Flags().String("query", "", "Instruction to match")
	start := &cobra.Command{
		Use:   "start --content <text>",
		Short: "Create or reuse a task group and post the instruction as the person",
		Args:  cobra.NoArgs,
		RunE:  runTaskStart,
	}
	start.Flags().String("title", "", "Title for a new task group")
	start.Flags().String("chat-id", "", "Existing group to continue")
	start.Flags().String("content", "", "Instruction posted as the person")
	start.Flags().String("mention-agent-id", "", "Agent named at the start of the instruction")
	start.Flags().StringArray("member", nil, "Extra member as type:id")
	cmd.AddCommand(agents, candidates, start)
	return cmd
}

func runTaskStart(cmd *cobra.Command, _ []string) error {
	content, _ := cmd.Flags().GetString("content")
	content = strings.TrimSpace(content)
	if content == "" {
		return fmt.Errorf("--content is required")
	}
	title, _ := cmd.Flags().GetString("title")
	chatID, _ := cmd.Flags().GetString("chat-id")
	mention, _ := cmd.Flags().GetString("mention-agent-id")
	raw, _ := cmd.Flags().GetStringArray("member")
	members, err := parseMembers(raw)
	if err != nil {
		return err
	}
	return operatePost(cmd, "/api/mika/task-chats", map[string]any{
		"title":            strings.TrimSpace(title),
		"chat_id":          strings.TrimSpace(chatID),
		"content":          content,
		"mention_agent_id": strings.TrimSpace(mention),
		"members":          members,
	})
}

func newReminderCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "reminder", Short: "List and edit the user's reminders"}
	list := &cobra.Command{
		Use:   "list",
		Short: "List reminders",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			q := url.Values{}
			for _, name := range []string{"from", "to", "status"} {
				v, _ := cmd.Flags().GetString(name)
				if strings.TrimSpace(v) != "" {
					q.Set(name, strings.TrimSpace(v))
				}
			}
			path := "/api/reminders"
			if encoded := q.Encode(); encoded != "" {
				path += "?" + encoded
			}
			return operateGet(cmd, path)
		},
	}
	list.Flags().String("from", "", "First due date, YYYY-MM-DD")
	list.Flags().String("to", "", "Last due date, YYYY-MM-DD")
	list.Flags().String("status", "", "open or done")
	create := &cobra.Command{
		Use:   "create --description <text>",
		Short: "Create a reminder",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			desc, _ := cmd.Flags().GetString("description")
			desc = strings.TrimSpace(desc)
			if desc == "" {
				return fmt.Errorf("--description is required")
			}
			body := map[string]any{"description": desc}
			if due, _ := cmd.Flags().GetString("due"); strings.TrimSpace(due) != "" {
				body["due_date"] = strings.TrimSpace(due)
			}
			return operatePost(cmd, "/api/reminders", body)
		},
	}
	create.Flags().String("description", "", "Reminder text")
	create.Flags().String("due", "", "Due date, YYYY-MM-DD or today")
	update := &cobra.Command{
		Use:   "update <id>",
		Short: "Update a reminder",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			body := map[string]any{}
			if cmd.Flags().Changed("description") {
				body["description"] = strings.TrimSpace(mustFlag(cmd, "description"))
			}
			if cmd.Flags().Changed("due") {
				body["due_date"] = strings.TrimSpace(mustFlag(cmd, "due"))
			}
			if cmd.Flags().Changed("status") {
				body["status"] = strings.TrimSpace(mustFlag(cmd, "status"))
			}
			if len(body) == 0 {
				return fmt.Errorf("pass at least one of --description, --due, or --status")
			}
			return operatePatch(cmd, "/api/reminders/"+url.PathEscape(args[0]), body)
		},
	}
	update.Flags().String("description", "", "New text")
	update.Flags().String("due", "", "New due date")
	update.Flags().String("status", "", "todo or done")
	del := &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a reminder",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return operateDelete(cmd, "/api/reminders/"+url.PathEscape(args[0]))
		},
	}
	cmd.AddCommand(list, create, update, del)
	return cmd
}

func newContactCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "contact", Short: "List people and agents the user can reach"}
	cmd.AddCommand(&cobra.Command{
		Use:   "list",
		Short: "List workspace members and invocable agents",
		Args:  cobra.NoArgs,
		RunE:  runContactList,
	})
	return cmd
}

func runContactList(cmd *cobra.Command, _ []string) error {
	client, ctx, cancel, err := operateClient(cmd)
	if err != nil {
		return err
	}
	defer cancel()
	var members any
	if err := client.GetJSON(ctx, "/api/workspaces/"+url.PathEscape(client.WorkspaceID)+"/members", &members); err != nil {
		return err
	}
	var agents any
	if err := client.GetJSON(ctx, "/api/mika/agents", &agents); err != nil {
		return err
	}
	return printJSON(map[string]any{"members": members, "agents": agents})
}

func parseMembers(raw []string) ([]map[string]string, error) {
	members := make([]map[string]string, 0, len(raw))
	for _, item := range raw {
		kind, id, ok := strings.Cut(item, ":")
		kind, id = strings.TrimSpace(kind), strings.TrimSpace(id)
		if !ok || kind == "" || id == "" {
			return nil, fmt.Errorf("--member %q must be type:id", item)
		}
		members = append(members, map[string]string{"member_type": kind, "member_id": id})
	}
	return members, nil
}

func mustFlag(cmd *cobra.Command, name string) string {
	v, _ := cmd.Flags().GetString(name)
	return v
}

func operateGet(cmd *cobra.Command, path string) error {
	client, ctx, cancel, err := operateClient(cmd)
	if err != nil {
		return err
	}
	defer cancel()
	var out any
	if err := client.GetJSON(ctx, path, &out); err != nil {
		return err
	}
	return printJSON(out)
}

func operatePost(cmd *cobra.Command, path string, body any) error {
	return operateWrite(cmd, path, body, func(ctx context.Context, client *cli.APIClient, out any) error {
		return client.PostJSON(ctx, path, body, out)
	})
}

func operatePut(cmd *cobra.Command, path string, body any) error {
	return operateWrite(cmd, path, body, func(ctx context.Context, client *cli.APIClient, out any) error {
		return client.PutJSON(ctx, path, body, out)
	})
}

func operatePatch(cmd *cobra.Command, path string, body any) error {
	return operateWrite(cmd, path, body, func(ctx context.Context, client *cli.APIClient, out any) error {
		return client.PatchJSON(ctx, path, body, out)
	})
}

func operateDelete(cmd *cobra.Command, path string) error {
	client, ctx, cancel, err := operateClient(cmd)
	if err != nil {
		return err
	}
	defer cancel()
	return client.DeleteJSON(ctx, path)
}

func operateWrite(cmd *cobra.Command, _ string, _ any, write func(context.Context, *cli.APIClient, any) error) error {
	client, ctx, cancel, err := operateClient(cmd)
	if err != nil {
		return err
	}
	defer cancel()
	var out any
	if err := write(ctx, client, &out); err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	return printJSON(out)
}

func operateClient(cmd *cobra.Command) (*cli.APIClient, context.Context, context.CancelFunc, error) {
	client, err := knowledgeClient(profileOf(cmd))
	if err != nil {
		return nil, nil, nil, err
	}
	if client.WorkspaceID == "" {
		return nil, nil, nil, fmt.Errorf("workspace id is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	return client, ctx, cancel, nil
}
