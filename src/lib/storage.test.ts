import { describe, expect, it } from "vitest";

import { normalizeSnapshot } from "./storage";

const original = {
  contacts: [],
  addressBooks: [],
  calendars: [],
  calendarEvents: [],
};

describe("normalizeSnapshot", () => {
  it("a_snapshot_written_before_notes_still_opens", () => {
    // Without the defaults an earlier build's snapshot would be discarded and the
    // user would silently lose offline mode until their next online login.
    expect(normalizeSnapshot(original)).toEqual({ ...original, notes: [], notebooks: [] });
  });

  it("keeps the collections it is given", () => {
    const snapshot = { ...original, notes: [{ id: "n" }], notebooks: [{ id: "b" }] };
    expect(normalizeSnapshot(snapshot)).toMatchObject({
      notes: [{ id: "n" }],
      notebooks: [{ id: "b" }],
    });
  });

  it("rejects a snapshot missing one of the original collections", () => {
    for (const field of ["contacts", "addressBooks", "calendars", "calendarEvents"] as const) {
      const broken: Record<string, unknown> = { ...original };
      delete broken[field];
      expect(normalizeSnapshot(broken)).toBeNull();
    }
  });

  it("defaults a wrong-typed new field rather than discarding the old data", () => {
    expect(normalizeSnapshot({ ...original, notes: "nonsense" })).toMatchObject({ notes: [] });
  });

  it("rejects a non-object", () => {
    expect(normalizeSnapshot(null)).toBeNull();
    expect(normalizeSnapshot("snapshot")).toBeNull();
  });
});
