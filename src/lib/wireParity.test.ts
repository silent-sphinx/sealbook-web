import { describe, expect, it } from "vitest";

import { CALENDAR_EVENT_KEYS } from "./calendarApi";
import { parseCalendar, serializeCalendar } from "./calendar";
import { mergePayload, PAYLOAD_SCHEMA_VERSION } from "./payload";
import { readFixture } from "../test/fixtures";

/**
 * The shared payload fixtures, which Android's parity tests read as the same
 * bytes. A key this build stops writing, or starts writing under another name,
 * shows up here as a payload that no longer reproduces the fixture.
 */
describe("the shared calendar payload fixtures", () => {
  it("an event round-trips through the writer that produced it", () => {
    const fixture = readFixture("payloads/calendar-event.json");
    const { "@type": type, version, ...fields } = JSON.parse(fixture);

    expect(type).toBe("CalendarEvent");
    expect(version).toBe(PAYLOAD_SCHEMA_VERSION);

    const written = mergePayload(
      undefined,
      { "@type": "CalendarEvent", version: PAYLOAD_SCHEMA_VERSION, ...fields },
      CALENDAR_EVENT_KEYS,
    );
    expect(JSON.parse(written)).toEqual(JSON.parse(fixture));
  });

  it("every key in the event fixture is one this build owns", () => {
    const keys = Object.keys(JSON.parse(readFixture("payloads/calendar-event.json")));
    expect(keys.filter((key) => !CALENDAR_EVENT_KEYS.includes(key as never))).toEqual([]);
  });

  it.each(["payloads/calendar.json", "payloads/calendar-archived.json"])(
    "%s round-trips through parseCalendar and serializeCalendar",
    (name) => {
      const fixture = readFixture(name);
      // `id` is the object id, not a payload field: `serializeCalendar` takes
      // `Omit<Calendar, "id">` and spreads whatever else it is given.
      const { id: _id, ...calendar } = parseCalendar("cal-1", fixture);
      expect(JSON.parse(serializeCalendar(calendar))).toEqual(JSON.parse(fixture));
    },
  );
});
