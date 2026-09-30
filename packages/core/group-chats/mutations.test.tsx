/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { setApiInstance } from "../api";
import type { ApiClient } from "../api/client";
import { inboxKeys } from "../inbox/queries";
import { createQueryClient } from "../query-client";
import type { GroupChat } from "../types";
import { useAskAI, useMarkGroupChatRead, useSetGroupChatPinned } from "./mutations";
import { countUnreadGroupChatMessages, groupChatKeys } from "./queries";

const WS = "ws-1";

function chat(id: string, unread: number): GroupChat {
  return {
    id,
    workspace_id: WS,
    identifier: id,
    title: id,
    description: "",
    creator_type: "member",
    creator_id: "user-1",
    created_at: "2026-09-28T00:00:00Z",
    last_comment_at: null,
    last_message: null,
    members: [],
    pending_speakers: [],
    unread_count: unread,
    is_direct: false,
    pinned: false,
  };
}

describe("countUnreadGroupChatMessages", () => {
  it("sums unread messages and leaves out the chat being read", () => {
    const chats = [chat("a", 3), chat("b", 2), chat("c", 0)];
    expect(countUnreadGroupChatMessages(chats)).toBe(5);
    expect(countUnreadGroupChatMessages(chats, "a")).toBe(2);
    expect(countUnreadGroupChatMessages(undefined)).toBe(0);
  });
});

describe("useMarkGroupChatRead", () => {
  function setup(markGroupChatRead: ReturnType<typeof vi.fn>) {
    const qc = createQueryClient();
    qc.setQueryData(groupChatKeys.list(WS), [chat("a", 3), chat("b", 2)]);
    qc.setQueryData(inboxKeys.unreadSummary(), [{ workspace_id: WS, count: 2, badge_count: 5 }]);
    setApiInstance({
      markGroupChatRead,
      listGroupChats: vi.fn(async () => [chat("a", 0), chat("b", 2)]),
      listInbox: vi.fn(async () => []),
      getInboxUnreadSummary: vi.fn(async () => [{ workspace_id: WS, count: 1, badge_count: 2 }]),
    } as unknown as ApiClient);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useMarkGroupChatRead(WS, "a"), { wrapper });
    const unreadOf = (id: string) =>
      qc.getQueryData<GroupChat[]>(groupChatKeys.list(WS))?.find((c) => c.id === id)?.unread_count;
    return { qc, result, unreadOf };
  }

  it("clears the chat at once and refreshes the app badge from the server", async () => {
    let resolve!: () => void;
    const markGroupChatRead = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const { qc, result, unreadOf } = setup(markGroupChatRead);

    act(() => result.current.mutate());
    await waitFor(() => expect(unreadOf("a")).toBe(0));
    expect(unreadOf("b")).toBe(2);
    expect(markGroupChatRead).toHaveBeenCalledWith("a");

    await act(async () => resolve());
    await waitFor(() =>
      expect(qc.getQueryState(inboxKeys.unreadSummary())?.isInvalidated).toBe(true),
    );
  });

  it("restores the count when the request fails", async () => {
    const { result, unreadOf } = setup(vi.fn(async () => Promise.reject(new Error("offline"))));

    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(unreadOf("a")).toBe(3);
  });
});

describe("useSetGroupChatPinned", () => {
  function setup(setGroupChatPinned: ReturnType<typeof vi.fn>) {
    const qc = createQueryClient();
    qc.setQueryData(groupChatKeys.list(WS), [chat("a", 0), chat("b", 0)]);
    setApiInstance({
      setGroupChatPinned,
      listGroupChats: vi.fn(async () => [{ ...chat("a", 0), pinned: true }, chat("b", 0)]),
    } as unknown as ApiClient);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSetGroupChatPinned(WS), { wrapper });
    const pinnedOf = (id: string) =>
      qc.getQueryData<GroupChat[]>(groupChatKeys.list(WS))?.find((c) => c.id === id)?.pinned;
    return { result, pinnedOf };
  }

  it("pins the chat at once", async () => {
    const setGroupChatPinned = vi.fn(() => new Promise(() => {}));
    const { result, pinnedOf } = setup(setGroupChatPinned);

    act(() => result.current.mutate({ chatId: "a", pinned: true }));
    await waitFor(() => expect(pinnedOf("a")).toBe(true));
    expect(pinnedOf("b")).toBe(false);
    expect(setGroupChatPinned).toHaveBeenCalledWith("a", true);
  });

  it("restores the pin state when the request fails", async () => {
    const { result, pinnedOf } = setup(vi.fn(async () => Promise.reject(new Error("offline"))));

    act(() => result.current.mutate({ chatId: "a", pinned: true }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(pinnedOf("a")).toBe(false);
  });
});

describe("useAskAI", () => {
  function setup(askAI: ReturnType<typeof vi.fn>) {
    const qc = createQueryClient();
    qc.setQueryData(groupChatKeys.list(WS), [chat("a", 0)]);
    const api = {
      askAI,
      openDirectGroupChat: vi.fn(async () => chat("direct", 0)),
      createComment: vi.fn(async () => ({ id: "m1" })),
      uploadFile: vi.fn(async (file: File) => ({
        id: `att-${file.name}`,
        filename: file.name,
        content_type: file.type,
        url: "",
        markdown_url: `https://cdn/${file.name}`,
      })),
      listGroupChats: vi.fn(async () => [chat("direct", 0), chat("a", 0)]),
      listComments: vi.fn(async () => [{ id: "m1" }]),
    };
    setApiInstance(api as unknown as ApiClient);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return { qc, api, ...renderHook(() => useAskAI(WS), { wrapper }) };
  }

  it("sends the question to the direct chat of the chosen agent", async () => {
    const { qc, api, result } = setup(vi.fn(async () => "agent-7"));
    let out: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({ query: "why?", page: null });
    });

    expect(api.askAI).toHaveBeenCalledWith({ query: "why?", page: null });
    expect(api.openDirectGroupChat).toHaveBeenCalledWith({ member_type: "agent", member_id: "agent-7" });
    expect(api.createComment).toHaveBeenCalledWith("direct", "why?", undefined, undefined, [], undefined, undefined, undefined, null);
    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(out?.chat.id).toBe("direct");
    expect(qc.getQueryData<GroupChat[]>(groupChatKeys.list(WS))?.[0]?.id).toBe("direct");
  });

  it("uploads files into the chosen chat and sends the page with the message", async () => {
    const { api, result } = setup(vi.fn(async () => "agent-7"));
    const page = { selection: { message_id: "x", time: "t", sender: "Ann", content: "it broke" } };
    const files = [new File(["x"], "shot.png", { type: "image/png" }), new File(["y"], "log.txt", { type: "text/plain" })];
    await act(async () => {
      await result.current.mutateAsync({ query: "", page, files });
    });

    expect(api.askAI).toHaveBeenCalledWith({
      query: "",
      page,
      attachments: [
        { name: "shot.png", content_type: "image/png" },
        { name: "log.txt", content_type: "text/plain" },
      ],
    });
    expect(api.uploadFile).toHaveBeenCalledWith(files[0], { issueId: "direct" });
    expect(api.createComment).toHaveBeenCalledWith(
      "direct",
      "![shot.png](https://cdn/shot.png)\n\n[log.txt](https://cdn/log.txt)",
      undefined,
      undefined,
      ["att-shot.png", "att-log.txt"],
      undefined,
      undefined,
      undefined,
      page,
    );
  });

  it("opens no chat when no agent was chosen", async () => {
    const { api, result } = setup(vi.fn(async () => ""));
    await act(async () => {
      await expect(result.current.mutateAsync({ query: "why?", page: null })).rejects.toThrow();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.openDirectGroupChat).not.toHaveBeenCalled();
  });
});
