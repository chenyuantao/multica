// @vitest-environment node

import { describe, expect, it } from "vitest";
import { clampSidebarWidth, sidebarWidthBounds } from "@multica/ui/hooks/use-sidebar-width";

describe("sidebar width ratio", () => {
  it("limits a column to 3:7 through 7:3 of the row it shares", () => {
    expect(sidebarWidthBounds(1000)).toEqual({ min: 300, max: 700 });
    expect(clampSidebarWidth(100, 1000)).toBe(300);
    expect(clampSidebarWidth(900, 1000)).toBe(700);
    expect(clampSidebarWidth(400, 1000)).toBe(400);
  });

  it("keeps a stored width when the row has not been measured", () => {
    expect(sidebarWidthBounds(0)).toBeNull();
    expect(clampSidebarWidth(256, 0)).toBe(256);
  });
});
