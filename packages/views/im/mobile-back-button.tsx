"use client";

import { ChevronLeft } from "lucide-react";
import { useBackOrReplace } from "../navigation";

/**
 * Steps back to the previous level, or replaces with `fallback` when the level
 * was opened cold (a shared link, a refresh) and history would leave the app.
 */
export function MobileBackButton({ fallback, label }: { fallback: string; label: string }) {
  const backOrReplace = useBackOrReplace();
  return (
    <button
      type="button"
      onClick={() => backOrReplace(fallback)}
      aria-label={label}
      className="relative flex size-9 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ChevronLeft className="size-6" />
    </button>
  );
}
