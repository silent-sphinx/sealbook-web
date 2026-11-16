import type { AccountImportObject } from "./accountExport";
import type { DeviceLabel } from "./devices";
import { bytesFromJson } from "./bytes";
import {
  coreChangesPageRead,
  coreChangesRequest,
  coreErrorMessage,
  coreErrorOf,
  coreLatestRevisions,
  coreManifestSignRoot,
  coreLocalVaultApply,
  coreOpenRow,
  corePayloadKind,
  coreRequireKeyEpoch,
  coreUnreadableRows,
  coreWalkPage,
  coreWalkStart,
  newUuid,
  sealedContentType,
  type LocalObject,
  type LocalVault,
  type RowOutcome,
} from "./wasm";
import { emptyVault } from "./localStore";
import { localObjects, openOutbox, setVault } from "./outbox";
import type { WalkCursor, WalkOutcome, WalkStep } from "../pkg/sealbook_wasm.js";
import {
  ACCOUNT_SETTINGS_ID,
  DEFAULT_ACCOUNT_SETTINGS,
  parseAccountSettings,
} from "./accountSettings";
import {
  parseAddressBook,
  sortAddressBooks,
} from "./addressBook";
import { parseCalendar, parseEvent, serializeEvent, sortCalendars } from "./calendar";
import { CALENDAR_EVENT_CONTENT_TYPE } from "./calendarApi";
import {
  parseBookmark,
  parseBookmarkCollection,
  sortBookmarks,
  sortCollections,
} from "./bookmark";
import {
  parseTask,
  parseTaskList,
  sortTaskLists,
  sortTasks,
} from "./task";
import {
  parseNote,
  parseNotebook,
  sortNotebooks,
  sortNotes,
} from "./note";
import { CONTACT_ATTACHMENTS_PROP, parseContact, sortContacts } from "./contact";
import { describeError, log, elapsed } from "./log";
import { importBatches } from "./vaultImport";
import { apiRoot, failedStatus, getText, putJson } from "./transport";
import {
  alignKeyEpoch,
  applyWrite,
  entryFor,
  manifestBucketState,
  manifestContext,
  manifestState,
  rememberManifestSeq,
  requireManifestAbsenceOk,
  sealPayload,
  serializeVault,
  verifyManifest,
  type Session,
} from "./clientCore";
import { refreshCollectionKey } from "./clientCore";
import type {
  AccountSettings,
  AddressBook,
  Bookmark,
  BookmarkCollection,
  Calendar,
  CalendarEvent,
  Contact,
  ManifestBody,
  Note,
  Notebook,
  SealedObject,
  Task,
  TaskList,
} from "./types";

/**
 * Signs the manifest for the state a write produces.
 *
 * The root comes from `applyWrite`, so the signature covers the same value a
 * signature over every entry in the collection would.
 */
export function signNextManifest(
  session: Session,
  manifestSeq: number,
  keyEpoch: number,
  latestRevision: number,
  objectCount: number,
  root: string,
): ManifestBody {
  const signed = coreManifestSignRoot(
    bytesFromJson(session.state.mldsa_seed),
    bytesFromJson(session.state.ed25519_sk),
    manifestContext(session),
    { manifest_seq: manifestSeq, key_epoch: keyEpoch, latest_revision: latestRevision },
    { object_count: objectCount, root },
  );
  return JSON.parse(signed.manifest_json) as ManifestBody;
}

const MAX_CALENDAR_EVENT_BATCH = 256;

/** Writes calendar events in atomic batches so large imports do not hit request limits. */
export async function putCalendarEvents(
  session: Session,
  events: Omit<CalendarEvent, "id">[],
): Promise<string[]> {
  const ids = events.map(() => newUuid());
  for (let offset = 0; offset < events.length; offset += MAX_CALENDAR_EVENT_BATCH) {
    const batch = events.slice(offset, offset + MAX_CALENDAR_EVENT_BATCH);
    const batchIds = ids.slice(offset, offset + MAX_CALENDAR_EVENT_BATCH);
    await serializeVault(session.state.collection_id, async () => {
      // Only the buckets this batch writes into, for the reason `putSealed`
      // gives: reading every entry per batch made an import of n objects cost
      // bytes proportional to n squared.
      const state = await manifestBucketState(session, batchIds);
      const { manifest_seq: seq, key_epoch: keyEpoch, latest_revision: latestRevision } =
        state.plan;
      await alignKeyEpoch(session, keyEpoch);
      const writes = batch.map((event, index) => {
        const revision = latestRevision + index + 1;
        const sealed = sealPayload(
          session,
          batchIds[index],
          CALENDAR_EVENT_CONTENT_TYPE,
          serializeEvent(event),
          revision,
        );
        return { id: batchIds[index], revision, sealed };
      });
      const { objectCount, root } = applyWrite(
        state,
        writes.map((write) =>
          entryFor({
            id: write.id,
            revision: write.revision,
            tombstone: false,
            nonce: write.sealed.encrypted.nonce,
            ciphertext: write.sealed.encrypted.ciphertext,
          }),
        ),
      );
      const manifest = signNextManifest(
        session,
        seq + 1,
        keyEpoch,
        latestRevision + writes.length,
        objectCount,
        root,
      );
      const response = await putJson<{ latest_revision: number }>(
        `${apiRoot(session.state.server)}/v1/collections/${session.state.collection_id}/objects/batch`,
        {
          objects: writes.map((write) => ({
            id: write.id,
            revision: write.revision,
            nonce: write.sealed.encrypted.nonce,
            ciphertext: write.sealed.encrypted.ciphertext,
            padded_size: write.sealed.encrypted.padded_size,
            content_type: sealedContentType(),
            tombstone: false,
          })),
          manifest,
        },
        session.token,
      );
      session.latestRevision = response.latest_revision;
      rememberManifestSeq(session, seq + 1);
    });
  }
  return ids;
}

export type VaultListing = {
  addressBooks: AddressBook[];
  contacts: Contact[];
  calendars: Calendar[];
  calendarEvents: CalendarEvent[];
  notes: Note[];
  notebooks: Notebook[];
  bookmarks: Bookmark[];
  bookmarkCollections: BookmarkCollection[];
  tasks: Task[];
  taskLists: TaskList[];
  accountSettings: AccountSettings;
  /**
   * The settings payload as stored, so a save merges onto it rather than
   * replacing it with only the fields this build knows.
   */
  accountSettingsRaw?: string;
  /**
   * The id they were read from, absent when the account has no settings. Only
   * `LEGACY_ACCOUNT_SETTINGS_ID` needs acting on: see `ensureDefaultCalendar`.
   */
  accountSettingsId?: string;
  /** Every device label object, for joining onto the roster. */
  deviceLabels: DeviceLabel[];
  /**
   * Rows the manifest verified but this device could not open, so a partly
   * unreadable vault is not presented as a partly empty one. A non-zero count
   * also means the snapshot must not be overwritten with this listing.
   */
  unopened: number;
  /**
   * Rows this device opened but could not fully read: a payload that would not
   * parse, or a note or contact carrying more attachment entries than core could
   * read. Not an `unopened` row, since the listing is still faithful to what it
   * shows, but whatever those entries pointed at looks unreferenced, so an
   * attachment sweep must not run while there are any.
   */
  unreadReferences: number;
};

/**
 * How many of a payload's attachment entries the parser dropped, from the stored
 * array's length against what was read. `key` is where the entries live.
 */
function droppedAttachmentEntries(raw: string, key: string, readCount: number): number {
  try {
    const stored = (JSON.parse(raw) as Record<string, unknown>)[key];
    return Array.isArray(stored) ? Math.max(0, stored.length - readCount) : 0;
  } catch {
    return 0;
  }
}

/**
 * The stage a vault read has reached. Reported so the first read of a session,
 * which is long enough to look like an empty vault, can say which part of the
 * work is taking the time. `count` is the number of objects on the
 * `decrypting` stage.
 */
export type VaultProgress = {
  stage: "downloading" | "verifying" | "decrypting";
  count?: number;
};

export function listVault(
  session: Session,
  onProgress?: (progress: VaultProgress) => void,
): Promise<VaultListing> {
  return serializeVault(session.state.collection_id, () => listVaultInner(session, onProgress));
}

/** As `listVault`, or this device's copy when the server cannot be reached. */
export async function listVaultOrLocal(session: Session): Promise<VaultListing> {
  if (!session.offline) {
    try {
      return await listVault(session);
    } catch (err) {
      if (failedStatus(err) !== 0) throw err;
    }
  }
  await openOutbox(session.state.collection_id);
  return listingFrom(localObjects(), 0);
}

export type ChangesWalk = {
  /** The newest revision of each object, in the order the pages served them. */
  objects: SealedObject[];
  keyEpoch: number;
  latestRevision: number;
  /**
   * The manifest to check the objects against, verbatim as it was served.
   * Absent for a collection no manifest-writing client has written, where
   * `requireManifestAbsenceOk` is the rule instead.
   */
  manifestJson?: string;
  tombstoneFloor: number;
  /** The rows are the whole collection, not just what changed after `after`. */
  full: boolean;
};

/**
 * Walks `/changes` to its end and keeps the newest revision of each object.
 *
 * A page carries at most the server's `MAX_CHANGES_LIMIT` rows, so everything
 * that needs the whole collection pages through it, rotation included: the
 * manifest commits to the collection rather than to any one page of it, and the
 * callers check their assembled set against it.
 *
 * Every rule the walk follows is core's: what to ask for, when the cursor
 * advances, when a page means the walk has to start over, and when it is
 * complete. This moves the bytes and keeps the rows.
 */
export async function walkChanges(session: Session, after = 0): Promise<ChangesWalk> {
  const { state, token } = session;
  const started = performance.now();
  let pages = 0;
  let cursor = coreWalkStart(after);
  let rows: SealedObject[] = [];
  let walk: WalkOutcome | undefined;
  while (!walk) {
    const request = coreChangesRequest(state.collection_id, cursor);
    const body = await getText(`${apiRoot(state.server)}${request.path}`, token);
    const page = JSON.parse(body) as { objects: SealedObject[] };
    pages += 1;
    const step = walkPage(cursor, body);
    if ("Next" in step) {
      rows.push(...page.objects);
      cursor = step.Next.cursor;
    } else if ("Restart" in step) {
      // The rows read so far and the manifest that would check them describe
      // different states, so they go rather than being reported as tampering.
      log.debug("restarting the walk", { pages, after: step.Restart.cursor.after });
      rows = [];
      cursor = step.Restart.cursor;
    } else {
      rows.push(...page.objects);
      walk = step.Done.walk;
    }
  }

  const keep = coreLatestRevisions(rows.map((row) => ({ id: row.id, revision: row.revision })));
  const objects = keep.map((index) => rows[index]);
  log.debug("walked the change log", {
    pages,
    rows: rows.length,
    objects: objects.length,
    key_epoch: walk.key_epoch,
    snapshot: cursor.snapshot,
    ms: elapsed(started),
  });
  return {
    objects,
    keyEpoch: walk.key_epoch,
    latestRevision: walk.latest_revision,
    manifestJson: walk.manifest_json,
    tombstoneFloor: walk.tombstone_floor,
    full: walk.full,
  };
}

/**
 * What core says to do with a page, with its refusal turned into a sentence.
 *
 * Deliberately not a `ManifestError`: a write between two pages is a race, and
 * reporting it as tampering is both wrong and unactionable.
 */
function walkPage(cursor: WalkCursor, body: string): WalkStep {
  try {
    return coreWalkPage(cursor, coreChangesPageRead(body));
  } catch (err) {
    const core = coreErrorOf(err);
    if (core?.kind === "CollectionBusy") {
      throw new Error(coreErrorMessage(JSON.stringify(core)) ?? core.kind);
    }
    throw new Error(core && "detail" in core ? core.detail : describeError(err));
  }
}

type OpenedVaultObject = {
  object: SealedObject;
  /**
   * Authenticated by the AEAD, so this is the type to dispatch on rather than
   * the label the server served.
   */
  contentType: string;
  payload: string;
};

type OpenedVault = {
  opened: OpenedVaultObject[];
  unopened: number;
  /** Every row this device could open, tombstones included. */
  vault: LocalVault;
};

/** A served row as the vault copy holds it, or null when it will not open. */
export function localObjectOf(
  collectionKey: string,
  collectionId: string,
  row: SealedObject,
): LocalObject | null {
  return localObjectFrom(row, coreOpenRow(collectionKey, collectionId, row));
}

/**
 * Every row of a full read as the vault copy holds it, null where it will not
 * open, with the count of those.
 *
 * Throws `WrongCollectionKey` when the key opened none of them: a key the
 * server sealed to this device would otherwise read as an emptied vault.
 */
export function localObjectsOfFullRead(
  collectionKey: string,
  collectionId: string,
  rows: SealedObject[],
): { objects: (LocalObject | null)[]; unopened: number } {
  const outcomes = rows.map((row) => coreOpenRow(collectionKey, collectionId, row));
  const unopened = coreUnreadableRows(outcomes);
  return { objects: rows.map((row, at) => localObjectFrom(row, outcomes[at])), unopened };
}

function localObjectFrom(row: SealedObject, result: RowOutcome): LocalObject | null {
  if (result === "Deleted") {
    return { id: row.id, content_type: "", revision: row.revision, tombstone: true, payload: "" };
  }
  if ("Unreadable" in result) return null;
  return {
    id: row.id,
    content_type: result.Object.content_type,
    revision: row.revision,
    tombstone: false,
    payload: result.Object.payload,
  };
}

/**
 * The whole collection, verified against the manifest and decrypted, with
 * tombstones dropped.
 *
 * Shared by the typed listing and by a full export, which need the same walk,
 * the same manifest check and the same key alignment but disagree about what to
 * do with a content type this build does not know: the listing skips it, the
 * export carries it.
 */
async function openVault(
  session: Session,
  onProgress?: (progress: VaultProgress) => void,
): Promise<OpenedVault> {
  const { state } = session;
  onProgress?.({ stage: "downloading" });
  const walk = await walkChanges(session);
  session.latestRevision = walk.latestRevision;
  // If another device revoked someone, the key was rotated and everything was
  // re-encrypted. Pick up the new key before decrypting, otherwise every object
  // would fail to open and the vault would look empty.
  if (walk.keyEpoch !== session.keyEpoch) {
    coreRequireKeyEpoch(walk.keyEpoch, await refreshCollectionKey(session));
  }
  const { collectionKey } = session;
  const opened: OpenedVaultObject[] = [];
  // Check what was served against what a device signed for, before decrypting any
  // of it. A failure here means an object was withheld, rolled back or
  // substituted, and must not be presented as an empty or partial vault.
  if (walk.manifestJson) {
    onProgress?.({ stage: "verifying" });
    await verifyManifest(session, walk.manifestJson, walk.objects.map(entryFor));
  } else {
    requireManifestAbsenceOk(session);
  }
  if (onProgress && walk.objects.length > 0) {
    onProgress({ stage: "decrypting", count: walk.objects.length });
    // `coreOpenRow` is synchronous and holds the main thread for the whole loop
    // below, so the stage above would otherwise never be painted. Yielding to
    // the event loop rather than to a microtask is what lets that paint land.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const read = localObjectsOfFullRead(collectionKey, state.collection_id, walk.objects);
  const unopened = read.unopened;
  const rows: LocalObject[] = [];
  for (const [at, obj] of walk.objects.entries()) {
    const row = read.objects[at];
    if (!row) continue;
    rows.push(row);
    if (row.tombstone) continue;
    opened.push({ object: obj, contentType: row.content_type, payload: row.payload });
  }
  if (unopened > 0) {
    // The manifest verified, so these rows are genuine and the failure is local:
    // a key epoch this device cannot reach, or a payload a newer build wrote.
    log.warn("some vault objects could not be opened on this device", {
      unopened,
      objects: walk.objects.length,
      key_epoch: session.keyEpoch,
    });
  }
  const vault = coreLocalVaultApply(emptyVault(), rows, walk.latestRevision, walk.keyEpoch);
  return { opened, unopened, vault };
}

export type VaultExport = {
  objects: { id: string; contentType: string; payload: string }[];
  unreadable: number;
};

/**
 * Every object in the vault as stored, for a full account export.
 *
 * Deliberately not built from a `VaultListing`: that drops the content types
 * this build does not parse, and an export of an account has to carry an object
 * a newer client wrote rather than quietly leaving it out of the backup.
 */
export function exportVault(session: Session): Promise<VaultExport> {
  return serializeVault(session.state.collection_id, async () => {
    const { opened, unopened } = await openVault(session);
    return {
      objects: opened.map(({ object, contentType, payload }) => ({
        id: object.id,
        contentType,
        payload,
      })),
      unreadable: unopened,
    };
  });
}

export type VaultImportResult = {
  imported: number;
  skipped: number;
};

/**
 * Writes the objects of an account export back into the vault.
 *
 * The counterpart of `exportVault`. Ids come from the file rather than being
 * minted, so an import into the account the file came from restores it instead
 * of duplicating it, and one into an empty account is the migration path. An
 * object whose id is already live is left alone unless `overwrite` says
 * otherwise: that id is someone's current object, and replacing it loses what is
 * there.
 *
 * Sent in batches bounded by both `MAX_IMPORT_BATCH` and `MAX_IMPORT_BYTES`,
 * each its own request and manifest signature. A batch that fails leaves the
 * batches before it written; a rerun is harmless because the ids are fixed.
 */
export async function importVault(
  session: Session,
  objects: AccountImportObject[],
  { overwrite = false }: { overwrite?: boolean } = {},
): Promise<VaultImportResult> {
  // The manifest names every id and says which are tombstones, so the live set
  // comes back without decrypting the vault.
  const live = new Set(
    (await manifestState(session)).entries
      .filter((entry) => !entry.tombstone)
      .map((entry) => entry.id),
  );
  const writes = overwrite ? objects : objects.filter((object) => !live.has(object.id));
  const skipped = objects.length - writes.length;

  for (const batch of importBatches(writes)) {
    await serializeVault(session.state.collection_id, async () => {
      const state = await manifestBucketState(
        session,
        batch.map((object) => object.id),
      );
      const { manifest_seq: seq, key_epoch: keyEpoch, latest_revision: latestRevision } =
        state.plan;
      await alignKeyEpoch(session, keyEpoch);
      const sealed = batch.map((object, index) => {
        const revision = latestRevision + index + 1;
        return {
          id: object.id,
          revision,
          // Payload and content type go back as the file holds them, including a
          // content type this build has no parser for.
          sealed: sealPayload(session, object.id, object.contentType, object.payload, revision),
        };
      });
      const newEntries = sealed.map((write) =>
        entryFor({
          id: write.id,
          revision: write.revision,
          tombstone: false,
          nonce: write.sealed.encrypted.nonce,
          ciphertext: write.sealed.encrypted.ciphertext,
        }),
      );
      const { objectCount, root } = applyWrite(state, newEntries);
      const manifest = signNextManifest(
        session,
        seq + 1,
        keyEpoch,
        latestRevision + sealed.length,
        objectCount,
        root,
      );
      const response = await putJson<{ latest_revision: number }>(
        `${apiRoot(session.state.server)}/v1/collections/${session.state.collection_id}/objects/batch`,
        {
          objects: sealed.map((write) => ({
            id: write.id,
            revision: write.revision,
            nonce: write.sealed.encrypted.nonce,
            ciphertext: write.sealed.encrypted.ciphertext,
            padded_size: write.sealed.encrypted.padded_size,
            content_type: sealedContentType(),
            tombstone: false,
          })),
          manifest,
        },
        session.token,
      );
      session.latestRevision = response.latest_revision;
      rememberManifestSeq(session, seq + 1);
    });
  }

  return { imported: writes.length, skipped };
}

async function listVaultInner(
  session: Session,
  onProgress?: (progress: VaultProgress) => void,
): Promise<VaultListing> {
  await openOutbox(session.state.collection_id);
  const { unopened, vault } = await openVault(session, onProgress);
  await setVault(vault, unopened === 0);
  return listingFrom(localObjects(), unopened);
}

/** The typed listing of the objects this device holds. */
export function listingFrom(objects: LocalObject[], unopened: number): VaultListing {
  const addressBooks: AddressBook[] = [];
  const contacts: Contact[] = [];
  const calendarEvents: CalendarEvent[] = [];
  const calendars: Calendar[] = [];
  const notes: Note[] = [];
  const notebooks: Notebook[] = [];
  const bookmarks: Bookmark[] = [];
  const bookmarkCollections: BookmarkCollection[] = [];
  const tasks: Task[] = [];
  const taskLists: TaskList[] = [];
  // Default until the settings object turns up: an account that has never saved
  // one has every feature enabled.
  let accountSettings = DEFAULT_ACCOUNT_SETTINGS;
  let accountSettingsRaw: string | undefined;
  let accountSettingsId: string | undefined;
  const deviceLabels: DeviceLabel[] = [];
  let unreadReferences = 0;
  for (const { id, content_type: contentType, payload: raw } of objects) {
    const obj = { id };
    try {
      switch (corePayloadKind(contentType ?? "", raw)) {
        case "calendar_event":
          calendarEvents.push(parseEvent(obj.id, raw));
          break;
        case "calendar":
          calendars.push(parseCalendar(obj.id, raw));
          break;
        case "address_book":
          addressBooks.push(parseAddressBook(obj.id, raw));
          break;
        case "note": {
          const note = parseNote(obj.id, raw);
          unreadReferences += droppedAttachmentEntries(raw, "attachments", note.attachments?.length ?? 0);
          notes.push(note);
          break;
        }
        case "notebook":
          notebooks.push(parseNotebook(obj.id, raw));
          break;
        case "bookmark":
          bookmarks.push(parseBookmark(obj.id, raw));
          break;
        case "bookmark_collection":
          bookmarkCollections.push(parseBookmarkCollection(obj.id, raw));
          break;
        case "task":
          tasks.push(parseTask(obj.id, raw));
          break;
        case "task_list":
          taskLists.push(parseTaskList(obj.id, raw));
          break;
        case "account_settings":
          // Two objects can answer to this shape until a legacy account's copy
          // at the calendar's id is migrated, so the canonical id wins rather
          // than whichever the server returned last.
          if (obj.id === ACCOUNT_SETTINGS_ID || accountSettingsId !== ACCOUNT_SETTINGS_ID) {
            accountSettings = parseAccountSettings(raw);
            accountSettingsRaw = raw;
            accountSettingsId = obj.id;
          }
          break;
        case "contact": {
          const contact = parseContact(obj.id, raw, "", 0);
          unreadReferences += droppedAttachmentEntries(
            raw,
            CONTACT_ATTACHMENTS_PROP,
            contact.attachments?.length ?? 0,
          );
          contacts.push(contact);
          break;
        }
        case "device_label":
          deviceLabels.push({ object_id: obj.id, payload: raw });
          break;
        default:
          // Not a shape this build knows. Skipping it is the only safe answer: a
          // newer content type read as a contact would be destroyed by its edit
          // or delete.
          break;
      }
    } catch {
      // Left out of the listing as an unknown shape is, but unlike one it was a
      // shape this build knows, so what it referenced is not known to be unused.
      unreadReferences += 1;
    }
  }
  log.info("vault opened", {
    contacts: contacts.length,
    address_books: addressBooks.length,
    events: calendarEvents.length,
    calendars: calendars.length,
    notes: notes.length,
    notebooks: notebooks.length,
    bookmarks: bookmarks.length,
    bookmark_collections: bookmarkCollections.length,
    tasks: tasks.length,
    task_lists: taskLists.length,
    unopened,
    unread_references: unreadReferences,
  });
  return {
    addressBooks: sortAddressBooks(addressBooks),
    contacts: sortContacts(contacts),
    calendars: sortCalendars(calendars),
    calendarEvents,
    notes: sortNotes(notes),
    notebooks: sortNotebooks(notebooks),
    bookmarks: sortBookmarks(bookmarks),
    bookmarkCollections: sortCollections(bookmarkCollections),
    tasks: sortTasks(tasks),
    taskLists: sortTaskLists(taskLists),
    accountSettings,
    accountSettingsRaw,
    accountSettingsId,
    deviceLabels,
    unopened,
    unreadReferences,
  };
}
