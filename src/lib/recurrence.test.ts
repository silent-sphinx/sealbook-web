import { describe, expect, it } from "vitest";
import { expandCalendarEvents, nextOccurrence } from "./recurrence";
import type { CalendarEvent, RecurrenceRule } from "./types";

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

  it("expands a rule anchored decades before the window", () => {
    // A birthday carries its real year, so the anchor is as far back as the
    // person's birth: walking there a day at a time ran out of budget and
    // returned nothing.
    const birthday: CalendarEvent = {
      id: "b",
      title: "Birthday",
      start: "1960-10-15",
      recurrence: { frequency: "yearly" },
    };
    const out = expandCalendarEvents([birthday], at(2026, 10, 1), at(2026, 10, 31), TZ);
    expect(out.map((e) => dayOf(e.start))).toEqual(["2026-10-15"]);

    const monthly: CalendarEvent = {
      id: "m",
      title: "Rent",
      start: "1990-01-15",
      recurrence: { frequency: "monthly" },
    };
    expect(
      expandCalendarEvents([monthly], at(2026, 10, 1), at(2026, 10, 31), TZ).map((e) => dayOf(e.start)),
    ).toEqual(["2026-10-15"]);

    const daily: CalendarEvent = {
      id: "d",
      title: "Daily",
      start: "1985-01-01T09:00:00Z",
      recurrence: { frequency: "daily" },
    };
    expect(expandCalendarEvents([daily], at(2026, 9, 1), at(2026, 9, 7), TZ)).toHaveLength(7);
  });

  it("applies `until` to a rule anchored decades before the window", () => {
    const event: CalendarEvent = {
      id: "u",
      title: "Lapsed",
      start: "1960-10-15",
      recurrence: { frequency: "yearly", until: "2000-10-15" },
    };
    expect(expandCalendarEvents([event], at(2026, 10, 1), at(2026, 10, 31), TZ)).toEqual([]);
  });

  it("counts `count` across the periods it skips to reach the window", () => {
    const weekly: CalendarEvent = {
      id: "w",
      title: "Twice a week, five times",
      start: "2026-09-07T09:00:00Z",
      recurrence: { frequency: "weekly", weekdays: [1, 3], count: 5 },
    };
    expect(
      expandCalendarEvents([weekly], at(2026, 9, 14), at(2026, 12, 31), TZ).map((e) => dayOf(e.start)),
    ).toEqual(["2026-09-14", "2026-09-16", "2026-09-21"]);

    // The 31st has no occurrence in a short month, so the skipped span holds
    // fewer occurrences than it holds periods.
    const monthly: CalendarEvent = {
      id: "m",
      title: "Four times",
      start: "2026-01-31T09:00:00Z",
      recurrence: { frequency: "monthly", count: 4 },
    };
    expect(
      expandCalendarEvents([monthly], at(2026, 4, 1), at(2026, 12, 31), TZ).map((e) => dayOf(e.start)),
    ).toEqual(["2026-05-31", "2026-07-31"]);
  });

  it("yields a leap-day anchor only in leap years", () => {
    const event: CalendarEvent = {
      id: "l",
      title: "Leap",
      start: "2024-02-29",
      recurrence: { frequency: "yearly" },
    };
    const out = expandCalendarEvents([event], at(2026, 1, 1), at(2032, 12, 31), TZ);
    expect(out.map((e) => dayOf(e.start))).toEqual(["2028-02-29", "2032-02-29"]);
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

  it("counts `count` from the anchor, not from the start of the window", () => {
    // Each view expands over just the window it draws, so a window opening
    // after the anchor must not restart the tally and hand back occurrences
    // past the limit the user set.
    const event: CalendarEvent = {
      id: "c",
      title: "Three times",
      start: "2026-09-01T09:00:00Z",
      recurrence: { frequency: "daily", count: 3 },
    };
    const later = expandCalendarEvents([event], at(2026, 9, 10), at(2026, 10, 31), TZ);
    expect(later).toEqual([]);
    const straddling = expandCalendarEvents([event], at(2026, 9, 2), at(2026, 10, 31), TZ);
    expect(straddling.map((e) => dayOf(e.start))).toEqual(["2026-09-02", "2026-09-03"]);
  });

  it("counts `count` in occurrences, not in intervals", () => {
    const event: CalendarEvent = {
      id: "c",
      title: "Twice a week, five times",
      start: "2026-09-07T09:00:00Z",
      recurrence: { frequency: "weekly", weekdays: [1, 3], count: 5 },
    };
    const out = expandCalendarEvents([event], at(2026, 9, 1), at(2026, 12, 31), TZ);
    expect(out.map((e) => dayOf(e.start))).toEqual([
      "2026-09-07", "2026-09-09", "2026-09-14", "2026-09-16", "2026-09-21",
    ]);
  });

  it("includes an occurrence falling on the `until` date itself", () => {
    const event: CalendarEvent = {
      id: "u",
      title: "Until",
      start: "2026-09-01T09:00:00Z",
      recurrence: { frequency: "weekly", weekdays: [2], until: "2026-09-15" },
    };
    const out = expandCalendarEvents([event], at(2026, 9, 1), at(2026, 10, 31), TZ);
    expect(out.map((e) => dayOf(e.start))).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
  });

  it("applies `until` when the window opens after the anchor", () => {
    const event: CalendarEvent = {
      id: "u",
      title: "Until",
      start: "2026-09-01T09:00:00Z",
      recurrence: { frequency: "daily", until: "2026-09-04" },
    };
    expect(expandCalendarEvents([event], at(2026, 9, 10), at(2026, 10, 31), TZ)).toEqual([]);
  });

  it("returns nothing for an empty input", () => {
    expect(expandCalendarEvents([], at(2026, 9, 1), at(2026, 9, 30), TZ)).toEqual([]);
  });
});

describe("nextOccurrence", () => {
  const key = (date: Date | null) =>
    date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
      : null;
  const next = (anchor: string, rule: RecurrenceRule, after = anchor) =>
    key(nextOccurrence(new Date(`${anchor}T00:00`), rule, new Date(`${after}T00:00`)));

  it("steps a daily rule by its interval", () => {
    expect(next("2026-10-22", { frequency: "daily" })).toBe("2026-10-23");
    expect(next("2026-10-22", { frequency: "daily", interval: 3 })).toBe("2026-10-25");
  });

  it("picks the next listed weekday, then wraps to the following week", () => {
    const rule: RecurrenceRule = { frequency: "weekly", weekdays: [1, 4] };
    expect(next("2026-10-22", rule)).toBe("2026-10-26");
    expect(next("2026-10-26", rule)).toBe("2026-10-29");
  });

  it("walks past a month with no 31st", () => {
    expect(next("2026-10-31", { frequency: "monthly" })).toBe("2026-12-31");
  });

  it("walks past a month with no fifth weekday", () => {
    const rule: RecurrenceRule = { frequency: "monthly", nthWeekday: { ordinal: 5, weekday: 5 } };
    expect(next("2026-10-30", rule)).toBe("2027-01-29");
  });

  it("is null once until has passed", () => {
    expect(next("2026-10-22", { frequency: "daily", until: "2026-10-22" })).toBeNull();
    expect(next("2026-10-22", { frequency: "daily", until: "2026-10-23" })).toBe("2026-10-23");
  });

  it("counts occurrences from the anchor inclusive", () => {
    expect(next("2026-10-22", { frequency: "daily", count: 1 })).toBeNull();
    expect(next("2026-10-22", { frequency: "daily", count: 2 })).toBe("2026-10-23");
  });

  it("is null for an unreadable date", () => {
    expect(nextOccurrence(new Date("nope"), { frequency: "daily" }, new Date())).toBeNull();
  });
});
