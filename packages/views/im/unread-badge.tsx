"use client";

import { cn } from "@multica/ui/lib/utils";

/** Messenger-style unread count; renders nothing at zero. */
export function UnreadBadge({ count, label, className }: { count: number; label: string; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label}
      // Softer, warmer red than the vivid `destructive` token — an IM unread
      // badge, not an error. Matches the agent chat list badge.
      className={cn(
        "inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[oklch(0.62_0.14_18)] px-1 text-micro font-semibold text-white tabular-nums",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
