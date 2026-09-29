import { describe, expect, it } from "vitest";
import { expandCalendarEvents } from "./recurrence";
import type { CalendarEvent } from "./types";

const TZ = "Europe/London";
const at = (year: number, month: number, day: number) => new Date(year, month - 1, day);
/** Local date key, because toISOString() would shift across the UTC boundary. */
const dayOf = (value: string) =>
  value.includes("T") ? new Date(value).toISOString().slice(0, 10) : value.slice(0, 10);

describe("expandCalendarEvents", () => {
  it("returns a non-recurring event inside the window", () => {
    const event: CalendarEvent = { id: "a", title: "One off", start: "2026-09-15" };
    const out = expandCalendarEvents([event], at(2026, 9, 1), at(2026, 9, 30), TZ);
    expect(out.map((e) => e.id)).toEqual(["a"]);
  });

  it("omits an event that starts after the window", () => {
    const event: CalendarEvent = { id: "a", title: "Later", start: "2026-11-02" };
    expect(expandCalendarEvents([event], at(2026, 9, 1), at(2026, 9, 30), TZ)).toEqual([]);
  });

  it("only yields occurrences that START inside the window", () => {
    // Documents a real limitation rather than asserting desirable behaviour:
    // a multi-day event already under way when the window opens is NOT
    // returned. CalendarView compensates by padding the query window by the
    // longest event and filtering by overlap afterwards; if this expectation
    // ever flips, that padding can be removed.
    const trip: CalendarEvent = { id: "trip", title: "Trip", start: "2026-09-21", end: "2026-09-25" };
    const midTrip = at(2026, 9, 23);
    expect(expandCalendarEvents([trip], midTrip, midTrip, TZ)).toEqual([]);
    // Padding the window back past the start does find it.
    expect(
      expandCalendarEvents([trip], at(2026, 9, 17), midTrip, TZ).map((e) => e.id),
    ).toEqual(["trip"]);
  });

  it("expands a daily rule across the window", () => {
    const event: CalendarEvent = {
      id: "d",
      title: "Daily",
      start: "2026-09-01T09:00:00Z",
      recurrence: { frequency: "daily" },
    };
    const out = expandCalendarEvents([event], at(2026, 9, 1), at(2026, 9, 7), TZ);
    expect(out).toHaveLength(7);
    expect(dayOf(out[0].start)).toBe("2026-09-01");
    expect(dayOf(out[6].start)).toBe("2026-09-07");
  });

  it("honours an interval so every other day is skipped", () => {
    const event: CalendarEvent = {
      id: "d",
      title: "Alternate",
      start: "2026-09-01T09:00:00Z",
      recurrence: { frequency: "daily", interval: 2 },
    };
    const out = expandCalendarEvents([event], at(2026, 9, 1), at(2026, 9, 7), TZ);
    expect(out.map((e) => dayOf(e.start))).toEqual([
      "2026-09-01",
      "2026-09-03",
      "2026-09-05",
      "2026-09-07",
    ]);
  });

  it("expands weekly rules on the named weekdays only", () => {
    // 2026-09-01 is a Tuesday; ask for Monday (1) and Friday (5).
    const event: CalendarEvent = {
      id: "w",
      title: "Weekly",
      start: "2026-09-01T09:00:00Z",
      recurrence: { frequency: "weekly", weekdays: [1, 5] },
    };
    const out = expandCalendarEvents([event], at(2026, 9, 1), at(2026, 9, 14), TZ);
    const weekdays = new Set(out.map((e) => new Date(e.start).getDay()));
    expect([...weekdays].sort()).toEqual([1, 5]);
  });

  it("stops after `count` occurrences", () => {
    const event: CalendarEvent = {
      id: "c",
      title: "Three times",
      start: "2026-09-01T09:00:00Z",
      recurrence: { frequency: "daily", count: 3 },
    };
    const out = expandCalendarEvents([event], at(2026, 9, 1), at(2026, 9, 30), TZ);
    expect(out).toHaveLength(3);
  });

  it("stops at `until`", () => {
    const event: CalendarEvent = {
      id: "u",
      title: "Until",
      start: "2026-09-01T09:00:00Z",
      recurrence: { frequency: "daily", until: "2026-09-04" },
    };
    const out = expandCalendarEvents([event], at(2026, 9, 1), at(2026, 9, 30), TZ);
    expect(out.map((e) => dayOf(e.start)).every((day) => day <= "2026-09-04")).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it("never yields occurrences before the rule's anchor", () => {
    const event: CalendarEvent = {
      id: "anchor",
      title: "Anchored",
      start: "2026-09-20T09:00:00Z",
      recurrence: { frequency: "daily" },
    };
    const out = expandCalendarEvents([event], at(2026, 9, 1), at(2026, 9, 30), TZ);
    expect(out.every((e) => dayOf(e.start) >= "2026-09-20")).toBe(true);
  });

  it("expands monthly rules on the anchor's day of month", () => {
    const event: CalendarEvent = {
      id: "m",
      title: "Monthly",
      start: "2026-01-15T09:00:00Z",
      recurrence: { frequency: "monthly" },
    };
    const out = expandCalendarEvents([event], at(2026, 1, 1), at(2026, 4, 30), TZ);
    expect(out.map((e) => dayOf(e.start))).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
    ]);
  });

  it("expands yearly rules on the same month and day", () => {
    const event: CalendarEvent = {
      id: "y",
      title: "Yearly",
      start: "2024-03-04T09:00:00Z",
      recurrence: { frequency: "yearly" },
    };
    const out = expandCalendarEvents([event], at(2026, 1, 1), at(2027, 12, 31), TZ);
    expect(out.map((e) => dayOf(e.start))).toEqual(["2026-03-04", "2027-03-04"]);
  });

  it("keeps each occurrence's own identity so they can be keyed apart", () => {
    const event: CalendarEvent = {
      id: "base",
      title: "Daily",
      start: "2026-09-01T09:00:00Z",
      recurrence: { frequency: "daily" },
    };
    const out = expandCalendarEvents([event], at(2026, 9, 1), at(2026, 9, 3), TZ);
    expect(new Set(out.map((e) => e.id)).size).toBe(out.length);
  });

  it("returns nothing for an empty input", () => {
    expect(expandCalendarEvents([], at(2026, 9, 1), at(2026, 9, 30), TZ)).toEqual([]);
  });
});
