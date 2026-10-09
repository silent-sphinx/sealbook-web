import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_ACCOUNT_SETTINGS } from "./accountSettings";
import { friendlyError } from "./errors";
import { DeviceStorageError, normalizeSnapshot, saveDevice } from "./storage";
import type { DeviceState } from "./types";

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

  it("keeps the stored contact mode and accent, not only the toggles", () => {
    // These used to be dropped here, so opening the vault offline reset the
    // address book to basic and the shell to the default accent.
    const snapshot = {
      ...original,
      accountSettings: { features: {}, contactMode: "detailed", accent: "purple" },
    };
    expect(normalizeSnapshot(snapshot)?.accountSettings).toMatchObject({
      contactMode: "detailed",
      accent: "purple",
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

describe("saveDevice", () => {
  const stored: Record<string, string> = {};

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  function stubStorage(setItem: (key: string, value: string) => void) {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => stored[key] ?? null,
      setItem,
      removeItem: (key: string) => delete stored[key],
    };
  }

  const state: DeviceState = {
    server: "https://vault.example.com",
    username: "ada",
    account_id: "00000000-0000-0000-0000-0000000000a1",
    collection_id: "00000000-0000-0000-0000-0000000000c1",
    device_id: "00000000-0000-0000-0000-0000000000d1",
    session_token: "secret-token",
    kdf_salt: "AAAA",
    hpke_sk: "BBBB",
    mldsa_seed: "CCCC",
    ed25519_sk: "DDDD",
  };

  it("names the cause when the storage area refuses the write", async () => {
    stubStorage(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const err = await saveDevice(state, "pw").catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(DeviceStorageError);
    // Reaches the user as written rather than as "Something went wrong".
    expect(friendlyError(err)).toMatch(/would not store this device's key/u);
  });

  it("writes an envelope that does not hold the session token", async () => {
    let written = "";
    stubStorage((_key, value) => {
      written = value;
    });
    await saveDevice(state, "pw");
    expect(written).not.toContain("secret-token");
    expect(JSON.parse(written)).toMatchObject({ metadata: { username: "ada" } });
  });
});
