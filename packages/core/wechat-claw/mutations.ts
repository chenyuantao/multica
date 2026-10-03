import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { wechatClawKeys } from "./queries";

/** Removes the binding; the status refetches from the server's answer. */
export function useUnbindWechatClaw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteWechatClaw(),
    onSettled: () => qc.invalidateQueries({ queryKey: wechatClawKeys.all() }),
  });
}
