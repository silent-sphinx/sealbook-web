import { describe, expect, it } from "vitest";

import { DEFAULT_ADDRESS_BOOK_ID } from "./addressBook";
import { DEFAULT_CALENDAR_ID } from "./calendar";
import { DEFAULT_NOTEBOOK_ID } from "./note";
import {
  ACCENTS,
  ACCENT_COLORS,
  ACCOUNT_SETTINGS_ID,
  DEFAULT_ACCENT,
  DEFAULT_ACCOUNT_SETTINGS,
  LEGACY_ACCOUNT_SETTINGS_ID,
  accentVariables,
  canDisableFeature,
  enabledFeatures,
  isDetailedContacts,
  isFeatureEnabled,
  normalizeAccent,
  normalizeFeatures,
  parseAccountSettings,
  serializeAccountSettings,
  withAccent,
  withContactMode,
  withFeature,
} from "./accountSettings";

const settings = (over: Partial<Record<string, boolean>> = {}) =>
  normalizeFeatures({ contacts: true, calendar: true, notes: true, bookmarks: true, ...over });

describe("account settings payload", () => {
  it("round trips the feature flags", () => {
    const stored = serializeAccountSettings(settings({ calendar: false }));
    expect(parseAccountSettings(stored).features).toEqual({
      contacts: true,
      calendar: false,
      notes: true,
      bookmarks: true,
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
      JSON.stringify({
        features: { contacts: false, calendar: false, notes: false, bookmarks: false },
      }),
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
    const last = settings({ calendar: false, notes: false, bookmarks: false });
    expect(canDisableFeature(last, "contacts")).toBe(false);
    // Returned unchanged rather than thrown, so a caller that skipped the check
    // cannot write an account with nothing in it.
    expect(withFeature(last, "contacts", false)).toBe(last);
  });

  it("re-enabling is never blocked", () => {
    const only = settings({ calendar: false, notes: false, bookmarks: false });
    expect(enabledFeatures(withFeature(only, "notes", true))).toEqual(["contacts", "notes"]);
  });
});

describe("the contact detail mode", () => {
  it("is basic for an account that has never chosen", () => {
    expect(DEFAULT_ACCOUNT_SETTINGS.contactMode).toBe("basic");
    expect(isDetailedContacts(DEFAULT_ACCOUNT_SETTINGS)).toBe(false);
  });

  it("round trips through the payload", () => {
    const stored = serializeAccountSettings(withContactMode(settings(), "detailed"));
    expect(isDetailedContacts(parseAccountSettings(stored))).toBe(true);
  });

  it("reads a payload from a build that never wrote the field as basic", () => {
    const stored = JSON.stringify({ features: { contacts: true, calendar: true, notes: true } });
    expect(parseAccountSettings(stored).contactMode).toBe("basic");
  });

  it("reads an unknown mode as basic rather than trusting the string", () => {
    expect(parseAccountSettings(JSON.stringify({ contactMode: "everything" })).contactMode).toBe(
      "basic",
    );
  });

  it("survives a feature being toggled", () => {
    // withFeature rebuilds the settings, so the mode has to be carried across or
    // turning the calendar off would quietly reset the address book to basic.
    const detailed = withContactMode(settings(), "detailed");
    expect(isDetailedContacts(withFeature(detailed, "calendar", false))).toBe(true);
  });

  it("leaves the feature flags alone when the mode changes", () => {
    const some = settings({ notes: false });
    expect(enabledFeatures(withContactMode(some, "detailed"))).toEqual(enabledFeatures(some));
  });
});

describe("the accent colour", () => {
  it("is the theme default for an account that has never chosen", () => {
    expect(DEFAULT_ACCOUNT_SETTINGS.accent).toBe(DEFAULT_ACCENT);
  });

  it("round trips through the payload", () => {
    const stored = serializeAccountSettings(withAccent(settings(), "purple"));
    expect(parseAccountSettings(stored).accent).toBe("purple");
  });

  it("reads a payload from a build that never wrote the field as the default", () => {
    const stored = JSON.stringify({ features: { contacts: true }, contactMode: "detailed" });
    expect(parseAccountSettings(stored).accent).toBe(DEFAULT_ACCENT);
  });

  it("reads an unknown accent as the default rather than trusting the string", () => {
    expect(normalizeAccent("chartreuse")).toBe(DEFAULT_ACCENT);
    expect(parseAccountSettings(JSON.stringify({ accent: "#ff0000" })).accent).toBe(DEFAULT_ACCENT);
  });

  it("survives a feature or the contact mode being changed", () => {
    // withFeature and withContactMode both rebuild the settings, so the accent
    // has to be carried across or saving any other preference resets the theme.
    const amber = withAccent(settings(), "amber");
    expect(withFeature(amber, "calendar", false).accent).toBe("amber");
    expect(withContactMode(amber, "detailed").accent).toBe("amber");
  });

  it("leaves the other preferences alone when the accent changes", () => {
    const detailed = withContactMode(settings({ notes: false }), "detailed");
    const recoloured = withAccent(detailed, "rose");
    expect(enabledFeatures(recoloured)).toEqual(enabledFeatures(detailed));
    expect(isDetailedContacts(recoloured)).toBe(true);
  });

  it("has a tuned pair of colours for every offered accent", () => {
    for (const accent of ACCENTS) {
      expect(ACCENT_COLORS[accent].base).toMatch(/^#[0-9a-f]{6}$/);
      expect(ACCENT_COLORS[accent].dim).not.toBe(ACCENT_COLORS[accent].base);
    }
  });

  it("overrides exactly the four accent tokens index.css declares", () => {
    const vars = accentVariables("green");
    expect(Object.keys(vars).sort()).toEqual([
      "--sb-accent",
      "--sb-accent-dim",
      "--sb-accent-glow",
      "--sb-accent-ring",
    ]);
    expect(vars["--sb-accent"]).toBe(ACCENT_COLORS.green.base);
  });

  it("tints an unreadable stored accent rather than emitting an empty colour", () => {
    expect(accentVariables(undefined)["--sb-accent"]).toBe(ACCENT_COLORS[DEFAULT_ACCENT].base);
  });
});

describe("the well-known object ids", () => {
  // Two writers to one id take turns overwriting each other: the settings
  // object sat on the default calendar's id, so creating that calendar reset
  // every preference and saving a preference deleted the calendar.
  it("are one per object, so no two writers share a fixed id", () => {
    const ids = [
      DEFAULT_ADDRESS_BOOK_ID,
      DEFAULT_NOTEBOOK_ID,
      DEFAULT_CALENDAR_ID,
      ACCOUNT_SETTINGS_ID,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the legacy settings id pointing at the collision, for the migration", () => {
    expect(LEGACY_ACCOUNT_SETTINGS_ID).toBe(DEFAULT_CALENDAR_ID);
  });
});

/**
 * `features` is a single key as far as `mergePayload` is concerned, so a flag
 * belonging to a feature this build has never heard of is only safe if it is
 * carried explicitly. Without this, an older client writing settings silently
 * turned a newer client's disabled feature back on.
 */
describe("a feature flag this build does not know", () => {
  const stored = JSON.stringify({
    "@type": "AccountSettings",
    version: "1.0",
    features: { contacts: true, calendar: true, notes: true, timeTravel: false },
    contactMode: "basic",
    accent: "blue",
  });

  it("survives a save made by a build without it", () => {
    const settings = parseAccountSettings(stored);
    const raw = serializeAccountSettings(settings, stored);
    const features = (JSON.parse(raw) as { features: Record<string, boolean> }).features;
    expect(features.timeTravel).toBe(false);
    expect(features.contacts).toBe(true);
  });

  it("survives flipping a flag this build does know", () => {
    const settings = withFeature(parseAccountSettings(stored), "calendar", false);
    const raw = serializeAccountSettings(settings, stored);
    const features = (JSON.parse(raw) as { features: Record<string, boolean> }).features;
    expect(features.timeTravel).toBe(false);
    expect(features.calendar).toBe(false);
  });

  it("survives a change to the contact mode or the accent", () => {
    const settings = withAccent(
      withContactMode(parseAccountSettings(stored), "detailed"),
      "purple",
    );
    const raw = serializeAccountSettings(settings, stored);
    const features = (JSON.parse(raw) as { features: Record<string, boolean> }).features;
    expect(features.timeTravel).toBe(false);
  });

  it("is not mistaken for one of this build's own", () => {
    const settings = parseAccountSettings(stored);
    expect(enabledFeatures(settings)).not.toContain("timeTravel");
  });
});
