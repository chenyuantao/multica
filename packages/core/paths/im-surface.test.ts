// @vitest-environment node

import { describe, expect, it } from "vitest";
import { imSurfaceSegment, isImSurfaceLocalNav } from "./im-surface";

describe("imSurfaceSegment", () => {
  it("names the five full-window IM tabs", () => {
    expect(imSurfaceSegment("/acme/im")).toBe("im");
    expect(imSurfaceSegment("/acme/member")).toBe("member");
    expect(imSurfaceSegment("/acme/knowledge")).toBe("knowledge");
    expect(imSurfaceSegment("/acme/reminder")).toBe("reminder");
    expect(imSurfaceSegment("/acme/collect")).toBe("collect");
  });

  it("rejects settings, nested paths, and the workspace home", () => {
    expect(imSurfaceSegment("/acme/settings")).toBeNull();
    expect(imSurfaceSegment("/acme/im/extra")).toBeNull();
    expect(imSurfaceSegment("/acme")).toBeNull();
  });
});

describe("isImSurfaceLocalNav", () => {
  it("stays local across the five tabs in one workspace", () => {
    expect(isImSurfaceLocalNav("/acme/im", "/acme/knowledge")).toBe(true);
    expect(isImSurfaceLocalNav("/acme/reminder", "/acme/reminder?item=r1")).toBe(true);
    expect(isImSurfaceLocalNav("/acme/collect", "/acme/member?contact=member%3Au1")).toBe(true);
    expect(isImSurfaceLocalNav("/acme/im", "/acme/im?chat=c1")).toBe(true);
  });

  it("leaves for settings, another workspace, or a dashboard page", () => {
    expect(isImSurfaceLocalNav("/acme/im", "/acme/settings")).toBe(false);
    expect(isImSurfaceLocalNav("/acme/im", "/other/im")).toBe(false);
    expect(isImSurfaceLocalNav("/acme/issues", "/acme/im")).toBe(false);
  });
});
