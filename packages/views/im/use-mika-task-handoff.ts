"use client";

import { useCallback } from "react";
import { takeMikaTaskChat } from "@multica/core/group-chats";
import { useWorkspacePaths } from "@multica/core/paths";
import { useWSEvent } from "@multica/core/realtime";
import type { GroupChatUpdatedPayload } from "@multica/core/types";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { useNavigation } from "../navigation";

/**
 * After Cmd+O reaches Mika, open the task group she starts. The event is
 * matched to the message just sent; other group updates stay where they are.
 */
export function useMikaTaskHandoff(): void {
  const navigation = useNavigation();
  const paths = useWorkspacePaths();
  const isMobile = useIsMobile();
  const onUpdated = useCallback(
    (payload: unknown) => {
      const event = payload as GroupChatUpdatedPayload;
      if (!event?.issue_id || !takeMikaTaskChat(event.ask_comment_id)) return;
      const href = paths.imChat(event.issue_id);
      if (isMobile) navigation.push(href);
      else navigation.replace(href);
    },
    [isMobile, navigation, paths],
  );
  useWSEvent("group_chat:updated", onUpdated);
}
