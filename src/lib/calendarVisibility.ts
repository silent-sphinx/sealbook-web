export const HIDDEN_CALENDARS = "hidden-calendars";
export const SHOWN_ARCHIVED_CALENDARS = "shown-archived-calendars";

function calendarIdsStorageKey(collectionId: string, group: string): string {
  return `sealbook.${group}.${collectionId}`;
}

export function loadCalendarIds(collectionId: string, group: string): Set<string> {
  try {
    const stored = sessionStorage.getItem(calendarIdsStorageKey(collectionId, group));
    const ids = stored ? JSON.parse(stored) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function storeCalendarIds(collectionId: string, group: string, ids: ReadonlySet<string>): void {
  try {
    sessionStorage.setItem(calendarIdsStorageKey(collectionId, group), JSON.stringify([...ids]));
  } catch {
  }
}