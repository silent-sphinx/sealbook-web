import { browserTimezone } from "./timezone";
import { ONBOARDING_KEY } from "./onboarding";
import type { WeekStart } from "./calendarModel";

export const MAIN_TABS = ["contacts", "calendar", "notes", "bookmarks", "tasks", "settings"] as const;

export type MainTab = (typeof MAIN_TABS)[number];

export const LAST_TAB_KEY = "sealbook.last-tab";
export const TIMEZONE_KEY = "sealbook.timezone";
export const WEEK_START_KEY = "sealbook.week-start";
export const AUTO_LOCK_KEY = "sealbook.auto-lock-minutes";
/** Minutes of inactivity before the vault locks; 0 never locks. */
export const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 60, 240, 0] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_OPTIONS)[number];
export const DEFAULT_AUTO_LOCK_MINUTES: AutoLockMinutes = 15;
export const IDLE_BURST_THROTTLE_MS = 1000;

/** A minute's warning, or half the timeout when that is shorter. */
export function idleWarningMs(timeoutMs: number): number {
  return timeoutMs - Math.min(60 * 1000, timeoutMs / 2);
}

/** How long the warning shows before the lock, in whole seconds. */
export function idleWarningSeconds(minutes: number): number {
  const timeoutMs = minutes * 60 * 1000;
  return Math.round((timeoutMs - idleWarningMs(timeoutMs)) / 1000);
}

export function autoLockLabel(minutes: AutoLockMinutes): string {
  if (minutes === 0) return "Never";
  if (minutes < 60) return minutes === 1 ? "After 1 minute" : `After ${minutes} minutes`;
  const hours = minutes / 60;
  return hours === 1 ? "After 1 hour" : `After ${hours} hours`;
}

export function loadAutoLockMinutes(): AutoLockMinutes {
  try {
    const stored = Number(localStorage.getItem(AUTO_LOCK_KEY) ?? NaN);
    return AUTO_LOCK_OPTIONS.find((option) => option === stored) ?? DEFAULT_AUTO_LOCK_MINUTES;
  } catch {
    return DEFAULT_AUTO_LOCK_MINUTES;
  }
}

export function saveAutoLockMinutes(minutes: AutoLockMinutes): void {
  try {
    localStorage.setItem(AUTO_LOCK_KEY, String(minutes));
  } catch {
    // storage unavailable; keep the choice for this session only
  }
}

export const MIN_PASSWORD_LENGTH = 12;

// Only what a length check lets through: anything shorter is already refused.
const COMMON_PASSWORDS = new Set([
  "password1234",
  "password12345",
  "passw0rd1234",
  "123456789012",
  "1234567890123",
  "qwertyuiop12",
  "qwertyuiopas",
  "qwertyuiop123",
  "iloveyou1234",
  "letmein12345",
  "administrator",
  "changemechangeme",
  "abcdefghijkl",
]);

/**
 * Why a password is not accepted for a new account or a new password, or null.
 *
 * The password also wraps every secret this browser holds at rest, and OPAQUE
 * keeps the server from judging it, so this is the only place a floor can sit.
 * Signing in with an older, shorter password is unaffected.
 */
export function passwordProblem(value: string): string | null {
  if ([...value].length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  const lowered = value.toLowerCase();
  if (new Set(lowered).size === 1 || COMMON_PASSWORDS.has(lowered)) {
    return "That password is too easy to guess. Choose a less common one.";
  }
  return null;
}

export function passwordStrength(value: string): { score: number; label: string } {
  if (!value) return { score: 0, label: "" };
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) || /[^A-Za-z0-9]/.test(value)) score += 1;
  return { score, label: ["Weak", "Fair", "Good", "Strong"][Math.max(0, score - 1)] };
}

export function loadTimezone(): string {
  try {
    return localStorage.getItem(TIMEZONE_KEY) || browserTimezone();
  } catch {
    return browserTimezone();
  }
}

export function loadWeekStart(): WeekStart {
  try {
    return localStorage.getItem(WEEK_START_KEY) === "1" ? 1 : 0;
  } catch {
    return 0;
  }
}

export function saveWeekStart(weekStart: WeekStart): void {
  try {
    localStorage.setItem(WEEK_START_KEY, String(weekStart));
  } catch {
    // storage unavailable; keep the choice for this session only
  }
}

export function rememberBrowserTimezone(): string {
  const timezone = browserTimezone();
  try {
    const stored = localStorage.getItem(TIMEZONE_KEY);
    if (stored) return stored;
    localStorage.setItem(TIMEZONE_KEY, timezone);
  } catch {
    // storage unavailable; use the browser timezone for this session
  }
  return timezone;
}

export function loadLastTab(): MainTab {
  try {
    const stored = sessionStorage.getItem(LAST_TAB_KEY);
    const tab = MAIN_TABS.find((candidate) => candidate === stored);
    return tab && tab !== "settings" ? tab : "contacts";
  } catch {
    return "contacts";
  }
}

export function loadOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveOnboarding(pending: boolean): void {
  try {
    if (pending) {
      localStorage.setItem(ONBOARDING_KEY, "1");
    } else {
      localStorage.removeItem(ONBOARDING_KEY);
    }
  } catch {
    // storage unavailable; ignore
  }
}

export function saveLastTab(tab: MainTab): void {
  if (tab === "settings") return;
  try {
    sessionStorage.setItem(LAST_TAB_KEY, tab);
  } catch {
    // storage unavailable; ignore
  }
}
