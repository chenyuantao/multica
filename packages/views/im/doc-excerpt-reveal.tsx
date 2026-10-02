"use client";

import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import type { DocExcerpt } from "./doc-excerpt";
import type { KnowledgeNoteTab } from "./knowledge-note-tabs";

export interface ExcerptReveal {
  path: string;
  text: string;
  from?: number;
  /** Changes on every click, so selecting the same passage again still runs. */
  id: number;
}

interface RevealApi {
  current: ExcerptReveal | null;
  reveal: (excerpt: DocExcerpt) => void;
}

const RevealContext = createContext<RevealApi>({ current: null, reveal: () => {} });

/**
 * A click on a composer excerpt opens that note and asks its editor to select
 * the passage. The note may still be loading, so the request stays here until
 * the editor can take it.
 */
export function DocExcerptRevealProvider({
  onOpen,
  children,
}: {
  onOpen: (note: KnowledgeNoteTab) => void;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState<ExcerptReveal | null>(null);
  const seq = useRef(0);
  const reveal = useCallback(
    (excerpt: DocExcerpt) => {
      onOpen({ path: excerpt.path, name: excerpt.name });
      seq.current += 1;
      setCurrent({
        path: excerpt.path,
        text: excerpt.text,
        from: excerpt.from,
        id: seq.current,
      });
    },
    [onOpen],
  );
  const value = useMemo(() => ({ current, reveal }), [current, reveal]);
  return <RevealContext value={value}>{children}</RevealContext>;
}

export function useExcerptReveal(): ExcerptReveal | null {
  return use(RevealContext).current;
}

export function useRevealDocExcerpt(): (excerpt: DocExcerpt) => void {
  return use(RevealContext).reveal;
}
