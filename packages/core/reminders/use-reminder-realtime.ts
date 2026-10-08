"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWSEvent, useWSReconnect } from "../realtime/hooks";
import { reminderKeys } from "./queries";

/**
 * Keeps the reminder lists fresh: members joining, agents starting or
 * finishing, and edits, pins, or deletes made elsewhere. The open reminder's
 * messages follow the group chat realtime hook.
 */
export function useReminderRealtime(wsId: string) {
  const qc = useQueryClient();
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: reminderKeys.all(wsId) }), [qc, wsId]);

  useWSEvent("group_chat:updated", refresh);
  useWSEvent("comment:created", refresh);
  useWSEvent("issue:updated", refresh);
  useWSEvent("issue_metadata:changed", refresh);
  useWSEvent("issue:deleted", refresh);
  useWSEvent("task:queued", refresh);
  useWSEvent("task:completed", refresh);
  useWSEvent("task:failed", refresh);
  useWSEvent("task:cancelled", refresh);
  useWSReconnect(refresh);
}
