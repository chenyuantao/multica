"use client";

import { useQuery } from "@tanstack/react-query";
import { isMikaAgent, mikaCanTakeWork } from "@multica/core/onboarding";
import { agentListOptions } from "@multica/core/workspace";

/** Mika, when Cmd+O may hand her a question. */
export function useMikaForAsk(wsId: string) {
  const query = useQuery({ ...agentListOptions(wsId), enabled: !!wsId });
  const mika = query.data?.find(isMikaAgent);
  return {
    agentId: mika?.id ?? "",
    ready: mikaCanTakeWork(mika),
    loading: query.isLoading,
  };
}
