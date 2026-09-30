"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWSEvent, useWSReconnect } from "../realtime/hooks";
import type { CommentCreatedPayload, CommentDeletedPayload } from "../types/events";
import { groupChatKeys } from "./queries";

/**
 * Keeps the group chat list and the open chat's messages fresh. The server
 * delivers a chat's events only to its members, so every event that names an
 * issue here belongs to a chat this user can see.
 */
export function useGroupChatRealtime(wsId: string) {
  const qc = useQueryClient();

  const refreshChat = useCallback(
    (issueId: string | undefined) => {
      qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) });
      if (issueId) qc.invalidateQueries({ queryKey: groupChatKeys.messages(wsId, issueId) });
    },
    [qc, wsId],
  );

  const onCommentChanged = useCallback(
    (payload: unknown) => refreshChat((payload as CommentCreatedPayload | undefined)?.comment?.issue_id),
    [refreshChat],
  );
  const onCommentDeleted = useCallback(
    (payload: unknown) => refreshChat((payload as CommentDeletedPayload | undefined)?.issue_id),
    [refreshChat],
  );
  const onChatUpdated = useCallback(
    () => qc.invalidateQueries({ queryKey: groupChatKeys.list(wsId) }),
    [qc, wsId],
  );
  const onReconnect = useCallback(
    () => qc.invalidateQueries({ queryKey: groupChatKeys.all(wsId) }),
    [qc, wsId],
  );

  const onTaskChanged = useCallback(
    (payload: unknown) => refreshChat((payload as { issue_id?: string } | undefined)?.issue_id),
    [refreshChat],
  );

  useWSEvent("comment:created", onCommentChanged);
  useWSEvent("comment:updated", onCommentChanged);
  useWSEvent("comment:deleted", onCommentDeleted);
  useWSEvent("group_chat:updated", onChatUpdated);
  useWSEvent("task:queued", onTaskChanged);
  useWSEvent("task:running", onTaskChanged);
  useWSEvent("task:completed", onTaskChanged);
  useWSEvent("task:failed", onTaskChanged);
  useWSEvent("task:cancelled", onTaskChanged);
  useWSReconnect(onReconnect);
}
