import { ADDRESS_BOOK_CONTENT_TYPE, DEFAULT_ADDRESS_BOOK_ID, JSCONTACT_CONTENT_TYPE } from "./addressBook";
import { putContact } from "./addressBookApi";
import { BOOKMARK_COLLECTION_CONTENT_TYPE, BOOKMARK_CONTENT_TYPE, DEFAULT_BOOKMARK_COLLECTION_ID } from "./bookmark";
import { DEFAULT_CALENDAR_ID } from "./calendar";
import { CALENDAR_CONTENT_TYPE, CALENDAR_EVENT_CONTENT_TYPE } from "./calendarApi";
import { putSealedMany, type SealedWrite } from "./clientFlush";
import type { Session } from "./client";
import { LINKABLE_SECTIONS, profileOf } from "./contactProfile";
import { DEFAULT_NOTEBOOK_ID, NOTEBOOK_CONTENT_TYPE, NOTE_CONTENT_TYPE } from "./note";
import { DEFAULT_TASK_LIST_ID, TASK_CONTENT_TYPE, TASK_LIST_CONTENT_TYPE } from "./task";
import { findTrashItem, type TrashItem, type TrashKind, type TrashListing } from "./trash";
import type { Contact } from "./types";
import {
  coreTrashExpired,
  coreTrashPurgePlan,
  coreTrashRestorePlan,
  coreTrashRestoreWrite,
  coreTrashWrite,
} from "./wasm";

const CONTENT_TYPES: Record<TrashKind, string> = {
  address_book: ADDRESS_BOOK_CONTENT_TYPE,
  contact: JSCONTACT_CONTENT_TYPE,
  calendar: CALENDAR_CONTENT_TYPE,
  calendar_event: CALENDAR_EVENT_CONTENT_TYPE,
  note: NOTE_CONTENT_TYPE,
  notebook: NOTEBOOK_CONTENT_TYPE,
  bookmark: BOOKMARK_CONTENT_TYPE,
  bookmark_collection: BOOKMARK_COLLECTION_CONTENT_TYPE,
  task: TASK_CONTENT_TYPE,
  task_list: TASK_LIST_CONTENT_TYPE,
};

/**
 * Every client recreates a default container it cannot find, by writing over
 * its fixed id, so one in the trash would come back empty rather than restored.
 */
const DEFAULT_CONTAINER_IDS = new Set([
  DEFAULT_ADDRESS_BOOK_ID,
  DEFAULT_BOOKMARK_COLLECTION_ID,
  DEFAULT_CALENDAR_ID,
  DEFAULT_NOTEBOOK_ID,
  DEFAULT_TASK_LIST_ID,
]);

export const DEFAULT_CONTAINER_REFUSAL = "A default container cannot be deleted.";

function rawOf(entry: TrashItem): string {
  const raw = entry.item.raw;
  if (!raw) throw new Error("This item has not been saved yet.");
  return raw;
}

/**
 * Moves items to the trash, each with everything inside it. One flush; raises
 * `RefusedWrites` for any refused.
 */
export async function trashItems(
  session: Session,
  entries: TrashItem[],
  now: string = new Date().toISOString(),
): Promise<void> {
  if (entries.some((entry) => DEFAULT_CONTAINER_IDS.has(entry.item.id))) {
    throw new Error(DEFAULT_CONTAINER_REFUSAL);
  }
  await putSealedMany(
    session,
    entries.map((entry) => ({
      id: entry.item.id,
      contentType: CONTENT_TYPES[entry.kind],
      tombstone: false,
      payload: coreTrashWrite(entry.kind, rawOf(entry), now),
    })),
  );
}

/**
 * Takes one item out of the trash. One whose parent or container is still in
 * there comes back at the top level or in the default container.
 */
export async function restoreItem(session: Session, trash: TrashListing, id: string): Promise<void> {
  const entry = findTrashItem(trash, id);
  if (!entry) throw new Error("That item is no longer in the trash.");
  const rehome = coreTrashRestorePlan(trash.nodes, id);
  await putSealedMany(session, [
    {
      id,
      contentType: CONTENT_TYPES[entry.kind],
      tombstone: false,
      payload: coreTrashRestoreWrite(entry.kind, rawOf(entry), rehome),
    },
  ]);
}

/**
 * Deletes items in the trash, and everything inside them, for good. A contact
 * that goes is unlinked from the live contacts that point at it. Returns how
 * many objects were deleted.
 */
export async function purgeItems(
  session: Session,
  trash: TrashListing,
  ids: string[],
  liveContacts: Contact[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const kinds = new Map(trash.nodes.map((node) => [node.id, node.kind as TrashKind]));
  const plan = coreTrashPurgePlan(trash.nodes, ids);
  const writes: SealedWrite[] = plan.flatMap((id) => {
    const kind = kinds.get(id);
    return kind ? [{ id, contentType: CONTENT_TYPES[kind], tombstone: true, payload: "" }] : [];
  });
  await putSealedMany(session, writes);
  const gone = new Set(writes.filter((write) => kinds.get(write.id) === "contact").map((write) => write.id));
  if (gone.size > 0) await unlinkContacts(session, liveContacts, gone);
  return writes.length;
}

async function unlinkContacts(session: Session, contacts: Contact[], gone: Set<string>): Promise<void> {
  for (const contact of contacts) {
    if (gone.has(contact.id)) continue;
    const profile = profileOf(contact.profile);
    const cleaned = { ...profile };
    let changed = false;
    for (const section of LINKABLE_SECTIONS) {
      const kept = profile[section].filter((entry) => entry.contactId === undefined || !gone.has(entry.contactId));
      if (kept.length === profile[section].length) continue;
      cleaned[section] = kept;
      changed = true;
    }
    if (changed) await putContact(session, { ...contact, profile: cleaned }, contact.id);
  }
}

export const TRASH_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const sweepKey = (collectionId: string) => `sealbook.trashSweep.${collectionId}`;

/**
 * Deletes for good, at most once a day, whatever has been in the trash past
 * the retention period. Skipped offline, or while rows are unopened, since one
 * of them may sit inside something about to go. Returns how many objects were
 * deleted, or null when nothing was attempted.
 */
export async function sweepTrashIfDue(
  session: Session,
  listing: { trash: TrashListing; contacts: Contact[]; unopened: number },
  now = Date.now(),
): Promise<number | null> {
  if (session.offline || listing.unopened > 0) return null;
  const key = sweepKey(session.state.collection_id);
  let last = NaN;
  try {
    last = Number(localStorage.getItem(key));
  } catch {
    // Storage blocked: sweep anyway, since a purge of what has expired is safe to repeat.
  }
  if (Number.isFinite(last) && now - last < TRASH_SWEEP_INTERVAL_MS) return null;
  try {
    localStorage.setItem(key, String(now));
  } catch {
    // As above.
  }
  const expired = coreTrashExpired(listing.trash.nodes, now);
  return purgeItems(session, listing.trash, expired, listing.contacts);
}
