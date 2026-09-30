"use client";

import { useEffect, useRef } from "react";
import { useStartDirectChat } from "./use-direct-chat";

export const AGENT_DOUBLE_CLICK_MS = 250;

export type AgentClickActions = ReturnType<typeof useAgentClickActions>;

/**
 * Click handlers for an agent's avatar or name: a click opens its profile,
 * a double click opens the direct chat with it instead. The profile waits out
 * the double-click window so a double click never flashes it first.
 */
export function useAgentClickActions(wsId: string, openProfile: (agentId: string) => void) {
  const directChat = useStartDirectChat(wsId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return {
    open: (agentId: string) => {
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        openProfile(agentId);
      }, AGENT_DOUBLE_CLICK_MS);
    },
    chat: (agentId: string) => {
      cancel();
      void directChat.start({ member_type: "agent", member_id: agentId });
    },
  };
}
