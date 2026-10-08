import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";
import type { ListRemindersParams } from "../types";

export const reminderKeys = {
  all: (wsId: string) => ["reminders", wsId] as const,
  list: (wsId: string, params: ListRemindersParams) =>
    [...reminderKeys.all(wsId), "list", params.from ?? "", params.to ?? "", params.status ?? ""] as const,
};

export function reminderListOptions(wsId: string, params: ListRemindersParams) {
  return queryOptions({
    queryKey: reminderKeys.list(wsId, params),
    queryFn: () => api.listReminders(params),
  });
}
