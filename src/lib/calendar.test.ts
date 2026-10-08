import { describe, expect, it } from "vitest";

import { DEFAULT_CALENDAR_ID, DEFAULT_CALENDAR_NAME, sortCalendars } from "./calendar";
import { DEFAULT_CALENDAR_COLOR } from "./types";
import type { Calendar } from "./types";

function calendar(id: string, name: string): Calendar {
  return { id, name, color: DEFAULT_CALENDAR_COLOR };
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
