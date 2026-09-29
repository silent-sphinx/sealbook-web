import { describe, expect, it } from "vitest";
import { localInputToUtc, utcOffsetLabel, utcToLocalInput } from "./timezone";

describe("utcToLocalInput", () => {
  it("converts a UTC instant into a local datetime-local value", () => {
    // 09:00Z in September is 10:00 in London (BST).
    expect(utcToLocalInput("2026-09-28T09:00:00Z", "Europe/London")).toBe("2026-09-28T10:00");
  });

  it("applies standard time outside daylight saving", () => {
    // January is GMT, so no shift.
    expect(utcToLocalInput("2026-01-15T09:00:00Z", "Europe/London")).toBe("2026-01-15T09:00");
  });

  it("can move the date backwards across midnight", () => {
    expect(utcToLocalInput("2026-01-15T02:00:00Z", "America/Los_Angeles")).toBe("2026-01-14T18:00");
  });

  it("can move the date forwards across midnight", () => {
    expect(utcToLocalInput("2026-01-15T20:00:00Z", "Asia/Tokyo")).toBe("2026-01-16T05:00");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(utcToLocalInput("not-a-date", "Europe/London")).toBe("not-a-date");
  });
});

describe("localInputToUtc", () => {
  it("is the inverse of utcToLocalInput", () => {
    for (const zone of ["Europe/London", "Asia/Tokyo", "America/Los_Angeles", "UTC"]) {
      for (const instant of ["2026-09-28T09:00:00.000Z", "2026-01-15T02:30:00.000Z"]) {
        const local = utcToLocalInput(instant, zone);
        expect(new Date(localInputToUtc(local, zone)).toISOString()).toBe(instant);
      }
    }
  });

  it("treats a bare date as midnight local", () => {
    expect(localInputToUtc("2026-06-01T00:00", "Asia/Tokyo")).toBe("2026-05-31T15:00:00.000Z");
  });

  it("handles a zone with a half-hour offset", () => {
    const local = utcToLocalInput("2026-06-01T00:00:00.000Z", "Asia/Kolkata");
    expect(local).toBe("2026-06-01T05:30");
    expect(localInputToUtc(local, "Asia/Kolkata")).toBe("2026-06-01T00:00:00.000Z");
  });

  it("round-trips across a daylight-saving transition", () => {
    // The day after the UK springs forward.
    const instant = "2026-03-30T12:00:00.000Z";
    const local = utcToLocalInput(instant, "Europe/London");
    expect(new Date(localInputToUtc(local, "Europe/London")).toISOString()).toBe(instant);
  });
});

describe("utcOffsetLabel", () => {
  it("reports a zero offset for UTC", () => {
    expect(utcOffsetLabel("UTC", new Date("2026-06-01T00:00:00Z"))).toBe("UTC+00:00");
  });

  it("reports a positive offset", () => {
    expect(utcOffsetLabel("Asia/Tokyo", new Date("2026-06-01T00:00:00Z"))).toBe("UTC+09:00");
  });

  it("reports a negative offset", () => {
    expect(utcOffsetLabel("America/Los_Angeles", new Date("2026-01-15T00:00:00Z"))).toBe("UTC-08:00");
  });

  it("reports a half-hour offset", () => {
    expect(utcOffsetLabel("Asia/Kolkata", new Date("2026-06-01T00:00:00Z"))).toBe("UTC+05:30");
  });

  it("follows daylight saving for the given date", () => {
    expect(utcOffsetLabel("Europe/London", new Date("2026-01-15T00:00:00Z"))).toBe("UTC+00:00");
    expect(utcOffsetLabel("Europe/London", new Date("2026-06-15T00:00:00Z"))).toBe("UTC+01:00");
  });
});
