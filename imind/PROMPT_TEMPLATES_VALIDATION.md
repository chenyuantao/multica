# iMind prompt templates

## Delivered behavior

Workspace → General → iMind on Web/Desktop exposes four independent templates: ordinary-file naming, recording naming, default processing, and clipping/writeback. Editors show the effective server-provided value, including the actual default before customization. Saving persists the entire override; restoring removes only that override. Empty or malformed input does not erase an existing value. Workspace owners/admins can edit; other members can read.

The server supplies defaults and the supported variable list. Values come from the saved, authorized Markdown file. Replacement is literal and non-recursive; `FILE_CONTENT` retains the complete Markdown including metadata. See [CONTRACT.md](CONTRACT.md#工作区-llm-提示词模板) for the API and variable definitions. Migration 590 adds workspace-scoped JSONB storage, and sqlc output has been regenerated.

## Verification

Passed:

- Managed checkout migration: `make migrate-up` applied migration 590.
- `make sqlc`.
- Guarded Go tests for `./internal/imind ./internal/handler -run IMind -count=1`, using the checkout's Makefile environment. Covers variable values, literal replacement, expansion limits, defaults, overrides, reset, permission checks, invalid inputs, preserved saved-file behavior, ordinary/recording provider request payloads, and processing/clipping agent context.
- `pnpm --filter @multica/core exec vitest run api/client.test.ts`: 142 tests.
- `pnpm --filter @multica/views exec vitest run settings/components/imind-prompt-settings.test.tsx settings/components/workspace-tab.test.tsx`: 9 tests.
- ESLint on changed core API and settings component/test files.
- `git diff --check`.

Broader checks ran but did not pass because of failures outside this change:

- `pnpm typecheck`: `im/chat-documents-section.test.tsx` query mock signature; unused `useQueryClient` in `im/doc-open-path.ts`; `setSelectionRange` on `HTMLElement` in `im/reminder-page.test.tsx`.
- `pnpm lint`: Web PWA service-worker script globals are reported as undefined.
- `pnpm test`: text contrast test reports `text-foreground/80` in `packages/views/im/chat-history-card.tsx:97`; Turbo stops other package suites on that failure.
- `make test`: worktree/repocache tests fail; handler suite panics in `TestAskOpensTheDirectChatAndSendsTheQuery` because the test evaluator expects `AskState` but receives `SupersedeState`. The targeted iMind suite passes independently. The agent-package phase is not reached after the regular-package failure.

Provider requests were checked with controlled HTTP transports. No real LLM or installed agent CLI was executed. Browser/device E2E and production deployment were not performed. Migration was applied only to the managed local checkout database. Deploy updated backend and Web/Desktop to expose the editor; installed iMind clients use the workspace templates through the backend without a client rebuild.
