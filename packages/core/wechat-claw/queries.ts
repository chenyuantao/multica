import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

/** Account-level: a user has one WeChat Claw, whatever workspace is open. */
export const wechatClawKeys = {
  all: () => ["wechat-claw"] as const,
  status: () => [...wechatClawKeys.all(), "status"] as const,
};

export const wechatClawStatusOptions = () =>
  queryOptions({
    queryKey: wechatClawKeys.status(),
    queryFn: () => api.getWechatClaw(),
  });
