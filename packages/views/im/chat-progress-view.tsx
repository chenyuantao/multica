"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTaskMessages } from "@multica/core/chat/queries";
import { useCancelIssueRun } from "@multica/core/issues/mutations";
import { issueTasksOptions } from "@multica/core/issues/queries";
import { useWorkspacePaths } from "@multica/core/paths";
import type { AgentTask } from "@multica/core/types";
import { useActorName } from "@multica/core/workspace/hooks";
import { AgentTranscriptDialog } from "../common/task-transcript/agent-transcript-dialog";
import { buildTimeline } from "../common/task-transcript/build-timeline";
import { useT } from "../i18n";
import { MobileLevel } from "./mobile-shell";

const ACTIVE_STATUS = new Set<AgentTask["status"]>([
  "queued",
  "dispatched",
  "waiting_local_directory",
  "deferred",
  "running",
]);

/** Enough for the transcript before the chat's task list has loaded. */
function placeholderRun(chatId: string, taskId: string): AgentTask {
  return {
    id: taskId,
    agent_id: "",
    issue_id: chatId,
    runtime_id: "",
    status: "running",
    priority: 0,
    dispatched_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    error: null,
    created_at: "",
    kind: "comment",
  };
}

/**
 * Phone level for the run behind a thinking bubble. Desktop opens the same
 * transcript in a dialog; this page uses the level's back control instead.
 */
export function ChatProgressRoute({ chatId, taskId }: { chatId: string; taskId: string }) {
  const { t } = useT("im");
  const paths = useWorkspacePaths();
  const { getActorName } = useActorName();
  const tasks = useQuery({ ...issueTasksOptions(chatId), enabled: taskId.length > 0 });
  const task = tasks.data?.find((item) => item.id === taskId);
  const shown = task ?? placeholderRun(chatId, taskId);
  const active = task ? ACTIVE_STATUS.has(task.status) : tasks.isPending;
  const messages = useTaskMessages(taskId, active, taskId.length > 0);
  const items = useMemo(() => buildTimeline(messages.data ?? []), [messages.data]);
  const cancel = useCancelIssueRun(chatId);
  const stopping = cancel.isPending || cancel.isSuccess;
  const agentName = shown.agent_id ? getActorName("agent", shown.agent_id) : "";

  return (
    <MobileLevel
      title={t(($) => $.thread.view_progress)}
      backHref={paths.imChat(chatId)}
      backLabel={t(($) => $.panel.back)}
    >
      {taskId ? (
        <AgentTranscriptDialog
          presentation="page"
          open
          onOpenChange={() => {}}
          task={shown}
          items={items}
          agentName={agentName}
          isLive={active}
          stopping={stopping}
          onStop={
            active
              ? () => cancel.mutate(taskId, { onError: () => toast.error(t(($) => $.thread.stop_failed)) })
              : undefined
          }
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <p className="text-body">{t(($) => $.thread.not_found)}</p>
        </div>
      )}
    </MobileLevel>
  );
}
