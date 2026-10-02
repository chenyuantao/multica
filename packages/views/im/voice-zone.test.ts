// @vitest-environment node

import { describe, expect, it } from "vitest";
import { voiceZone } from "./voice-zone";

describe("voiceZone", () => {
  it("sends above the arc band and between the two corners", () => {
    expect(voiceZone(50, 10, 100, 100)).toBe("send");
    expect(voiceZone(50, 80, 100, 100)).toBe("send");
  });

  it("cancels in the lower left and edits in the lower right", () => {
    expect(voiceZone(10, 80, 100, 100)).toBe("cancel");
    expect(voiceZone(90, 80, 100, 100)).toBe("edit");
  });

  it("sends when the window size is unknown", () => {
    expect(voiceZone(0, 0, 0, 0)).toBe("send");
  });
});
