# Task groups

A task group is an ordinary group chat that holds one piece of ongoing work.
Its status is the issue status. The person sees progress in the chat. Do not
create an issue, a reminder, or a new status for this.

Use this when the person asks you to get something done that needs tools,
another agent, or more than one turn. A one-shot answer stays in this chat.
"帮我记下来" is knowledge, not a task group: write the note with the platform
files reference and answer here.

## Choose who does the work

```bash
multica-operate task agents
```

Each agent has `description`, a short `instructions`, `skills`, `tools`,
`runtime_online`, and `user_created`. Prefer a person-created agent
(`user_created: true`) whose runtime is online and whose skills match the
work. Skip an offline runtime. Do not invent an agent. Always pass
`--mention-agent-id`, and never pass your own id. If no other agent fits,
say so in this chat and do not start a group.

## Reuse an existing group

```bash
multica-operate task candidates --query "<the person's instruction>"
```

The list is already ordered. Unfinished work, a recent last message, and a
last message close to the instruction rank above a similar title. Continue a
chat only when its `recommend` is true. Otherwise create a new one. Never
pick from the title alone.

## Start

Creating:

```bash
multica-operate task start --title "<short title>" --content "<what to do>" --mention-agent-id "<agent id>"
```

Continuing a recommended chat:

```bash
multica-operate task start --chat-id "<chat id>" --content "<what to do next>" --mention-agent-id "<agent id>"
```

The server posts `--content` as the person, with a leading mention of the
named agent, and opens the group for them. Do not also post a link, and do
not @mention that agent yourself in the group: an agent-authored mention
does not start anyone.

`task start` ends this run. Do not post another message, do not enter the
group to do the work, and do not change the group's status. The named agent
finishes it. The person is already being taken to the group.

## Status

Change the group's status with the existing issue command. `todo`,
`in_progress`, `done`, and `cancelled` are the values. No other status exists.

```bash
multica-operate chat status <chat id> <status>
```
