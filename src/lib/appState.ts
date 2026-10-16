import { browserTimezone } from "./timezone";
import { ONBOARDING_KEY } from "./onboarding";

export type MainTab = "contacts" | "calendar" | "notes" | "bookmarks" | "settings";

export const LAST_TAB_KEY = "sealbook.last-tab";
export const TIMEZONE_KEY = "sealbook.timezone";
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const IDLE_WARNING_MS = IDLE_TIMEOUT_MS - 60 * 1000;
export const IDLE_BURST_THROTTLE_MS = 1000;

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
    return stored === "calendar" || stored === "notes" ? stored : "contacts";
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
