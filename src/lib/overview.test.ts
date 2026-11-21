import { describe, expect, it } from "vitest";
import { agendaDays, greeting, recentBookmarks, recentNotes, upcomingDates } from "./overview";
import type { Bookmark, Calendar, CalendarEvent, Contact, ContactDate, Note } from "./types";

const TZ = "Europe/London";
const today = new Date(2026, 10, 21, 9, 30);

function calendar(id: string, overrides: Partial<Calendar> = {}): Calendar {
  return { id, name: id, color: "#123456", ...overrides };
}

function contact(id: string, dates: Omit<ContactDate, "id">[], overrides: Partial<Contact> = {}): Contact {
  return {
    id,
    name: id,
    emails: [],
    phones: [],
    addresses: [],
    work: [],
    dates: dates.map((date, index) => ({ id: `d${index}`, ...date })),
    socials: [],
    addressBookId: "book",
    raw: "",
    ciphertext: "",
    paddedSize: 0,
    ...overrides,
  };
}

describe("agendaDays", () => {
  it("returns every day of the window, events on the day they fall", () => {
    const events: CalendarEvent[] = [
      { id: "a", title: "Dentist", start: "2026-11-21T14:00:00Z", end: "2026-11-21T15:00:00Z" },
      { id: "b", title: "Away", start: "2026-11-23" },
    ];
    const days = agendaDays(events, [], today, TZ);
    expect(days).toHaveLength(7);
    expect(days[0].key).toBe("2026-11-21");
    expect(days[0].entries.map((entry) => entry.title)).toEqual(["Dentist"]);
    expect(days[0].entries[0].time).not.toBeNull();
    expect(days[2].entries).toMatchObject([{ title: "Away", time: null }]);
    expect(days[1].entries).toEqual([]);
  });

  it("lists all-day events ahead of timed ones", () => {
    const events: CalendarEvent[] = [
      { id: "timed", title: "Lunch", start: "2026-11-21T12:00:00Z" },
      { id: "day", title: "Holiday", start: "2026-11-21" },
    ];
    expect(agendaDays(events, [], today, TZ)[0].entries.map((entry) => entry.id)).toEqual(["day", "timed"]);
  });

  it("points each occurrence of a repeating event at the stored event", () => {
    const events: CalendarEvent[] = [
      { id: "standup", title: "Standup", start: "2026-11-01T09:00:00Z", recurrence: { frequency: "daily" } },
    ];
    const days = agendaDays(events, [], today, TZ);
    expect(days.every((day) => day.entries.length === 1)).toBe(true);
    expect(new Set(days.map((day) => day.entries[0].eventId))).toEqual(new Set(["standup"]));
  });

  it("carries an event that started before the window onto the days it covers", () => {
    const events: CalendarEvent[] = [{ id: "trip", title: "Trip", start: "2026-11-19", end: "2026-11-22" }];
    const days = agendaDays(events, [], today, TZ);
    expect(days[0].entries.map((entry) => entry.title)).toEqual(["Trip"]);
    expect(days[1].entries.map((entry) => entry.title)).toEqual(["Trip"]);
    expect(days[2].entries).toEqual([]);
  });

  it("leaves out calendars the grid hides and keeps their colour on the rest", () => {
    const calendars = [
      calendar("shown", { color: "#aa0000" }),
      calendar("hidden", { hideFromAll: true }),
      calendar("archived", { archived: true }),
    ];
    const events: CalendarEvent[] = [
      { id: "a", title: "Shown", start: "2026-11-21", calendarId: "shown" },
      { id: "b", title: "Hidden", start: "2026-11-21", calendarId: "hidden" },
      { id: "c", title: "Archived", start: "2026-11-21", calendarId: "archived" },
      { id: "d", title: "Loose", start: "2026-11-21" },
    ];
    const entries = agendaDays(events, calendars, today, TZ)[0].entries;
    expect(entries.map((entry) => entry.title).sort()).toEqual(["Loose", "Shown"]);
    expect(entries.find((entry) => entry.title === "Shown")?.color).toBe("#aa0000");
  });

  it("names an untitled event", () => {
    const events: CalendarEvent[] = [{ id: "a", title: "  ", start: "2026-11-21" }];
    expect(agendaDays(events, [], today, TZ)[0].entries[0].title).toBe("Untitled event");
  });
});

describe("upcomingDates", () => {
  it("finds dates in the window, soonest first, with the years they mark", () => {
    const contacts = [
      contact("Ada", [{ kind: "birthday", date: "1990-12-01" }]),
      contact("Bo", [{ kind: "anniversary", date: "2016-11-21" }]),
      contact("Cy", [{ kind: "birthday", date: "1985-03-01" }]),
    ];
    const found = upcomingDates(contacts, today);
    expect(found.map((item) => [item.name, item.label, item.daysAway, item.years])).toEqual([
      ["Bo", "Anniversary", 0, 10],
      ["Ada", "Birthday", 10, 36],
    ]);
    expect(found[1].key).toBe("2026-12-01");
  });

  it("wraps past this year's date to next year's", () => {
    const found = upcomingDates([contact("Di", [{ kind: "birthday", date: "2000-01-05" }])], new Date(2026, 11, 20));
    expect(found).toMatchObject([{ key: "2027-01-05", daysAway: 16, years: 27 }]);
  });

  it("reads a date stored without its year, and gives no age for it", () => {
    const contacts = [
      contact("Ed", [{ kind: "birthday", date: "--11-25" }]),
      contact("Fi", [{ kind: "custom", label: "Name day", date: "--1126" }]),
    ];
    expect(upcomingDates(contacts, today).map((item) => [item.name, item.label, item.years])).toEqual([
      ["Ed", "Birthday", null],
      ["Fi", "Name day", null],
    ]);
  });

  it("marks 29 February on the 28th outside a leap year", () => {
    const found = upcomingDates([contact("Gu", [{ kind: "birthday", date: "2000-02-29" }])], new Date(2027, 1, 1));
    expect(found).toMatchObject([{ key: "2027-02-28" }]);
  });

  it("skips archived contacts, unreadable dates and a year in the future", () => {
    const contacts = [
      contact("Hal", [{ kind: "birthday", date: "1990-11-22" }], { archived: true }),
      contact("Ivy", [{ kind: "birthday", date: "sometime in November" }, { kind: "birthday", date: "1990-02-30" }]),
      contact("Jo", [{ kind: "anniversary", date: "2027-11-22" }]),
    ];
    expect(upcomingDates(contacts, today)).toMatchObject([{ name: "Jo", years: null }]);
  });
});

describe("recent items", () => {
  const note = (id: string, updatedAt?: string, createdAt?: string): Note =>
    ({ id, title: id, body: "", notebookId: "nb", raw: "", updatedAt, createdAt }) as Note;
  const bookmark = (id: string, createdAt?: string): Bookmark =>
    ({ id, title: id, url: "https://example.com", collectionId: "c", raw: "", createdAt }) as Bookmark;

  it("orders notes by their last edit, falling back to when they were made", () => {
    const notes = [
      note("old", "2026-01-01T00:00:00Z"),
      note("undated"),
      note("new", "2026-11-20T00:00:00Z"),
      note("made", undefined, "2026-06-01T00:00:00Z"),
    ];
    expect(recentNotes(notes, 3).map((item) => item.id)).toEqual(["new", "made", "old"]);
  });

  it("orders bookmarks by when they were saved", () => {
    const bookmarks = [bookmark("a", "2026-01-01T00:00:00Z"), bookmark("b", "2026-11-01T00:00:00Z")];
    expect(recentBookmarks(bookmarks, 5).map((item) => item.id)).toEqual(["b", "a"]);
  });
});

describe("greeting", () => {
  it("follows the time of day", () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe("Good morning");
    expect(greeting(new Date(2026, 0, 1, 13))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 0, 1, 21))).toBe("Good evening");
    expect(greeting(new Date(2026, 0, 1, 2))).toBe("Good evening");
  });
});
