import { describe, expect, it } from "vitest";

import {
  DEFAULT_ACCOUNT_SETTINGS,
  canDisableFeature,
  enabledFeatures,
  isFeatureEnabled,
  normalizeFeatures,
  parseAccountSettings,
  serializeAccountSettings,
  withFeature,
} from "./accountSettings";

const settings = (over: Partial<Record<string, boolean>> = {}) =>
  normalizeFeatures({ contacts: true, calendar: true, notes: true, ...over });

describe("account settings payload", () => {
  it("round trips the three flags", () => {
    const stored = serializeAccountSettings(settings({ calendar: false }));
    expect(parseAccountSettings(stored).features).toEqual({
      contacts: true,
      calendar: false,
      notes: true,
    });
  });

  it("names its type so a payload is recognisable without the content type", () => {
    expect(JSON.parse(serializeAccountSettings(DEFAULT_ACCOUNT_SETTINGS))["@type"]).toBe(
      "AccountSettings",
    );
  });

  it("reads a payload from a build that did not know a feature as enabled", () => {
    // Anything other than an explicit false is on, so a flag a previous build
    // never wrote does not read back as the user having turned the feature off.
    expect(parseAccountSettings(JSON.stringify({ features: { contacts: true } })).features).toEqual(
      DEFAULT_ACCOUNT_SETTINGS.features,
    );
  });

  it("falls back to the defaults for an unreadable payload", () => {
    expect(parseAccountSettings("not json").features).toEqual(DEFAULT_ACCOUNT_SETTINGS.features);
  });

  it("repairs an all-off payload written by a client that ignored the rule", () => {
    const repaired = parseAccountSettings(
      JSON.stringify({ features: { contacts: false, calendar: false, notes: false } }),
    );
    expect(enabledFeatures(repaired)).toEqual(["contacts"]);
  });
});

describe("the at-least-one rule", () => {
  it("allows disabling while more than one is on", () => {
    expect(canDisableFeature(settings(), "notes")).toBe(true);
    expect(isFeatureEnabled(withFeature(settings(), "notes", false), "notes")).toBe(false);
  });

  it("refuses to disable the last enabled feature", () => {
    const last = settings({ calendar: false, notes: false });
    expect(canDisableFeature(last, "contacts")).toBe(false);
    // Returned unchanged rather than thrown, so a caller that skipped the check
    // cannot write an account with nothing in it.
    expect(withFeature(last, "contacts", false)).toBe(last);
  });

  it("re-enabling is never blocked", () => {
    const only = settings({ calendar: false, notes: false });
    expect(enabledFeatures(withFeature(only, "notes", true))).toEqual(["contacts", "notes"]);
  });
});
