"use client";

import { useEffect } from "react";
import { clearForegroundChatId, setForegroundChatId } from "@multica/core/platform";

/**
 * Report the conversation on screen so a browser notification is skipped only
 * while the user is already reading it. Pass null when no thread is open.
 */
export function useForegroundChat(chatId: string | null): void {
  useEffect(() => {
    setForegroundChatId(chatId);
    return () => clearForegroundChatId(chatId);
  }, [chatId]);
}
