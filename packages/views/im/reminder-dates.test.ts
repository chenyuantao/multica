// @vitest-environment node
import { describe, expect, it } from "vitest";
import { addDays, fromDateKey, shortDate, startOfWeek, toDateKey, weekCode, weekdayIndex } from "./reminder-dates";

describe("reminder dates", () => {
  it("starts the week on Monday", () => {
    expect(toDateKey(startOfWeek(new Date(2026, 9, 8)))).toBe("2026-10-05");
    expect(toDateKey(startOfWeek(new Date(2026, 9, 11)))).toBe("2026-10-05");
    expect(toDateKey(startOfWeek(new Date(2026, 9, 5)))).toBe("2026-10-05");
  });

  it("names the week after the shown day", () => {
    expect(weekCode(new Date(2026, 9, 8))).toBe("Y2026M10W2");
    expect(weekCode(new Date(2026, 9, 1))).toBe("Y2026M10W1");
    expect(weekCode(new Date(2026, 9, 29))).toBe("Y2026M10W5");
  });

  it("round-trips day keys and crosses month ends", () => {
    expect(toDateKey(fromDateKey("2026-10-31"))).toBe("2026-10-31");
    expect(toDateKey(addDays(new Date(2026, 9, 31), 1))).toBe("2026-11-01");
    expect(shortDate("2026-10-05")).toBe("10/05");
    expect(weekdayIndex("2026-10-05")).toBe(0);
    expect(weekdayIndex("2026-10-11")).toBe(6);
  });
});
