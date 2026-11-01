import { describe, expect, it } from "vitest";

import {
  ACCENTS,
  ACCOUNT_SETTINGS_CONTENT_TYPE,
  ACCOUNT_SETTINGS_ID,
  CONTACT_MODES,
  DEFAULT_ACCENT,
  DEFAULT_CONTACT_MODE,
  FEATURES,
  LEGACY_ACCOUNT_SETTINGS_ID,
  canDisableFeature,
  normalizeAccent,
  normalizeContactMode,
  parseAccountSettings,
  serializeAccountSettings,
  withFeature,
} from "./accountSettings";
import {
  coreAccountSettingsKeys,
  coreErrorOf,
  coreSettingsParse,
  coreSettingsWithFeature,
  coreSettingsWrite,
} from "./wasm";
import type { CoreAccountSettings, CoreAccountSettingsDraft } from "./wasm";
import { readFixture } from "../test/fixtures";

/**
 * The shared settings fixture, through the same core the CLI and Android run.
 * Held to the same document as `sealbook-core/tests/settings.rs`.
 */
type Fixture = {
  constants: {
    content_type: string;
    object_id: string;
    legacy_object_id: string;
    keys: string[];
    features: string[];
    contact_modes: string[];
    default_contact_mode: string;
    accents: string[];
    default_accent: string;
  };
  writes: { case: string; draft: CoreAccountSettingsDraft; payload: string }[];
  parses: { case: string; raw: string; settings: CoreAccountSettings }[];
  toggles: {
    case: string;
    raw: string;
    feature: string;
    enabled: boolean;
    settings: CoreAccountSettings;
    can_disable: boolean;
  }[];
  refusals: { case: string; error: string }[];
};

const fixture = JSON.parse(readFixture("payloads/settings.json")) as Fixture;

describe("the constants this client mirrors", () => {
  it("are core's", () => {
    expect(ACCOUNT_SETTINGS_CONTENT_TYPE).toBe(fixture.constants.content_type);
    expect(ACCOUNT_SETTINGS_ID).toBe(fixture.constants.object_id);
    expect(LEGACY_ACCOUNT_SETTINGS_ID).toBe(fixture.constants.legacy_object_id);
    expect(coreAccountSettingsKeys()).toEqual(fixture.constants.keys);
    expect(FEATURES).toEqual(fixture.constants.features);
    expect(CONTACT_MODES).toEqual(fixture.constants.contact_modes);
    expect(DEFAULT_CONTACT_MODE).toBe(fixture.constants.default_contact_mode);
    expect(ACCENTS).toEqual(fixture.constants.accents);
    expect(DEFAULT_ACCENT).toBe(fixture.constants.default_accent);
  });
});

describe("core's settings writer", () => {
  it.each(fixture.refusals.map((c) => [c.case, c] as const))(
    "refuses: %s",
    (_, c) => {
      const raw = '{"version":"9.0","features":{"notes":false}}';
      expect(() =>
        serializeAccountSettings(parseAccountSettings(raw), raw),
      ).toThrow();
      let thrown: unknown;
      try {
        coreSettingsWrite({ ...fixture.writes[0].draft, raw });
      } catch (error) {
        thrown = error;
      }
      expect(coreErrorOf(thrown)?.kind).toBe(c.error);
    },
  );
});

describe("core's settings reader", () => {
  it.each(fixture.parses.map((c) => [c.case, c] as const))(
    "the view model agrees: %s",
    (_, c) => {
      const view = parseAccountSettings(c.raw);
      for (const flag of c.settings.features) {
        expect(view.features[flag.key as keyof typeof view.features]).toBe(
          flag.enabled,
        );
      }
      expect(view.contactMode).toBe(c.settings.contact_mode);
      expect(view.accent).toBe(c.settings.accent);
      expect(Object.entries(view.unknownFeatures ?? {}).sort()).toEqual(
        c.settings.unknown_features
          .map((flag) => [flag.key, flag.enabled])
          .sort(),
      );
    },
  );

  it("normalizers match core on every accent and mode the cases name", () => {
    for (const c of fixture.parses) {
      const parsed = JSON.parse(c.raw.startsWith("{") ? c.raw : "{}") as Record<
        string,
        unknown
      >;
      expect(normalizeAccent(parsed.accent)).toBe(c.settings.accent);
      expect(normalizeContactMode(parsed.contactMode)).toBe(
        c.settings.contact_mode,
      );
    }
  });
});

describe("toggling a feature", () => {
  it.each(fixture.toggles.map((c) => [c.case, c] as const))("%s", (_, c) => {
    const before = coreSettingsParse(c.raw);
    expect(coreSettingsWithFeature(before, c.feature, c.enabled)).toEqual(
      c.settings,
    );
  });

  const known = fixture.toggles.filter((c) =>
    FEATURES.includes(c.feature as (typeof FEATURES)[number]),
  );
  it.each(known.map((c) => [c.case, c] as const))("%s, in the settings view", (_, c) => {
    const view = parseAccountSettings(c.raw);
    const feature = c.feature as (typeof FEATURES)[number];
    expect(canDisableFeature(view, feature)).toBe(c.can_disable);
    expect(withFeature(view, feature, c.enabled).features[feature]).toBe(
      c.settings.features.find((flag) => flag.key === c.feature)?.enabled,
    );
  });
});
