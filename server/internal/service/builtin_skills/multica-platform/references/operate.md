# Operate the workspace

`multica-operate` is the command for what a person can do in chats, knowledge,
reminders, and contacts. Inside a task it uses the task login and acts as
that user. Output is JSON.
Use this command only. Do not call the HTTP API with `curl` or `wget`.

## Chats

```bash
multica-operate chat list
multica-operate chat search "<text>"
multica-operate chat get <chat-id>
multica-operate chat create --title "<title>" --member agent:<agent-id>
multica-operate chat direct --member-type agent --member-id <agent-id>
multica-operate chat messages <chat-id>
multica-operate chat send <chat-id> --content "<text>"
multica-operate chat read <chat-id>
multica-operate chat pin <chat-id> --pinned=false
multica-operate chat member add <chat-id> --member-type agent --member-id <agent-id>
multica-operate chat member remove <chat-id> --member-type agent --member-id <agent-id>
multica-operate chat status <chat-id> todo
```

`chat send` is spoken by the agent. Starting work as the person is `task start`.

## Task groups

```bash
multica-operate task agents
multica-operate task candidates --query "<instruction>"
multica-operate task start --title "<title>" --content "<what to do>" --mention-agent-id <agent-id>
```

Pass `--chat-id` instead of `--title` to continue a group whose `recommend` is
true. The server posts that message as the person. See `task-chats.md`.

## Reminders

Only when the person is managing the reminder list. A new to-do is a task group.

```bash
multica-operate reminder list --from YYYY-MM-DD --to YYYY-MM-DD --status open
multica-operate reminder create --description "<text>" --due today
multica-operate reminder update <id> --status done
multica-operate reminder delete <id>
```

## Contacts

```bash
multica-operate contact list
```

`members` are people. `agents` are the agents this user may add to a chat,
with skills, tool names, whether the runtime is online, and whether the
person created them.

## Knowledge

`ls`, `search`, `read`, `write`, and `mv` are unchanged. See `files.md`.
Sharing a folder from the person's own computer is `multica-operate share <dir>`.
