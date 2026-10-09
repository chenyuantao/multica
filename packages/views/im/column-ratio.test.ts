// @vitest-environment node

import { describe, expect, it } from "vitest";
import { clampColumnRatio, columnRatioBounds } from "./column-ratio";

describe("right sidebar ratio", () => {
  it("limits the sidebar and the middle content to 3:7 through 7:3", () => {
    expect(columnRatioBounds(1000)).toEqual({ min: 300, max: 700 });
    expect(clampColumnRatio(100, 1000)).toBe(300);
    expect(clampColumnRatio(900, 1000)).toBe(700);
    expect(clampColumnRatio(400, 1000)).toBe(400);
  });

  it("keeps a stored width when the pair has not been measured", () => {
    expect(columnRatioBounds(0)).toBeNull();
    expect(clampColumnRatio(320, 0)).toBe(320);
  });
});
