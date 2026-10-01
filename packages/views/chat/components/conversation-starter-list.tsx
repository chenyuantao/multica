"use client";

import type { AgentConversationStarter } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../../i18n";

/**
 * The generic suggestions a new chat shows for an agent whose owner
 * configured none. This is the ONLY definition of them: the settings preview
 * renders the same hook, so an author configuring an agent sees exactly what
 * a real new chat will show rather than a hand-maintained mock of it.
 */
export function useFallbackConversationStarters(): AgentConversationStarter[] {
  const { t } = useT("chat");
  return [
    {
      label: t(($) => $.conversation_starters.capabilities.label),
      prompt: t(($) => $.conversation_starters.capabilities.prompt),
    },
    {
      label: t(($) => $.conversation_starters.first_task.label),
      prompt: t(($) => $.conversation_starters.first_task.prompt),
    },
    {
      label: t(($) => $.conversation_starters.recommend.label),
      prompt: t(($) => $.conversation_starters.recommend.prompt),
    },
  ];
}

const ROW_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-left text-body text-foreground";

/**
 * The stack of starter buttons in a chat's empty state.
 *
 * Omit `onPick` to render the same rows as inert presentation — that is the
 * settings preview, which must look like the real thing without offering a
 * second, non-functional way to "send" a prompt from a settings page.
 */
export function ConversationStarterList({
  starters,
  onPick,
  className,
}: {
  starters: AgentConversationStarter[];
  onPick?: (prompt: string) => void;
  className?: string;
}) {
  if (!onPick) {
    return (
      <div className={cn("w-full space-y-2", className)} aria-hidden="true">
        {starters.map((item, index) => (
          <div key={index} className={cn(ROW_CLASS, "truncate")}>
            {item.label}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("w-full space-y-2", className)}>
      {starters.map((item, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onPick(item.prompt)}
          className={cn(
            ROW_CLASS,
            "transition-colors hover:border-brand/40 hover:bg-accent",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Starters as a row of pills; a click hands over the full prompt, which the caller sends as is. */
export function ConversationStarterChips({
  starters,
  onPick,
  className,
}: {
  starters: AgentConversationStarter[];
  onPick: (prompt: string) => void;
  className?: string;
}) {
  const { t } = useT("chat");
  if (starters.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t(($) => $.conversation_starters.aria_label)}
      className={cn("flex min-w-0 flex-wrap gap-1.5", className)}
    >
      {starters.map((item, index) => (
        <Button
          key={index}
          type="button"
          variant="outline"
          size="sm"
          className="max-w-full min-w-0 rounded-full"
          title={item.prompt}
          onClick={() => onPick(item.prompt)}
        >
          <span className="truncate">{item.label}</span>
        </Button>
      ))}
    </div>
  );
}
