import { describe, expect, it } from "vitest";
import { editTitle, filterEvents, planBulkEdit, stripMatch, type EventFilter } from "./calendarBulk";
import type { CalendarEvent } from "./types";

function anEvent(id: string, title: string, start: string, calendarId?: string): CalendarEvent {
  return { id, title, start, calendarId };
}

const base: EventFilter = { text: "", match: "prefix", caseSensitive: false, calendarId: "all" };

describe("stripMatch", () => {
  it("drops a prefix and the separator after it", () => {
    const filter = { ...base, text: "HOL" };
    expect(stripMatch("HOL - Paris", filter)).toBe("Paris");
    expect(stripMatch("hol: Rome", filter)).toBe("Rome");
    expect(stripMatch("HOL \u2013 Oslo", filter)).toBe("Oslo");
  });

  it("drops a suffix and the separator before it", () => {
    expect(stripMatch("Standup (WFH)", { ...base, match: "suffix", text: "(WFH)" })).toBe("Standup");
  });

  it("drops every occurrence of contained text", () => {
    expect(stripMatch("Trip [x] to [X] Rome", { ...base, match: "contains", text: "[x]" })).toBe("Trip to Rome");
  });

  it("respects case sensitivity", () => {
    expect(stripMatch("hol - Paris", { ...base, text: "HOL", caseSensitive: true })).toBe("hol - Paris");
  });

  it("keeps a title that would end up empty", () => {
    expect(stripMatch("HOL -", { ...base, text: "HOL" })).toBe("HOL -");
  });
});

describe("editTitle", () => {
  it("replaces text literally, not as a pattern", () => {
    expect(editTitle("a.b.c", { kind: "replace", find: ".", replace: "/" }, base)).toBe("a/b/c");
    expect(editTitle("Cost $1", { kind: "replace", find: "$1", replace: "$$2" }, base)).toBe("Cost $$2");
  });

  it("adds and sets text", () => {
    expect(editTitle("Paris", { kind: "prefix", text: "Holiday: " }, base)).toBe("Holiday: Paris");
    expect(editTitle("Paris", { kind: "suffix", text: " (tbc)" }, base)).toBe("Paris (tbc)");
    expect(editTitle("Paris", { kind: "set", text: "  " }, base)).toBe("Paris");
  });
});

describe("filterEvents", () => {
  const events = [
    anEvent("b", "HOL - Rome", "2026-08-01", "personal"),
    anEvent("a", "HOL - Paris", "2026-07-01T09:00:00.000Z", "work"),
    anEvent("c", "Standup", "2026-07-02T09:00:00.000Z", "work"),
    anEvent("d", "HOL - Lost", "2026-07-03"),
  ];

  it("matches on title, sorted by start", () => {
    expect(filterEvents(events, { ...base, text: "hol" }, "UTC").map((e) => e.id)).toEqual(["a", "d", "b"]);
  });

  it("narrows by calendar, including events with none", () => {
    expect(filterEvents(events, { ...base, calendarId: "work" }, "UTC").map((e) => e.id)).toEqual(["a", "c"]);
    expect(filterEvents(events, { ...base, calendarId: "none" }, "UTC").map((e) => e.id)).toEqual(["d"]);
  });

  it("narrows by local start day", () => {
    const late = anEvent("e", "Late", "2026-07-01T23:30:00.000Z");
    const filter = { ...base, from: "2026-07-02", to: "2026-07-02" };
    expect(filterEvents([late], filter, "Europe/London").map((e) => e.id)).toEqual(["e"]);
    expect(filterEvents([late], filter, "UTC")).toEqual([]);
  });
});

describe("planBulkEdit", () => {
  it("strips the prefix and moves calendar in one pass", () => {
    const filter = { ...base, text: "HOL - " };
    const plan = planBulkEdit(
      [anEvent("a", "HOL - Paris", "2026-07-01", "work"), anEvent("b", "HOL - Rome", "2026-08-01", "holidays")],
      { title: { kind: "strip" }, calendarId: "holidays" },
      filter,
    );
    expect(plan.map(({ title, calendarId, changed }) => ({ title, calendarId, changed }))).toEqual([
      { title: "Paris", calendarId: "holidays", changed: true },
      { title: "Rome", calendarId: "holidays", changed: true },
    ]);
  });

  it("marks an event already in place as unchanged", () => {
    const [change] = planBulkEdit([anEvent("a", "X", "2026-07-01", "work")], { title: { kind: "keep" }, calendarId: "work" }, base);
    expect(change.changed).toBe(false);
  });
});
