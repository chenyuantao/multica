// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isFloatingChatRouteSuppressed } from "./floating-chat-visibility";

const SUPPRESSED = ["/acme/chat", "/acme/settings"];

describe("floating chat route suppression", () => {
  it("suppresses the overlay on the Chat tab, Settings, and their sub-routes", () => {
    expect(isFloatingChatRouteSuppressed("/acme/chat", SUPPRESSED)).toBe(true);
    expect(isFloatingChatRouteSuppressed("/acme/chat/session-1", SUPPRESSED)).toBe(true);
    expect(isFloatingChatRouteSuppressed("/acme/settings", SUPPRESSED)).toBe(true);
    expect(isFloatingChatRouteSuppressed("/acme/settings/preferences", SUPPRESSED)).toBe(true);
  });

  it("keeps the overlay on every other route, including prefix look-alikes", () => {
    expect(isFloatingChatRouteSuppressed("/acme/issues", SUPPRESSED)).toBe(false);
    // A sibling route that merely starts with the same characters is not the
    // Chat tab — matching on the bare prefix would hide chat from it.
    expect(isFloatingChatRouteSuppressed("/acme/chatter", SUPPRESSED)).toBe(false);
    // Another workspace's chat tab is a different route too.
    expect(isFloatingChatRouteSuppressed("/other/chat", SUPPRESSED)).toBe(false);
  });
});
