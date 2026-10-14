import { DEFAULT_ACCOUNT_SETTINGS, isFeatureEnabled } from "./accountSettings";
import { DEFAULT_ADDRESS_BOOK_NAME } from "./addressBook";
import { DEFAULT_BOOKMARK_COLLECTION_NAME } from "./bookmark";
import { DEFAULT_CALENDAR_NAME } from "./calendar";
import { DEFAULT_NOTEBOOK_NAME } from "./note";
import type { AccountSettings, FeatureKey } from "./types";

/**
 * Set when registration succeeds and cleared when the welcome is finished or
 * dismissed, so a reload part way through onboarding returns to it. Recovery
 * reaches the same phrase screen as registration but never sets this, because a
 * recovered account has already been set up.
 */
export const ONBOARDING_KEY = "sealbook.onboarding";

export type OnboardingStep =
  | "welcome"
  | "features"
  | "contacts"
  | "containers"
  | "import"
  | "clients";

/** The per-feature container lists, keyed as they are on the draft. */
export type ContainerKey = "addressBooks" | "calendars" | "notebooks" | "collections";

export type OnboardingDraft = {
  settings: AccountSettings;
  addressBooks: string[];
  calendars: string[];
  notebooks: string[];
  collections: string[];
};

export type OnboardingPlan = {
  settings: AccountSettings;
  addressBooks: string[];
  calendars: string[];
  notebooks: string[];
  collections: string[];
};

export const CONTAINER_KEYS: Record<FeatureKey, ContainerKey> = {
  contacts: "addressBooks",
  calendar: "calendars",
  notes: "notebooks",
  bookmarks: "collections",
};

/**
 * Every feature has a default container under a reserved id, so each row starts
 * empty: what the welcome adds is the second container, not the first.
 */
export function initialOnboardingDraft(): OnboardingDraft {
  return {
    settings: DEFAULT_ACCOUNT_SETTINGS,
    addressBooks: [],
    calendars: [],
    notebooks: [],
    collections: [],
  };
}

export function onboardingSteps(settings: AccountSettings): OnboardingStep[] {
  const steps: OnboardingStep[] = ["welcome", "features"];
  if (isFeatureEnabled(settings, "contacts")) {
    steps.push("contacts");
  }
  steps.push("containers", "import", "clients");
  return steps;
}

export function nextOnboardingStep(
  steps: OnboardingStep[],
  current: OnboardingStep,
): OnboardingStep | null {
  const at = steps.indexOf(current);
  return at === -1 || at === steps.length - 1 ? null : steps[at + 1]!;
}

export function previousOnboardingStep(
  steps: OnboardingStep[],
  current: OnboardingStep,
): OnboardingStep | null {
  const at = steps.indexOf(current);
  return at <= 0 ? null : steps[at - 1]!;
}

/**
 * Trims, drops blanks, and drops repeats case-insensitively, so holding an empty
 * row open or typing a name twice does not seal a duplicate container. `reserved`
 * covers the containers the account already has under a fixed id, which a second
 * object of the same name would only shadow in the list.
 */
function normalizeNames(names: string[], reserved?: string): string[] {
  const seen = new Set<string>(reserved ? [reserved.toLocaleLowerCase()] : []);
  const kept: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(trimmed);
  }
  return kept;
}

/**
 * The writes the welcome owes the vault. A disabled feature contributes nothing,
 * so a name typed before going back and turning that feature off is not created.
 */
export function onboardingPlan(draft: OnboardingDraft): OnboardingPlan {
  const { settings } = draft;
  return {
    settings,
    addressBooks: isFeatureEnabled(settings, "contacts")
      ? normalizeNames(draft.addressBooks, DEFAULT_ADDRESS_BOOK_NAME)
      : [],
    calendars: isFeatureEnabled(settings, "calendar")
      ? normalizeNames(draft.calendars, DEFAULT_CALENDAR_NAME)
      : [],
    notebooks: isFeatureEnabled(settings, "notes")
      ? normalizeNames(draft.notebooks, DEFAULT_NOTEBOOK_NAME)
      : [],
    collections: isFeatureEnabled(settings, "bookmarks")
      ? normalizeNames(draft.collections, DEFAULT_BOOKMARK_COLLECTION_NAME)
      : [],
  };
}

export function plannedContainerCount(plan: OnboardingPlan): number {
  return (
    plan.addressBooks.length +
    plan.calendars.length +
    plan.notebooks.length +
    plan.collections.length
  );
}
