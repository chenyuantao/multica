"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";

/** Expandable tree for inspecting a JSON value. */
export function JsonViewer({ value, className }: { value: unknown; className?: string }) {
  return (
    <div className={cn("overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-caption", className)}>
      <JsonNode name={null} value={value} depth={0} />
    </div>
  );
}

function JsonNode({ name, value, depth }: { name: string | null; value: unknown; depth: number }) {
  if (value === null) return <Leaf name={name} value={<Null />} />;
  if (typeof value === "boolean") return <Leaf name={name} value={<Bool value={value} />} />;
  if (typeof value === "number") return <Leaf name={name} value={<Num value={value} />} />;
  if (typeof value === "string") return <Leaf name={name} value={<Str value={value} />} />;
  if (Array.isArray(value)) {
    return <Branch name={name} openLabel="[" closeLabel="]" empty="[]" depth={depth} entries={value.map((item, i) => [String(i), item])} />;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return <Branch name={name} openLabel="{" closeLabel="}" empty="{}" depth={depth} entries={entries} />;
  }
  return <Leaf name={name} value={<span className="text-muted-foreground">{String(value)}</span>} />;
}

function Branch({
  name,
  openLabel,
  closeLabel,
  empty,
  depth,
  entries,
}: {
  name: string | null;
  openLabel: string;
  closeLabel: string;
  empty: string;
  depth: number;
  entries: [string, unknown][];
}) {
  const [open, setOpen] = useState(depth < 2);
  if (entries.length === 0) {
    return (
      <div className="flex min-w-0 items-start gap-1 whitespace-pre-wrap break-all">
        {name !== null ? <Key name={name} /> : null}
        <span className="text-muted-foreground">{empty}</span>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-w-0 max-w-full items-start gap-1 rounded-sm text-left hover:bg-foreground/5"
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
        {name !== null ? <Key name={name} /> : null}
        <span className="text-muted-foreground">
          {openLabel}
          {!open ? ` ${entries.length} ${closeLabel}` : null}
        </span>
      </button>
      {open ? (
        <div className="ml-3 border-l border-border/70 pl-2">
          {entries.map(([key, child]) => (
            <JsonNode key={key} name={key} value={child} depth={depth + 1} />
          ))}
          <div className="text-muted-foreground">{closeLabel}</div>
        </div>
      ) : null}
    </div>
  );
}

function Leaf({ name, value }: { name: string | null; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-1 whitespace-pre-wrap break-all">
      {name !== null ? <Key name={name} /> : null}
      {value}
    </div>
  );
}

function Key({ name }: { name: string }) {
  return (
    <>
      <span className="text-sky-700 dark:text-sky-300">{JSON.stringify(name)}</span>
      <span className="text-muted-foreground">: </span>
    </>
  );
}

function Str({ value }: { value: string }) {
  return <span className="text-emerald-700 dark:text-emerald-300">{JSON.stringify(value)}</span>;
}

function Num({ value }: { value: number }) {
  return <span className="text-amber-700 dark:text-amber-300">{String(value)}</span>;
}

function Bool({ value }: { value: boolean }) {
  return <span className="text-violet-700 dark:text-violet-300">{String(value)}</span>;
}

function Null() {
  return <span className="text-muted-foreground">null</span>;
}
