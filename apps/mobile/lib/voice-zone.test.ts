// @vitest-environment node

import { describe, expect, it } from "vitest";
import { voiceZone } from "./voice-zone";

const width = 390;
const height = 844;

describe("voiceZone", () => {
  it("sends from the bottom-center hold point", () => {
    expect(voiceZone(width / 2, height * 0.92, width, height)).toBe("send");
  });

  it("cancels in the lower-left arc and edits in the lower-right arc", () => {
    expect(voiceZone(40, height * 0.86, width, height)).toBe("cancel");
    expect(voiceZone(width - 40, height * 0.86, width, height)).toBe("edit");
  });

  it("sends again once the finger leaves the bottom arcs", () => {
    expect(voiceZone(40, height * 0.4, width, height)).toBe("send");
    expect(voiceZone(width - 20, height * 0.5, width, height)).toBe("send");
  });
});
