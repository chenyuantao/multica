"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";

/** Opens Ask AI with what the page shows as context. */
export function AskAIBadge({ onClick, className }: { onClick: () => void; className?: string }) {
  const { t } = useT("im");
  const label = t(($) => $.search.ask_ai);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      className={cn(
        "ai-gradient relative inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-caption font-semibold text-white shadow-sm transition-[filter] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      <Sparkles aria-hidden className="size-3.5" strokeWidth={2} />
      AI
    </button>
  );
}
