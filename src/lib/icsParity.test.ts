import { describe, expect, test } from "vitest";
import { readFixture } from "../test/fixtures";
import { serializeEvent } from "./calendar";
import { parseIcs } from "./ics";

const expected = JSON.parse(readFixture("imports/expected.json"));

const stored = (raw: string) => {
  const value = JSON.parse(raw);
  for (const key of ["created", "updated"]) delete value[key];
  return JSON.parse(JSON.stringify(value).replace(/(T\d\d:\d\d:\d\d)\.000Z/g, "$1Z"));
};

/**
 * The fixture records what an import parsed, which predates the fields every
 * write now carries: the schema version, the stamps and the calendar. They are
 * set by the writer, not read from the file, so they are not part of the parse.
 */
const parsedFields = (raw: string) => {
  const value = stored(raw);
  for (const key of ["version", "createdAt", "updatedAt", "calendarId"]) delete value[key];
  return { ...value, version: "1.0" };
};

describe("shared calendar sample, zones resolved by the host", () => {
  test("ICS", () => {
    const { events, skipped } = parseIcs(readFixture("imports/calendar.ics"), "Europe/London");
    expect(events.map((e) => parsedFields(serializeEvent(e)))).toEqual(expected.ics.events);
    expect(skipped).toHaveLength(1);
  });
});
