# Files you produce

Your working directory exists only on the machine running you. Nobody reading
the chat or the issue can open it, so a path in your reply delivers nothing.
Before you finish, place every file you produced by who needs it after this
turn.

## Where each file goes

1. **Working files** — code, scratch, intermediate output. Keep them in your
   working directory. Code reaches people through git and a PR, never as a
   path.
2. **A deliverable for this conversation** — a report, a screenshot, an export,
   in any format. Generate it locally, then attach it: `multica attachment
   upload <path>` in chat, `--attachment <path>` on `multica issue comment add`.
   This is the default: it needs no shared directory, and the reader can always
   open it.
3. **Knowledge that outlives this turn** — a Markdown note people will come
   back to or keep editing: docs, meeting notes, a knowledge-base entry. Write
   it to a shared directory, then reply with a note card.

Use 3 only when the note is meant to last, or the user named a shared path.
Otherwise use 2. Prefer `multica-file` when it is on PATH. When it is not
(command not found), call the same operations with `curl` below. If a list of
machines comes back empty, or the server returns `docs_not_found` because
nothing you can use is shared, use 2 and say the note could not be saved to
knowledge.

## Writing to a shared directory

A shared directory is a folder a person published from their machine with
`multica-file`. It shows up in Multica knowledge under that machine's name,
and the person's own agents — every agent in the workspace, when they chose
workspace visibility — can read and write it from any runtime, through the
server.

Multica knowledge is made of these shares only. `multica-file ls` lists the
machines you can use, one `<machine>/` each. A knowledge path is
`<machine>/<path inside the share>`, for example `mbp/notes/plan.md`.

- Only `.md` files are visible. The parent directory must already exist;
  check with `multica-file ls <dir>`.
- Find a note: `multica-file search <query>`. Read it: `multica-file read
  <knowledge-path>`.
- Create or replace: `multica-file write <knowledge-path> --file <local.md>`.
  Add to a running log: `--append`.
- Before replacing a note someone else may edit, run `multica-file read
  <knowledge-path> --json` and pass its `revision` as `--base-revision`. On
  `docs_conflict`, read again and merge your change in — never retry the same
  write.
- Move: `multica-file mv <knowledge-path> <dest-dir>`, within one machine.

**You seeing a share does not mean the reader can.** Write to a share only when
the user asked for it, or it is visible to the person you are answering:
workspace visibility, or that person owns it. `multica-file path --json` shows
`visibility` for this machine's own share. The `curl` calls do not. If you
cannot tell, attach the file instead (2).

If your working directory is inside a share, a file written there on disk is
already in it; `multica-file path <file>` prints its knowledge path and whether
knowledge lists it.

## Note card

For each note you create or modify in a shared directory, add one fenced
`obsidian` code block to your reply holding only this JSON:

```
{"name": "<file name without .md>", "summary": "<first 50 characters of the body, markup removed>", "path": "<knowledge path>"}
```

`path` is the knowledge path `multica-file write` printed, or the `path` field
from the docs write response — never absolute, never starting with `/`. It
renders as a card that opens the note in Multica knowledge. In Slack or
another external channel the card does not render: give the knowledge path in
inline code and say the note is in Multica knowledge.

## Same operations over HTTP

When `multica-file` is not installed, these calls are the same operations.
Every agent may use them on a share this task can already use. The server
returns `docs_not_found` for a share this task cannot use, a machine that is not connected,
or a missing parent directory. Do not print the token. Do not call delete,
rename, mkdir, share, or unshare — `multica-file` does not offer those inside
a task — and do not use `curl` for any other Multica API.

`MULTICA_SERVER_URL` and `MULTICA_TOKEN` are already in the environment. Send
`Authorization: Bearer $MULTICA_TOKEN` and `Content-Type: application/json`.
Write a JSON body that contains note text to a file in your working directory
and pass it with `--data-binary @body.json`. A one-line body may use `-d`.

List machines (`path` empty) or one directory:

```bash
curl -sS -X POST "$MULTICA_SERVER_URL/api/docs/children" \
  -H "Authorization: Bearer $MULTICA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":""}'
```

Search every share you can use: `POST /api/docs/search` with `{"q":"<query>"}`.

Read a note: `POST /api/docs/files/content` with `{"path":"<machine>/notes/plan.md"}`.
The response includes `content` and `revision`.

Create a note whose parent directory already exists:
`POST /api/docs/files` with `{"path":"<machine>/notes/plan.md","content":"<markdown>"}`.
Only `.md` files are visible.

Replace a note: read it, then `PATCH /api/docs/files/content` with
`{"path":"<knowledge-path>","op":"overwrite","content":"<markdown>","base_revision":"<revision>"}`.
On `docs_conflict`, read again and merge — never retry the same write.
Add to a running log with `"op":"append"` (or `"op":"prepend"`). On
`docs_not_found` for an append, create the note instead.

Move inside one machine: `POST /api/docs/move` with
`{"path":"<knowledge-path>","dest":"<dest-dir>"}`. `dest` is an existing
directory; the note keeps its name.
