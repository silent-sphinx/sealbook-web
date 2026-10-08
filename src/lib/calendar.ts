import type { Calendar } from "./types";

// Mirrors of the Rust constants in
// `sealbook/crates/sealbook-protocol/src/lib.rs`. There is no codegen between the
// two, so the pairing is covered by a test rather than by the compiler.
export const DEFAULT_CALENDAR_NAME = "Default Calendar";
export const DEFAULT_CALENDAR_ID = "00000000-0000-0000-0000-000000000003";

export function sortCalendars(calendars: Calendar[]): Calendar[] {
  return [...calendars].sort((a, b) => {
    if (a.id === DEFAULT_CALENDAR_ID) return -1;
    if (b.id === DEFAULT_CALENDAR_ID) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
