import { describe, expect, it } from "vitest";

import {
  DEFAULT_CALENDAR_ID,
  DEFAULT_CALENDAR_NAME,
  activeCalendars,
  archivedCalendars,
  isCalendarVisible,
  parseCalendar,
  serializeCalendar,
  sortCalendars,
  visibleCalendarIds,
} from "./calendar";
import { DEFAULT_CALENDAR_COLOR } from "./types";
import type { Calendar } from "./types";

function calendar(id: string, name: string): Calendar {
  return { id, name, color: DEFAULT_CALENDAR_COLOR };
}

function parsed(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("calendars", () => {
  it("matches the values reserved in the Rust protocol crate", () => {
    expect(DEFAULT_CALENDAR_ID).toBe("00000000-0000-0000-0000-000000000003");
    expect(DEFAULT_CALENDAR_NAME).toBe("Default Calendar");
    expect(DEFAULT_CALENDAR_COLOR).toBe("#7aa2f7");
  });

  it("keeps the default first and sorts the rest by name", () => {
    const sorted = sortCalendars([
      calendar("b", "Work"),
      calendar("a", "admin"),
      calendar(DEFAULT_CALENDAR_ID, "Default Calendar"),
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual(["Default Calendar", "admin", "Work"]);
  });

  it("keeps the default first even once it has been renamed", () => {
    const sorted = sortCalendars([
      calendar("a", "Admin"),
      calendar(DEFAULT_CALENDAR_ID, "Zebra"),
    ]);
    expect(sorted[0]!.id).toBe(DEFAULT_CALENDAR_ID);
  });
});

describe("archived calendars", () => {
  it("round trips the flag", () => {
    const raw = serializeCalendar({ name: "Old Team", color: "#9ece6a", archived: true });

    expect(parsed(raw).archived).toBe(true);
    expect(parseCalendar("cal-1", raw).archived).toBe(true);
  });

  it("says nothing about a calendar that is not archived", () => {
    const raw = serializeCalendar({ name: "Work", color: "#f7768e", favorite: true, archived: false });

    expect("archived" in parsed(raw)).toBe(false);
    expect(parseCalendar("cal-1", raw).archived).toBe(false);
  });

  it("clears the stored flag on a restore rather than carrying it", () => {
    const archived = serializeCalendar({ name: "Old Team", color: "#9ece6a", archived: true });
    const restored = serializeCalendar({ name: "Old Team", color: "#9ece6a", archived: false, raw: archived });

    expect("archived" in parsed(restored)).toBe(false);
  });

  it("carries a field this build does not own through an archive", () => {
    const previous = JSON.stringify({ "@type": "Calendar", version: "1.0", name: "Work", color: "#f7768e", futureField: 7 });
    const raw = serializeCalendar({ name: "Work", color: "#f7768e", archived: true, raw: previous });

    expect(parsed(raw).futureField).toBe(7);
    expect(parsed(raw).archived).toBe(true);
  });

  it("splits the calendars in play from the ones put away", () => {
    const list: Calendar[] = [
      calendar("a", "Work"),
      { ...calendar("b", "Old Team"), archived: true },
    ];

    expect(activeCalendars(list).map((entry) => entry.id)).toEqual(["a"]);
    expect(archivedCalendars(list).map((entry) => entry.id)).toEqual(["b"]);
  });

  /**
   * The literal output of the Android client's `serializeCalendar`. The payload
   * is shared, so a key one client writes and the other does not read shows up
   * as a calendar that loses its state when it crosses between them.
   */
  it("matches the Android client's payload for an archived calendar", () => {
    const android = '{"@type":"Calendar","version":"1.0","name":"Old Team","color":"#9ece6a","favorite":false,"archived":true}';
    const ours = serializeCalendar({ name: "Old Team", color: "#9ece6a", favorite: false, archived: true });

    expect(parsed(ours)).toEqual(parsed(android));
    expect(parseCalendar("cal-1", android)).toEqual({
      id: "cal-1",
      name: "Old Team",
      color: "#9ece6a",
      favorite: false,
      archived: true,
      readable: true,
      raw: android,
    });
  });
});

describe("calendar visibility", () => {
  const work = calendar("work", "Work");
  const old: Calendar = { ...calendar("old", "Old Team"), archived: true };
  const none = new Set<string>();

  it("shows a calendar in play and hides an archived one by default", () => {
    expect(isCalendarVisible(work, none, none)).toBe(true);
    expect(isCalendarVisible(old, none, none)).toBe(false);
    expect([...visibleCalendarIds([work, old], none, none)]).toEqual(["work"]);
  });

  it("hides a calendar in play that has been switched off", () => {
    expect(isCalendarVisible(work, new Set(["work"]), none)).toBe(false);
  });

  it("shows an archived calendar that has been switched on", () => {
    expect(isCalendarVisible(old, none, new Set(["old"]))).toBe(true);
    expect([...visibleCalendarIds([work, old], none, new Set(["old"]))]).toEqual(["work", "old"]);
  });

  it("reads each set only for the group it is the exception for", () => {
    // A stale id from before the calendar crossed between the groups must not
    // decide anything: the calendar starts at its new group's default.
    expect(isCalendarVisible(old, new Set(["old"]), none)).toBe(false);
    expect(isCalendarVisible(work, none, new Set(["work"]))).toBe(true);
  });
});
