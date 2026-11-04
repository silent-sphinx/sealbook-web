import { describe, expect, it } from "vitest";
import { keyFor, monthDays, weekDays, weekdayLabels } from "./calendarModel";

describe("week start", () => {
  // 1 November 2026 is a Sunday.
  const november = new Date(2026, 10, 1);

  it("opens the month grid on Sunday by default", () => {
    expect(keyFor(monthDays(november)[0])).toBe("2026-11-01");
  });

  it("opens the month grid on the Monday before the first", () => {
    const days = monthDays(november, 1);
    expect(keyFor(days[0])).toBe("2026-10-26");
    expect(days[0].getDay()).toBe(1);
    expect(days).toHaveLength(42);
  });

  it("runs a week Monday to Sunday", () => {
    const week = weekDays(new Date(2026, 10, 8), 1);
    expect(keyFor(week[0])).toBe("2026-11-02");
    expect(keyFor(week[6])).toBe("2026-11-08");
  });

  it("rotates the headings to match", () => {
    expect(weekdayLabels(1)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(weekdayLabels(0, "narrow")).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
  });
});
