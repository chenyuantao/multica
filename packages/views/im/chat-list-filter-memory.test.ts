// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { StorageAdapter } from "@multica/core/types";
import { readChatListFilter, writeChatListFilter } from "./chat-list-filter-memory";
import type { ChatListFilterState } from "./chat-list-filter";
import { fromDateKey, toDateKey } from "./reminder-dates";

function memory(): StorageAdapter & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => {
      raw.set(key, value);
    },
    removeItem: (key) => {
      raw.delete(key);
    },
    keys: () => [...raw.keys()],
  };
}

function state(extra: Partial<ChatListFilterState> = {}): ChatListFilterState {
  return {
    scope: "todo",
    view: "week",
    anchor: fromDateKey("2026-10-06"),
    todayKey: "2026-10-13",
    tags: new Set(["docs"]),
    hideCompleted: true,
    ...extra,
  };
}

describe("chat list filter memory", () => {
  it("round-trips the filter and uses the new day as today", () => {
    const storage = memory();
    writeChatListFilter("ws-1", state(), storage);
    const restored = readChatListFilter("ws-1", "2026-10-14", storage);
    expect(restored.scope).toBe("todo");
    expect(restored.view).toBe("week");
    expect(restored.hideCompleted).toBe(true);
    expect([...restored.tags]).toEqual(["docs"]);
    expect(toDateKey(restored.anchor)).toBe("2026-10-06");
    expect(restored.todayKey).toBe("2026-10-14");
  });

  it("ignores a broken or unknown value", () => {
    const storage = memory();
    storage.setItem("multica:im-chat-filter:ws-1", "{");
    expect(readChatListFilter("ws-1", "2026-10-13", storage).scope).toBe("all");
    storage.setItem("multica:im-chat-filter:ws-1", JSON.stringify({ scope: "nope", view: "later", anchorKey: "soon" }));
    const restored = readChatListFilter("ws-1", "2026-10-13", storage);
    expect(restored.scope).toBe("all");
    expect(restored.view).toBeNull();
    expect(toDateKey(restored.anchor)).toBe("2026-10-13");
  });

  it("keeps workspaces apart", () => {
    const storage = memory();
    writeChatListFilter("ws-1", state(), storage);
    expect(readChatListFilter("ws-2", "2026-10-13", storage).scope).toBe("all");
  });
});
