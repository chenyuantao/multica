"use client";

import { useCallback, useEffect, useRef } from "react";
import { useModalStore } from "@multica/core/modals";
import { Dialog, DialogContent } from "@multica/ui/components/ui/dialog";
import { AgentDetail } from "../agents/components/agent-detail-page";
import { useNavigation, useOptionalNavigation } from "../navigation";

/**
 * Opens the agent detail modal over the current route. The host pathname
 * travels with the modal data: on web, leaving a full-window route (e.g.
 * `/im`) for a dashboard one swaps to a different ModalRegistry instance,
 * which has no other way to know the modal belonged to the previous page.
 */
export function useOpenAgentDetail() {
  const pathname = useOptionalNavigation()?.pathname;
  return useCallback(
    (agentId: string) =>
      useModalStore
        .getState()
        .open("agent-detail", { agentId, hostPathname: pathname }),
    [pathname],
  );
}

/**
 * The agent detail surface as a modal over the current route. Opening it
 * never touches the URL; any navigation that leaves the host route (DM,
 * "open full page", links inside the tabs) closes it, because the modal
 * store is global and would otherwise follow the user to the next page.
 */
export function AgentDetailModal({
  onClose,
  data,
}: {
  onClose: () => void;
  data: Record<string, unknown> | null;
}) {
  const agentId = typeof data?.agentId === "string" ? data.agentId : "";
  const { pathname } = useNavigation();
  const hostPathRef = useRef(
    typeof data?.hostPathname === "string" ? data.hostPathname : pathname,
  );

  useEffect(() => {
    if (pathname !== hostPathRef.current) onClose();
  }, [pathname, onClose]);

  useEffect(() => {
    if (!agentId) onClose();
  }, [agentId, onClose]);

  if (!agentId) return null;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="flex h-[min(56rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <AgentDetail agentId={agentId} presentation="modal" onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
