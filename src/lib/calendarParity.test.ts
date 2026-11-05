import { describe, expect, it } from "vitest";

import {
  DEFAULT_CALENDAR_ID,
  DEFAULT_CALENDAR_NAME,
  MAX_EVENT_ALERTS,
  UNTITLED_CALENDAR_NAME,
  UNTITLED_EVENT_TITLE,
  alertLabel,
  alertPresets,
  calendarNameById,
  parseCalendar,
  parseEvent,
  serializeCalendar,
  retimeAlerts,
  serializeEvent,
} from "./calendar";
import { CALENDAR_CONTENT_TYPE, CALENDAR_EVENT_CONTENT_TYPE } from "./calendarApi";
import {
  coreCalendarEventKeys,
  coreCalendarKeys,
  coreDefaultCalendarId,
  coreErrorOf,
} from "./wasm";
import type { CoreCalendar, CoreCalendarDraft, CoreCalendarEvent, CoreCalendarEventDraft } from "./wasm";
import { DEFAULT_CALENDAR_COLOR } from "./types";
import { readFixture } from "../test/fixtures";

/**
 * The shared calendar fixture, through the same core the CLI and Android run.
 *
 * Held to the same document as `sealbook-core/tests/calendars.rs` and Android's
 * `CalendarPayloadTest`. The payloads are pinned byte for byte, which they can
 * be because core writes them for all three hosts: this is the only layer with
 * no server check behind it, so a key or a value that differs here differs in
 * the plaintext and nothing but this test would say so.
 */
type Fixture = {
  constants: {
    calendar_content_type: string;
    calendar_event_content_type: string;
    calendar_keys: string[];
    calendar_event_keys: string[];
    default_calendar_id: string;
    default_calendar_name: string;
    default_calendar_color: string;
    untitled_calendar_name: string;
    untitled_event_title: string;
    max_event_alerts: number;
    timed_alert_presets: { minutes_before: number; label: string }[];
    all_day_alert_presets: { minutes_before: number; label: string }[];
  };
  calendar_writes: { case: string; draft: CoreCalendarDraft; payload: string }[];
  calendar_parses: { case: string; id: string; raw: string; calendar: CoreCalendar }[];
  event_writes: { case: string; draft: CoreCalendarEventDraft; payload: string }[];
  event_parses: { case: string; id: string; raw: string; event: CoreCalendarEvent }[];
  refusals: { case: string; error: string }[];
};

const fixture = JSON.parse(readFixture("payloads/calendars.json")) as Fixture;

describe("the constants this client mirrors", () => {
  /**
   * `calendar.ts` keeps these as literals because module scope runs before the
   * wasm module is instantiated. That is what makes drift possible, and this is
   * what catches it.
   */
  it("are core's", () => {
    expect(CALENDAR_CONTENT_TYPE).toBe(fixture.constants.calendar_content_type);
    expect(CALENDAR_EVENT_CONTENT_TYPE).toBe(fixture.constants.calendar_event_content_type);
    expect(DEFAULT_CALENDAR_ID).toBe(fixture.constants.default_calendar_id);
    expect(DEFAULT_CALENDAR_ID).toBe(coreDefaultCalendarId());
    expect(DEFAULT_CALENDAR_NAME).toBe(fixture.constants.default_calendar_name);
    expect(DEFAULT_CALENDAR_COLOR).toBe(fixture.constants.default_calendar_color);
    expect(UNTITLED_CALENDAR_NAME).toBe(fixture.constants.untitled_calendar_name);
    expect(UNTITLED_EVENT_TITLE).toBe(fixture.constants.untitled_event_title);
    expect(MAX_EVENT_ALERTS).toBe(fixture.constants.max_event_alerts);
  });

  it("include the owned key sets, which are the union across every client", () => {
    expect(coreCalendarKeys()).toEqual(fixture.constants.calendar_keys);
    expect(coreCalendarEventKeys()).toEqual(fixture.constants.calendar_event_keys);
  });
});

describe("event reminders", () => {
  it("offer the presets and labels every client shows", () => {
    for (const [allDay, expected] of [
      [false, fixture.constants.timed_alert_presets],
      [true, fixture.constants.all_day_alert_presets],
    ] as const) {
      expect(
        alertPresets(allDay).map((minutes) => ({
          minutes_before: minutes,
          label: alertLabel({ minutesBefore: minutes }, allDay),
        })),
      ).toEqual(expected);
    }
  });

  it("survive a save through this client's view model, unreadable entries included", () => {
    const stored =
      '{"@type":"CalendarEvent","version":"1.0","title":"t","start":"2026-10-01T09:00:00Z","alerts":[{"minutesBefore":15},{"at":"later"},{"minutesBefore":60,"sound":"chime"}]}';
    const event = parseEvent("e1", stored);
    expect(event.alerts).toEqual([{ minutesBefore: 60, extra: '{"sound":"chime"}' }, { minutesBefore: 15 }]);
    const written = JSON.parse(serializeEvent(event)) as Record<string, unknown>;
    expect(written.alerts).toEqual([{ minutesBefore: 60, sound: "chime" }, { minutesBefore: 15 }, { at: "later" }]);
  });

  it("keep their days before when an event switches to all-day and back", () => {
    const allDay = retimeAlerts([{ minutesBefore: 1440 }, { minutesBefore: 15 }, { minutesBefore: 30 }], true);
    expect(allDay.map((alert) => alert.minutesBefore)).toEqual([900, -540]);
    expect(retimeAlerts(allDay, false).map((alert) => alert.minutesBefore)).toEqual([1440, 0]);
  });
});

describe("a payload from a newer schema major", () => {
  it("is read, because a lenient read beats a blank row", () => {
    const calendar = parseCalendar("c1", '{"@type":"Calendar","version":"2.0","name":"future"}');
    expect(calendar.name).toBe("future");
    expect(calendar.readable).toBe(false);

    const event = parseEvent("e1", '{"@type":"CalendarEvent","version":"2.0","title":"future"}');
    expect(event.title).toBe("future");
    expect(event.readable).toBe(false);
  });

  it("is never written over", () => {
    const future = parseCalendar("c1", '{"@type":"Calendar","version":"2.0","name":"future"}');
    let caught: unknown;
    try {
      serializeCalendar({ ...future, name: "edited" });
    } catch (err) {
      caught = err;
    }
    expect(coreErrorOf(caught)?.kind).toBe(fixture.refusals[0].error);

    caught = undefined;
    const event = parseEvent("e1", '{"@type":"CalendarEvent","version":"2.0","title":"future"}');
    try {
      serializeEvent({ ...event, title: "edited" });
    } catch (err) {
      caught = err;
    }
    expect(coreErrorOf(caught)?.kind).toBe(fixture.refusals[1].error);
  });
});

describe("this client's own calendar helpers", () => {
  /**
   * The gotcha the old writer had: it took `Omit<Calendar, "id">` and spread
   * whatever it was given, so a caller handing it a whole calendar wrote the
   * object id into the plaintext. Core filters the fields down to the owned
   * keys, so the id cannot reach the payload however the caller spells the call.
   */
  it("never write the object id into the plaintext", () => {
    const calendar = parseCalendar("c1", '{"@type":"Calendar","version":"1.0","name":"Work"}');
    const written = JSON.parse(serializeCalendar(calendar)) as Record<string, unknown>;
    expect(written.id).toBeUndefined();
    expect(Object.keys(written).sort()).toEqual(["@type", "color", "favorite", "name", "version"]);
  });

  it("keep the flags and an unknown key through a rename", () => {
    const stored =
      '{"@type":"Calendar","version":"1.0","name":"Old Team","color":"#9ece6a","favorite":true,"archived":true,"sharedWith":["someone@example.com"]}';
    const calendar = parseCalendar("c1", stored);
    expect(calendar.archived).toBe(true);

    const written = JSON.parse(serializeCalendar({ ...calendar, name: "Renamed" })) as Record<string, unknown>;
    expect(written.name).toBe("Renamed");
    expect(written.color).toBe("#9ece6a");
    expect(written.favorite).toBe(true);
    expect(written.archived).toBe(true);
    expect(written.sharedWith).toEqual(["someone@example.com"]);
  });

  /**
   * A rule naming a frequency this build cannot expand is dropped on read, so
   * the event draws as a single occurrence rather than on dates nobody meant.
   * It still has to come back on the next save, which is what the carry is for.
   */
  it("carry a repeat rule core cannot name through a save", () => {
    const stored =
      '{"@type":"CalendarEvent","version":"1.0","title":"Pay day","start":"2026-10-01","recurrence":{"frequency":"hourly","interval":3}}';
    const event = parseEvent("e1", stored);
    expect(event.recurrence).toBeUndefined();

    const written = JSON.parse(serializeEvent({ ...event, title: "Pay day, moved" })) as Record<string, unknown>;
    expect(written.recurrence).toEqual({ frequency: "hourly", interval: 3 });
  });

  it("read and write the rule shapes the composer offers", () => {
    const stored =
      '{"@type":"CalendarEvent","version":"1.0","title":"Board","start":"2026-10-20T16:00:00.000Z","recurrence":{"frequency":"monthly","count":12,"nthWeekday":{"ordinal":3,"weekday":2}}}';
    const event = parseEvent("e1", stored);
    expect(event.recurrence).toEqual({
      frequency: "monthly",
      interval: undefined,
      until: undefined,
      count: 12,
      weekdays: undefined,
      dayOfMonth: undefined,
      nthWeekday: { ordinal: 3, weekday: 2 },
    });
    expect(JSON.parse(serializeEvent(event)).recurrence).toEqual({
      frequency: "monthly",
      count: 12,
      nthWeekday: { ordinal: 3, weekday: 2 },
    });
  });

  it("name a calendar that is gone after the default one, and an event in none at all not at all", () => {
    const calendars = [parseCalendar(DEFAULT_CALENDAR_ID, '{"name":"Mine"}')];
    expect(calendarNameById(calendars, DEFAULT_CALENDAR_ID)).toBe("Mine");
    expect(calendarNameById(calendars, "gone")).toBe(DEFAULT_CALENDAR_NAME);
    expect(calendarNameById(calendars, undefined)).toBeUndefined();
  });
});

/**
 * The three single-payload fixtures this suite was built on, which are the
 * literal output of the writers that predate core. They stay because they are
 * the one record of what a released client wrote, and they must still read and
 * write back byte for byte.
 */
describe("the payloads the writers before core produced", () => {
  it("an event round-trips through core's writer", () => {
    const stored = readFixture("payloads/calendar-event.json");
    const event = parseEvent("e1", stored);
    expect(JSON.parse(serializeEvent(event))).toEqual(JSON.parse(stored));
  });

  it.each(["payloads/calendar.json", "payloads/calendar-archived.json"])(
    "%s round-trips through core's writer",
    (name) => {
      const stored = readFixture(name);
      expect(JSON.parse(serializeCalendar(parseCalendar("c1", stored)))).toEqual(JSON.parse(stored));
    },
  );
});
