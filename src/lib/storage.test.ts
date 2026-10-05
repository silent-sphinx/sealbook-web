import { describe, expect, it } from "vitest";

import { DEFAULT_ACCOUNT_SETTINGS } from "./accountSettings";
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
    expect(normalizeSnapshot(original)).toEqual({
      ...original,
      notes: [],
      notebooks: [],
      accountSettings: DEFAULT_ACCOUNT_SETTINGS,
    });
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

  it("keeps the stored feature toggles", () => {
    const snapshot = { ...original, accountSettings: { features: { notes: false } } };
    expect(normalizeSnapshot(snapshot)?.accountSettings.features).toEqual({
      contacts: true,
      calendar: true,
      notes: false,
    });
  });

  it("defaults a wrong-typed new field rather than discarding the old data", () => {
    expect(normalizeSnapshot({ ...original, notes: "nonsense" })).toMatchObject({ notes: [] });
  });

  it("rejects a non-object", () => {
    expect(normalizeSnapshot(null)).toBeNull();
    expect(normalizeSnapshot("snapshot")).toBeNull();
  });
});
