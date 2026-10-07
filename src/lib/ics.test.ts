import { describe, expect, it } from "vitest";
import { formatIcs, parseCalendarImport } from "./ics";
import type { CalendarEvent } from "./types";

const TZ = "Europe/London";
const BACKSLASH = String.fromCharCode(92);

describe("formatIcs", () => {
  const events: CalendarEvent[] = [
    {
      id: "e1",
      title: "Standup; with, commas",
      start: "2026-09-28T09:00:00Z",
      end: "2026-09-28T09:30:00Z",
      location: "Room 1",
      notes: "line one\nline two",
    },
    { id: "e2", title: "Holiday", start: "2026-09-15", end: "2026-09-19" },
    {
      id: "e3",
      title: "Weekly sync",
      start: "2026-10-01T14:00:00Z",
      end: "2026-10-01T15:00:00Z",
      recurrence: { frequency: "weekly", weekdays: [4], interval: 2 },
    },
  ];

  it("wraps events in a VCALENDAR with CRLF line endings", () => {
    const ics = formatIcs(events);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("escapes semicolons and commas in text values", () => {
    const ics = formatIcs(events);
    expect(ics).toContain(`SUMMARY:Standup${BACKSLASH}; with${BACKSLASH}, commas`);
  });

  it("escapes newlines in descriptions", () => {
    expect(formatIcs(events)).toContain(`DESCRIPTION:line one${BACKSLASH}nline two`);
  });

  it("writes all-day events as DATE values with an exclusive DTEND", () => {
    const ics = formatIcs(events);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260915");
    // Stored inclusive end is the 19th, so DTEND is the 20th.
    expect(ics).toContain("DTEND;VALUE=DATE:20260920");
  });

  it("emits an RRULE carrying interval and weekday", () => {
    expect(formatIcs(events)).toContain("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH");
  });

  it("folds every content line to 75 octets or fewer", () => {
    const long = formatIcs([
      { id: "l", title: "x".repeat(400), start: "2026-01-01T00:00:00Z" },
    ]);
    const encoder = new TextEncoder();
    const overlong = long.split("\r\n").filter((line) => encoder.encode(line).length > 75);
    expect(overlong).toEqual([]);
  });

  it("names the calendar", () => {
    expect(formatIcs([], "Work")).toContain("X-WR-CALNAME:Work");
  });

  it("produces a valid empty calendar", () => {
    const ics = formatIcs([]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("ics round trip", () => {
  it("reads back everything it wrote", () => {
    const events: CalendarEvent[] = [
      { id: "a", title: "Timed", start: "2026-09-28T09:00:00Z", end: "2026-09-28T09:30:00Z", location: "Room 1" },
      { id: "b", title: "Holiday", start: "2026-09-15", end: "2026-09-19" },
    ];
    const back = parseCalendarImport(formatIcs(events), TZ);
    expect(back).toHaveLength(2);
    expect(back.map((event) => event.title).sort()).toEqual(["Holiday", "Timed"]);
  });

  it("restores the inclusive all-day end date", () => {
    const back = parseCalendarImport(
      formatIcs([{ id: "b", title: "Holiday", start: "2026-09-15", end: "2026-09-19" }]),
      TZ,
    );
    const holiday = back[0];
    expect(holiday.start.slice(0, 10)).toBe("2026-09-15");
    expect((holiday.end ?? "").slice(0, 10)).toBe("2026-09-19");
  });

  it("survives folding of multi-byte characters", () => {
    const title = "日本語のとても長いタイトルです".repeat(6);
    const back = parseCalendarImport(formatIcs([{ id: "u", title, start: "2026-01-01T00:00:00Z" }]), TZ);
    expect(back[0]?.title).toBe(title);
  });

  it("preserves escaped punctuation through a round trip", () => {
    const title = "Standup; with, commas and a backslash";
    const back = parseCalendarImport(formatIcs([{ id: "p", title, start: "2026-01-01T00:00:00Z" }]), TZ);
    expect(back[0]?.title).toBe(title);
  });

  it("preserves a recurrence that ends after a number of occurrences", () => {
    const event: CalendarEvent = {
      id: "c",
      title: "Ten standups",
      start: "2026-09-07T09:00:00Z",
      recurrence: { frequency: "weekly", weekdays: [1], count: 10 },
    };
    expect(formatIcs([event])).toContain("COUNT=10");
    expect(parseCalendarImport(formatIcs([event]), TZ)[0]?.recurrence?.count).toBe(10);
  });

  it("preserves a recurrence that ends on a date", () => {
    const event: CalendarEvent = {
      id: "u",
      title: "Until October",
      start: "2026-09-07T09:00:00Z",
      recurrence: { frequency: "daily", until: "2026-10-01" },
    };
    expect(formatIcs([event])).toContain("UNTIL=20261001");
    expect(parseCalendarImport(formatIcs([event]), TZ)[0]?.recurrence?.until).toBe("2026-10-01");
  });
});

describe("parseCalendarImport", () => {
  it("returns nothing for input that is not a calendar", () => {
    expect(parseCalendarImport("not a calendar at all", TZ)).toEqual([]);
  });

  it("tolerates CRLF and bare LF line endings", () => {
    const body =
      "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:x\nSUMMARY:Lunch\nDTSTART:20260401T120000Z\nEND:VEVENT\nEND:VCALENDAR";
    expect(parseCalendarImport(body, TZ).map((e) => e.title)).toEqual(["Lunch"]);
    expect(parseCalendarImport(body.replace(/\n/g, "\r\n"), TZ).map((e) => e.title)).toEqual(["Lunch"]);
  });

  it("assigns the given calendar id to imported events", () => {
    const body =
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nSUMMARY:Lunch\nDTSTART:20260401T120000Z\nEND:VEVENT\nEND:VCALENDAR";
    expect(parseCalendarImport(body, TZ, "cal-1")[0]?.calendarId).toBe("cal-1");
  });
});
