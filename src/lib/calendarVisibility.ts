export const HIDDEN_CALENDARS = "hidden-calendars";
export const SHOWN_ARCHIVED_CALENDARS = "shown-archived-calendars";

function calendarIdsStorageKey(collectionId: string, group: string): string {
  return `sealbook.${group}.${collectionId}`;
}

/**
 * localStorage rather than sessionStorage, as `addressBook.ts` holds its own
 * hidden ids: the choice is meant to survive a reload and a new tab.
 */
export function loadCalendarIds(collectionId: string, group: string): Set<string> {
  try {
    const stored = localStorage.getItem(calendarIdsStorageKey(collectionId, group));
    const ids = stored ? JSON.parse(stored) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function storeCalendarIds(collectionId: string, group: string, ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(calendarIdsStorageKey(collectionId, group), JSON.stringify([...ids]));
  } catch {
    // Storage unavailable; the choice then lasts for this session only.
  }
}

export const TASKS_OVERLAY = "tasks-overlay";

export function loadCalendarFlag(collectionId: string, group: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(calendarIdsStorageKey(collectionId, group));
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

export function storeCalendarFlag(collectionId: string, group: string, value: boolean): void {
  try {
    localStorage.setItem(calendarIdsStorageKey(collectionId, group), value ? "1" : "0");
  } catch {
    // Storage unavailable; the choice then lasts for this session only.
  }
}
