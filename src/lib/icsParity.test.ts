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

describe("shared calendar sample, zones resolved by the host", () => {
  test("ICS", () => {
    const { events, skipped } = parseIcs(readFixture("imports/calendar.ics"), "Europe/London");
    expect(events.map((e) => stored(serializeEvent(e)))).toEqual(expected.ics.events);
    expect(skipped).toHaveLength(1);
  });
});
