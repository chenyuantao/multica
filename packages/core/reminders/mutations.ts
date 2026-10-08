import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CreateReminderRequest, Reminder, ReminderPatch } from "../types";
import { reminderKeys } from "./queries";

/** Issue metadata key that pins an unfinished reminder above the days. */
export const REMINDER_PENDING_KEY = "reminder_pending";

type Snapshot = [readonly unknown[], Reminder[] | undefined][];

async function patchLists(qc: QueryClient, wsId: string, patch: (r: Reminder) => Reminder): Promise<Snapshot> {
  await qc.cancelQueries({ queryKey: reminderKeys.all(wsId) });
  const prev = qc.getQueriesData<Reminder[]>({ queryKey: reminderKeys.all(wsId) });
  qc.setQueriesData<Reminder[]>({ queryKey: reminderKeys.all(wsId) }, (old) => old?.map(patch));
  return prev;
}

function restore(qc: QueryClient, prev: Snapshot | undefined) {
  for (const [key, data] of prev ?? []) qc.setQueryData(key, data);
}

export function useCreateReminder(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReminderRequest) => api.createReminder(data),
    onSuccess: (created) => {
      qc.setQueriesData<Reminder[]>({ queryKey: reminderKeys.all(wsId) }, (old) =>
        old && !old.some((r) => r.id === created.id) ? [...old, created] : old,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: reminderKeys.all(wsId) }),
  });
}

/**
 * Edits reminders in place: title, day, order, and checking off. Rows change
 * at once and roll back together if any write fails.
 */
export function useUpdateReminders(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: { id: string; patch: ReminderPatch }[]) =>
      Promise.all(
        updates.map(({ id, patch }) =>
          api.updateIssue(id, {
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
            ...(patch.position !== undefined ? { position: patch.position } : {}),
            ...(patch.done !== undefined ? { status: patch.done ? "done" : "todo" } : {}),
          }),
        ),
      ),
    onMutate: async (updates) => {
      const byId = new Map(updates.map((u) => [u.id, u.patch]));
      const now = new Date().toISOString();
      const prev = await patchLists(qc, wsId, (r) => {
        const patch = byId.get(r.id);
        if (!patch) return r;
        const { done, ...fields } = patch;
        return {
          ...r,
          ...fields,
          ...(done !== undefined ? { status: done ? "done" : "todo" } : {}),
          updated_at: now,
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => restore(qc, ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: reminderKeys.all(wsId) }),
  });
}

/** Pins reminders above the days, or lets them go back to their day. */
export function useSetRemindersPending(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, pending }: { ids: string[]; pending: boolean }) =>
      Promise.all(
        ids.map((id) =>
          pending
            ? api.setIssueMetadataKey(id, REMINDER_PENDING_KEY, true)
            : api.deleteIssueMetadataKey(id, REMINDER_PENDING_KEY),
        ),
      ),
    onMutate: async ({ ids, pending }) => {
      const picked = new Set(ids);
      const prev = await patchLists(qc, wsId, (r) => (picked.has(r.id) ? { ...r, pending } : r));
      return { prev };
    },
    onError: (_err, _vars, ctx) => restore(qc, ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: reminderKeys.all(wsId) }),
  });
}

/** Deletes reminders once the server confirms; rows stay until then. */
export function useDeleteReminders(wsId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => api.deleteIssue(id))),
    onSuccess: (_void, ids) => {
      const gone = new Set(ids);
      qc.setQueriesData<Reminder[]>({ queryKey: reminderKeys.all(wsId) }, (old) => old?.filter((r) => !gone.has(r.id)));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: reminderKeys.all(wsId) }),
  });
}
