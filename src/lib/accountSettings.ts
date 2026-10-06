import type { AccountSettings, ContactMode, FeatureKey } from "./types";

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
 * 2 the default notebook). One id per account means a second device edits the
 * same object instead of creating a rival copy.
 */
export const ACCOUNT_SETTINGS_ID = "00000000-0000-0000-0000-000000000003";

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

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  features: { contacts: true, calendar: true, notes: true },
  contactMode: DEFAULT_CONTACT_MODE,
};

export function serializeAccountSettings(settings: AccountSettings): string {
  const normalized = normalizeFeatures(settings.features, settings.contactMode);
  return JSON.stringify({
    "@type": "AccountSettings",
    version: "1.0",
    features: normalized.features,
    contactMode: normalized.contactMode,
  });
}

export function parseAccountSettings(raw: string): AccountSettings {
  try {
    const body = JSON.parse(raw) as { features?: unknown; contactMode?: unknown };
    return normalizeFeatures(body.features, body.contactMode);
  } catch {
    // An unreadable payload must not take the vault down or hide a feature the
    // user still has data in, so it reads as the default: everything enabled.
    return DEFAULT_ACCOUNT_SETTINGS;
  }
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
export function normalizeFeatures(value: unknown, mode?: unknown): AccountSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const features = {} as Record<FeatureKey, boolean>;
  for (const feature of FEATURES) {
    features[feature] = raw[feature] !== false;
  }
  if (!FEATURES.some((feature) => features[feature])) {
    features[FEATURES[0]] = true;
  }
  return { features, contactMode: normalizeContactMode(mode) };
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
  return normalizeFeatures({ ...settings.features, [feature]: enabled }, settings.contactMode);
}

export function isDetailedContacts(settings: AccountSettings): boolean {
  return normalizeContactMode(settings.contactMode) === "detailed";
}

export function withContactMode(settings: AccountSettings, mode: ContactMode): AccountSettings {
  return normalizeFeatures(settings.features, mode);
}
