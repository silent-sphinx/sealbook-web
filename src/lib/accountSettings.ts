import { mergePayload, PAYLOAD_SCHEMA_VERSION } from "./payload";
import type { AccentKey, AccountSettings, ContactMode, FeatureKey } from "./types";

/**
 * Account settings live in the vault as one sealed object, not as a server
 * field: the server is not trusted with vault contents, and an object is what
 * already syncs to every device. A client that does not know this content type
 * ignores the object, so the toggles degrade to "everything enabled" there
 * rather than breaking that client's sync.
 */
export const ACCOUNT_SETTINGS_CONTENT_TYPE = "application/sealbook.settings+json";

/**
 * Fixed id, continuing the well-known ids in
 * `sealbook/crates/sealbook-protocol/src/lib.rs` (1 is the default address book,
 * 2 the default notebook, 3 the default calendar). One id per account means a
 * second device edits the same object instead of creating a rival copy.
 *
 * Reserve the next free number here rather than reusing one: 3 held these
 * settings before the default calendar existed, and the two writers then took
 * turns overwriting one object. `LEGACY_ACCOUNT_SETTINGS_ID` is read for the
 * accounts that were sealed in that window.
 */
export const ACCOUNT_SETTINGS_ID = "00000000-0000-0000-0000-000000000004";

/** Where these settings used to live, read only to migrate them off it. */
export const LEGACY_ACCOUNT_SETTINGS_ID = "00000000-0000-0000-0000-000000000003";

/** Also the order the features appear in the UI. */
export const FEATURES: FeatureKey[] = ["contacts", "calendar", "notes"];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  contacts: "Contacts",
  calendar: "Calendar",
  notes: "Notes",
};

/**
 * Also the order the modes appear in the UI. `basic` is first because it is the
 * default for an account that has never chosen.
 */
export const CONTACT_MODES: ContactMode[] = ["basic", "detailed"];

export const CONTACT_MODE_LABELS: Record<ContactMode, string> = {
  basic: "Basic",
  detailed: "Detailed",
};

/**
 * Detailed is opt-in rather than the default: the relationship sections are for
 * someone keeping a history on people, and an address book should not open as a
 * ten-section form for everyone else.
 */
export const DEFAULT_CONTACT_MODE: ContactMode = "basic";

/** Also the order the swatches appear in the UI. */
export const ACCENTS: AccentKey[] = ["blue", "cyan", "green", "amber", "rose", "purple"];

export const ACCENT_LABELS: Record<AccentKey, string> = {
  blue: "Blue",
  cyan: "Cyan",
  green: "Green",
  amber: "Amber",
  rose: "Rose",
  purple: "Purple",
};

/**
 * Base and dim tint per accent. `dim` is hand-picked rather than derived: it
 * backs focus borders and the blockquote rule, where an evenly darkened base
 * reads as muddy against `--color-panel`. The glow and ring tints are mixed
 * from the base, which needs no second constant per accent.
 */
export const ACCENT_COLORS: Record<AccentKey, { base: string; dim: string }> = {
  blue: { base: "#7aa2f7", dim: "#5a7fcf" },
  cyan: { base: "#7dcfff", dim: "#58a3d4" },
  green: { base: "#9ece6a", dim: "#78a44e" },
  amber: { base: "#e0af68", dim: "#b4884b" },
  rose: { base: "#f0859b", dim: "#c66076" },
  purple: { base: "#bb9af7", dim: "#9377cf" },
};

/** Blue, which is the accent `index.css` declares as the theme default. */
export const DEFAULT_ACCENT: AccentKey = "blue";

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  features: { contacts: true, calendar: true, notes: true },
  contactMode: DEFAULT_CONTACT_MODE,
  accent: DEFAULT_ACCENT,
};

/**
 * The `--sb-accent*` tokens `index.css` declares, which the theme's
 * `--color-accent*` resolve through. Overriding these re-tints every accent
 * utility, including the faded `bg-accent/10` kind: the theme reaching an accent
 * through a var is what stops Tailwind pre-computing those mixes into a literal
 * at build time, so keep that indirection in place.
 */
export function accentVariables(accent: unknown): Record<string, string> {
  const { base, dim } = ACCENT_COLORS[normalizeAccent(accent)];
  return {
    "--sb-accent": base,
    "--sb-accent-dim": dim,
    "--sb-accent-glow": `color-mix(in srgb, ${base} 8%, transparent)`,
    "--sb-accent-ring": `color-mix(in srgb, ${base} 25%, transparent)`,
  };
}

const ACCOUNT_SETTINGS_KEYS = [
  "@type",
  "version",
  "features",
  "contactMode",
  "accent",
] as const;

export function serializeAccountSettings(
  settings: AccountSettings,
  previousRaw?: string,
): string {
  const normalized = normalizeAccountSettings(settings);
  return mergePayload(
    previousRaw,
    {
      "@type": "AccountSettings",
      version: PAYLOAD_SCHEMA_VERSION,
      features: normalized.features,
      contactMode: normalized.contactMode,
      accent: normalized.accent,
    },
    ACCOUNT_SETTINGS_KEYS,
  );
}

export function parseAccountSettings(raw: string): AccountSettings {
  try {
    return normalizeAccountSettings(JSON.parse(raw));
  } catch {
    // An unreadable payload must not take the vault down or hide a feature the
    // user still has data in, so it reads as the default: everything enabled.
    return DEFAULT_ACCOUNT_SETTINGS;
  }
}

/**
 * Coerces a whole stored object, as opposed to `normalizeFeatures`, which takes
 * the fields apart. Every caller holding a settings-shaped value should use this
 * one: picking fields off by hand is how a preference a build does not care
 * about gets dropped on the way through.
 */
export function normalizeAccountSettings(value: unknown): AccountSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return normalizeFeatures(raw.features, raw.contactMode, raw.accent);
}

/** Anything other than a known accent is the default, as for the contact mode. */
export function normalizeAccent(value: unknown): AccentKey {
  return ACCENTS.includes(value as AccentKey) ? (value as AccentKey) : DEFAULT_ACCENT;
}

/**
 * Anything other than the two known modes is `basic`, so a payload from a build
 * that never wrote the field does not read as detailed.
 */
export function normalizeContactMode(value: unknown): ContactMode {
  return value === "detailed" ? "detailed" : DEFAULT_CONTACT_MODE;
}

/**
 * Coerces any stored shape into the three flags, keeping the "at least one on"
 * rule.
 *
 * A missing or non-boolean flag is enabled: a build that predates a feature
 * writes no flag for it, and that must not read back as the user having turned
 * it off. An all-off payload is a client that ignored the rule, and is repaired
 * to the first feature rather than left as a vault with nothing in it.
 */
export function normalizeFeatures(
  value: unknown,
  mode?: unknown,
  accent?: unknown,
): AccountSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const features = {} as Record<FeatureKey, boolean>;
  for (const feature of FEATURES) {
    features[feature] = raw[feature] !== false;
  }
  if (!FEATURES.some((feature) => features[feature])) {
    features[FEATURES[0]] = true;
  }
  return {
    features,
    contactMode: normalizeContactMode(mode),
    accent: normalizeAccent(accent),
  };
}

export function isFeatureEnabled(settings: AccountSettings, feature: FeatureKey): boolean {
  return settings.features[feature] !== false;
}

export function enabledFeatures(settings: AccountSettings): FeatureKey[] {
  return FEATURES.filter((feature) => isFeatureEnabled(settings, feature));
}

/** False for the last enabled feature, which is the one the rule protects. */
export function canDisableFeature(settings: AccountSettings, feature: FeatureKey): boolean {
  if (!isFeatureEnabled(settings, feature)) return false;
  return enabledFeatures(settings).length > 1;
}

/**
 * The settings with one feature flipped, or the settings unchanged when the
 * change would leave the account with no features at all.
 *
 * The rule is enforced here as well as in the UI, so a caller cannot write an
 * empty account by skipping the disabled button.
 */
export function withFeature(
  settings: AccountSettings,
  feature: FeatureKey,
  enabled: boolean,
): AccountSettings {
  if (!enabled && !canDisableFeature(settings, feature)) {
    return settings;
  }
  return normalizeFeatures(
    { ...settings.features, [feature]: enabled },
    settings.contactMode,
    settings.accent,
  );
}

export function isDetailedContacts(settings: AccountSettings): boolean {
  return normalizeContactMode(settings.contactMode) === "detailed";
}

export function withContactMode(settings: AccountSettings, mode: ContactMode): AccountSettings {
  return normalizeFeatures(settings.features, mode, settings.accent);
}

export function withAccent(settings: AccountSettings, accent: AccentKey): AccountSettings {
  return normalizeFeatures(settings.features, settings.contactMode, accent);
}
