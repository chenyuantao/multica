// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { setApiInstance } from "../api";
import type { ApiClient } from "../api/client";
import type { Reminder } from "../types";
import { reminderListOptions } from "./queries";

const WS_ID = "ws-1";

describe("reminderListOptions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refetches a cached list when the to-do page subscribes again", async () => {
    const cached = [{ id: "old" }] as Reminder[];
    const fresh = [{ id: "fresh" }] as Reminder[];
    const listReminders = vi.fn().mockResolvedValue(fresh);
    setApiInstance({ listReminders } as unknown as ApiClient);

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: true } },
    });
    const options = reminderListOptions(WS_ID, {});
    qc.setQueryData(options.queryKey, cached);

    const observer = new QueryObserver(qc, options);
    const unsubscribe = observer.subscribe(() => {});

    await vi.waitFor(() => {
      expect(listReminders).toHaveBeenCalledOnce();
      expect(observer.getCurrentResult().data).toEqual(fresh);
    });

    unsubscribe();
    qc.clear();
  });
});
