"use client";

import { useWorkspacePaths } from "@multica/core/paths";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";
import { AppLink } from "../navigation";

/** Phone switcher at the top of Me: settings stays put, favorites is the other page. */
export function MeSectionTabs({ active }: { active: "settings" | "collect" }) {
  const { t } = useT("im");
  const paths = useWorkspacePaths();
  const tabs = [
    { id: "settings" as const, href: paths.settings(), label: t(($) => $.collect.settings) },
    { id: "collect" as const, href: paths.collect(), label: t(($) => $.rail.collect) },
  ];

  return (
    <div className="flex shrink-0 justify-center border-b bg-sidebar px-4 py-2">
      <nav
        aria-label={t(($) => $.collect.switcher)}
        className="grid w-full max-w-xs grid-cols-2 rounded-lg bg-foreground/5 p-0.5"
      >
        {tabs.map(({ id, href, label }) => (
          <AppLink
            key={id}
            href={href}
            aria-current={active === id ? "page" : undefined}
            className={cn(
              "rounded-md py-1.5 text-center text-label transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active === id
                ? "bg-background font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </AppLink>
        ))}
      </nav>
    </div>
  );
}
