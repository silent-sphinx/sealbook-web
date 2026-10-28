import { describe, expect, it } from "vitest";
import { readFixture } from "../test/fixtures";
import { recurrenceFrom } from "./calendar";
import { expandCalendarEvents, nextOccurrence } from "./recurrence";
import { coreIsCalendarDay } from "./wasm";
import type { CoreRecurrence } from "./wasm";

const fixture = JSON.parse(readFixture("payloads/recurrence.json")) as {
  cases: {
    name: string;
    anchor: string;
    rule: CoreRecurrence;
    from: string;
    to: string;
    days: string[];
    after: string;
    next: string | null;
  }[];
  calendar_days: { text: string; valid: boolean }[];
};

const key = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

describe("recurrence against the shared fixture", () => {
  for (const item of fixture.cases) {
    it(item.name, () => {
      const rule = recurrenceFrom(item.rule);
      const event = {
        id: "e",
        title: "t",
        start: item.anchor,
        recurrence: rule,
      };
      const days = expandCalendarEvents(
        [event],
        new Date(`${item.from}T00:00`),
        new Date(`${item.to}T23:59`),
        "UTC",
      ).map((occurrence) => occurrence.occurrenceKey);
      expect(days).toEqual(item.days);
      const next = nextOccurrence(
        new Date(`${item.anchor}T00:00`),
        rule,
        new Date(`${item.after}T00:00`),
      );
      expect(next ? key(next) : null).toBe(item.next);
    });
  }

  it("agrees on which texts are days", () => {
    for (const item of fixture.calendar_days)
      expect(coreIsCalendarDay(item.text)).toBe(item.valid);
  });
});
