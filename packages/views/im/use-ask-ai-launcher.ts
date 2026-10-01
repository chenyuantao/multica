"use client";

import { useState } from "react";
import type { AskAIPage, AskAISelection } from "@multica/core/types";

export interface AskAIDialogState {
  open: boolean;
  /** The page it was opened on; always sent with the question and never shown. */
  page: AskAIPage | null;
  /** The message it was opened about; quoted above the input and removable. */
  selection: AskAISelection | null;
  onOpenChange: (open: boolean) => void;
  onClearSelection: () => void;
}

/**
 * Open state of the IM quick switcher. The page is read once, when it opens,
 * so a question sends what was on screen at that moment.
 */
export function useAskAILauncher(askPage?: () => AskAIPage | null) {
  const [state, setState] = useState<Pick<AskAIDialogState, "open" | "page" | "selection">>({
    open: false,
    page: null,
    selection: null,
  });
  const show = (selection?: AskAISelection) =>
    setState({ open: true, page: askPage?.() ?? null, selection: selection ?? null });
  const dialog: AskAIDialogState = {
    ...state,
    onOpenChange: (open) => (open ? show() : setState({ open: false, page: null, selection: null })),
    onClearSelection: () => setState((s) => ({ ...s, selection: null })),
  };
  return { show, dialog };
}
