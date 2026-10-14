import { mergePayload, PAYLOAD_SCHEMA_VERSION } from "./payload";
import { DEFAULT_CALENDAR_COLOR } from "./types";
import type { Calendar } from "./types";

// Mirrors of the Rust constants in
// `sealbook/crates/sealbook-protocol/src/lib.rs`. There is no codegen between the
// two, so the pairing is covered by a test rather than by the compiler.
export const DEFAULT_CALENDAR_NAME = "Default Calendar";
export const DEFAULT_CALENDAR_ID = "00000000-0000-0000-0000-000000000003";

/** Every key this build writes for a calendar. See `mergePayload`. */
const CALENDAR_KEYS = ["@type", "version", "name", "color", "favorite", "archived"] as const;

/**
 * The wire form of a calendar.
 *
 * This is the plaintext inside the sealed envelope, so it is shared with every
 * other client and is not ours to change unilaterally. `archived` is written
 * only when set, so a calendar that has never been archived is byte-identical
 * to one from a build predating the field; it is an owned key, so omitting it
 * is also what clears a stored flag.
 */
export function serializeCalendar(calendar: Omit<Calendar, "id">): string {
  const { raw, archived, ...fields } = calendar;
  return mergePayload(
    raw,
    {
      "@type": "Calendar",
      version: PAYLOAD_SCHEMA_VERSION,
      ...fields,
      name: calendar.name.trim(),
      ...(archived ? { archived: true } : {}),
    },
    CALENDAR_KEYS,
  );
}

export function parseCalendar(id: string, raw: string): Calendar {
  try {
    const body = JSON.parse(raw) as { name?: string; color?: string; favorite?: boolean; archived?: boolean };
    return {
      id,
      name: body.name?.trim() || "Untitled calendar",
      color: body.color || DEFAULT_CALENDAR_COLOR,
      favorite: body.favorite === true,
      archived: body.archived === true,
      raw,
    };
  } catch {
    return { id, name: "Untitled calendar", color: DEFAULT_CALENDAR_COLOR, raw };
  }
}

export function sortCalendars(calendars: Calendar[]): Calendar[] {
  return [...calendars].sort((a, b) => {
    if (a.id === DEFAULT_CALENDAR_ID) return -1;
    if (b.id === DEFAULT_CALENDAR_ID) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** The calendars in play: an archived one is out of the list and the pickers. */
export function activeCalendars(calendars: Calendar[]): Calendar[] {
  return calendars.filter((calendar) => calendar.archived !== true);
}

export function archivedCalendars(calendars: Calendar[]): Calendar[] {
  return calendars.filter((calendar) => calendar.archived === true);
}

/**
 * Whether a calendar is drawn on the grid.
 *
 * The two sets are each the exception to their group's default, which is what
 * lets one toggle serve both: a calendar in play shows unless it is in
 * `hidden`, and an archived one hides unless it is in `shownArchived`. So an
 * archived calendar can be switched on for a look without being restored.
 */
export function isCalendarVisible(
  calendar: Calendar,
  hidden: ReadonlySet<string>,
  shownArchived: ReadonlySet<string>,
): boolean {
  return calendar.archived === true ? shownArchived.has(calendar.id) : !hidden.has(calendar.id);
}

/** The ids [isCalendarVisible] holds for, as the event filters want them. */
export function visibleCalendarIds(
  calendars: Calendar[],
  hidden: ReadonlySet<string>,
  shownArchived: ReadonlySet<string>,
): Set<string> {
  return new Set(
    calendars.filter((calendar) => isCalendarVisible(calendar, hidden, shownArchived)).map((calendar) => calendar.id),
  );
}
