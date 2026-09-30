"use client";

import { useState } from "react";
import type { AskAIPage, AskAISelection } from "@multica/core/types";

export interface AskAIDialogState {
  open: boolean;
  /** Sent with the question and quoted above the input. */
  context: AskAIPage | null;
  onOpenChange: (open: boolean) => void;
  onClearContext: () => void;
}

/**
 * Open state of the IM quick switcher. The page is read once, when it opens,
 * so the quoted context is exactly what a question sends.
 */
export function useAskAILauncher(askPage?: () => AskAIPage | null) {
  const [state, setState] = useState<{ open: boolean; context: AskAIPage | null }>({ open: false, context: null });
  const show = (selection?: AskAISelection) => {
    const page = askPage?.() ?? null;
    setState({ open: true, context: selection ? { ...page, selection } : page });
  };
  const dialog: AskAIDialogState = {
    ...state,
    onOpenChange: (open) => (open ? show() : setState({ open: false, context: null })),
    onClearContext: () => setState((s) => ({ ...s, context: null })),
  };
  return { show, dialog };
}
