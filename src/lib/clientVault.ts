import type { AccountImportObject } from "./accountExport";
import { bytesFromJson } from "./bytes";
import { manifestSignRoot, newUuid, openObject, sealedContentType } from "./wasm";
import {
  ACCOUNT_SETTINGS_CONTENT_TYPE,
  ACCOUNT_SETTINGS_ID,
  DEFAULT_ACCOUNT_SETTINGS,
  parseAccountSettings,
  serializeAccountSettings,
} from "./accountSettings";
import {
  ADDRESS_BOOK_CONTENT_TYPE,
  parseAddressBook,
  sortAddressBooks,
} from "./addressBook";
import { parseCalendar, sortCalendars } from "./calendar";
import { CALENDAR_CONTENT_TYPE, CALENDAR_EVENT_CONTENT_TYPE } from "./calendarApi";
import {
  BOOKMARK_COLLECTION_CONTENT_TYPE,
  BOOKMARK_CONTENT_TYPE,
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
  TASK_CONTENT_TYPE,
  TASK_LIST_CONTENT_TYPE,
} from "./task";
import {
  NOTEBOOK_CONTENT_TYPE,
  NOTE_CONTENT_TYPE,
  parseNote,
  parseNotebook,
  sortNotebooks,
  sortNotes,
} from "./note";
import { parseContact, sortContacts } from "./contact";
import { log, elapsed } from "./log";
import { mergePayload, PAYLOAD_SCHEMA_VERSION } from "./payload";
import { importBatches } from "./vaultImport";
import { ManifestError } from "./roster";
import {
  isAddressBookPayload,
  isCalendarEventPayload,
  isCalendarPayload,
  isContactPayload,
  isPayloadOfType,
} from "./payloadGuards";
import { apiRoot, getJson, putJson } from "./transport";
import {
  alignKeyEpoch,
  entryFor,
  manifestBucketState,
  manifestState,
  rememberManifestSeq,
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

/** Most objects to ask for per `/changes` page; the server clamps above this. */
const CHANGES_PAGE_LIMIT = 500;

/**
 * How many times a full read restarts when the vault moves during it.
 *
 * Not a `ManifestError` when it runs out: a write between two pages is a race,
 * and reporting it as tampering is both wrong and unactionable.
 */
const MAX_SYNC_RESTARTS = 3;

export async function putSealed(
  session: Session,
  id: string,
  contentType: string,
  tombstone: boolean,
  payload: string,
): Promise<number> {
  const attempt = async (): Promise<number> => {
    // Only the bucket this object falls in is read. Reading every entry per
    // write is what made autosave in a large vault re-download the collection
    // on each keystroke pause.
    const state = await manifestBucketState(session, [id]);
    const { seq, keyEpoch, latestRevision } = state;
    await alignKeyEpoch(session, keyEpoch);
    const revision = latestRevision + 1;
    const sealed = sealPayload(session, id, contentType, payload, revision);
    const newEntry = entryFor({
      id,
      revision,
      nonce: sealed.encrypted.nonce,
      ciphertext: sealed.encrypted.ciphertext,
      tombstone,
    });
    const { objectCount, root } = state.apply([newEntry]);
    const manifest = manifestSignRoot(
      bytesFromJson(session.state.mldsa_seed),
      bytesFromJson(session.state.ed25519_sk),
      session.state.collection_id,
      session.state.device_id,
      seq + 1,
      keyEpoch,
      revision,
      objectCount,
      root,
    );
    const response = await putJson<{ revision: number }>(
      `${apiRoot(session.state.server)}/v1/collections/${session.state.collection_id}/objects`,
      {
        id,
        revision,
        nonce: sealed.encrypted.nonce,
        ciphertext: sealed.encrypted.ciphertext,
        padded_size: sealed.encrypted.padded_size,
        content_type: sealedContentType(),
        tombstone,
        manifest,
      },
      session.token,
    );
    session.latestRevision = response.revision;
    rememberManifestSeq(session, seq + 1);
    return response.revision;
  };

  return serializeVault(session.state.collection_id, async () => {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof Error && /stale (revision|manifest)/iu.test(error.message)) {
        return attempt();
      }
      throw error;
    }
  });
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
      const { seq, keyEpoch, latestRevision } = state;
      await alignKeyEpoch(session, keyEpoch);
      const writes = batch.map((event, index) => {
        const { raw, ...fields } = event;
        const revision = latestRevision + index + 1;
        const sealed = sealPayload(
          session,
          batchIds[index],
          CALENDAR_EVENT_CONTENT_TYPE,
          mergePayload(raw, { "@type": "CalendarEvent", version: PAYLOAD_SCHEMA_VERSION, ...fields }, [
            "@type", "version", "title", "start", "end", "notes", "location",
            "participants", "timezone", "calendarId", "recurrence",
          ]),
          revision,
        );
        return { id: batchIds[index], revision, sealed };
      });
      const { objectCount, root } = state.apply(
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
      const manifest = manifestSignRoot(
        bytesFromJson(session.state.mldsa_seed),
        bytesFromJson(session.state.ed25519_sk),
        session.state.collection_id,
        session.state.device_id,
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
  sealed: SealedObject[];
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
  /**
   * Rows the manifest verified but this device could not open, so a partly
   * unreadable vault is not presented as a partly empty one. A non-zero count
   * also means the snapshot must not be overwritten with this listing.
   */
  unopened: number;
};

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

export type ChangesWalk = {
  /** The newest revision of each object, in the order the pages served them. */
  objects: SealedObject[];
  keyEpoch: number;
  latestRevision: number;
  manifest: ManifestBody | null;
  tombstoneFloor: number;
};

/**
 * Walks `/changes` to its end and keeps the newest revision of each object.
 *
 * A page carries at most the server's `MAX_CHANGES_LIMIT` rows, so everything
 * that needs the whole collection pages through it, rotation included: the
 * manifest commits to the collection rather than to any one page of it, and the
 * callers check their assembled set against it.
 */
export async function walkChanges(session: Session): Promise<ChangesWalk> {
  const { state, token } = session;
  const started = performance.now();
  let pages = 0;
  let after = 0;
  let keyEpoch = session.keyEpoch;
  let latestRevision = session.latestRevision;
  let manifest: ManifestBody | null = null;
  let tombstoneFloor = 0;
  let pageObjects: SealedObject[] = [];
  // Superseded revisions are pruned after a retention window, so a walk can name
  // a watermark whose successors no longer exist. The server answers `resync`
  // rather than serving the remaining tail, which would silently skip the writes
  // in between. A snapshot walk pages through live objects instead of the log, so
  // it needs nothing retained; once is enough, and a second `resync` would mean
  // the server is answering something other than what was asked.
  let snapshot = false;
  let restarted = false;
  // Pages come from separate transactions, so a write landing between two of
  // them leaves the accumulated set and the final manifest describing different
  // states. The digest then disagrees and `verifyManifest` reports a withheld or
  // substituted object, which is the loudest thing this app says and is wrong
  // here. Every page carries the current manifest, so a walk that sees the
  // sequence move restarts instead, bounded so a vault being written to
  // continuously fails plainly rather than looping.
  let expectedSeq: number | null | undefined;
  let moved = 0;
  for (;;) {
    const page = await getJson<{
      latest_revision: number;
      key_epoch: number;
      objects: SealedObject[];
      has_more: boolean;
      manifest: ManifestBody | null;
      resync?: boolean;
      tombstone_floor?: number;
    }>(
      `${apiRoot(state.server)}/v1/collections/${state.collection_id}/changes?after=${after}` +
        `&limit=${CHANGES_PAGE_LIMIT}${snapshot ? "&snapshot=true" : ""}`,
      token,
    );
    pages += 1;
    if (page.resync && !snapshot) {
      if (restarted) {
        log.error("the server asked for a second resync in one walk", { pages });
        throw new Error("The server keeps asking this device to restart its sync.");
      }
      log.warn("the revision log no longer reaches this device; reading a snapshot instead");
      restarted = true;
      snapshot = true;
      after = 0;
      pageObjects = [];
      expectedSeq = undefined;
      continue;
    }
    const pageSeq = page.manifest ? page.manifest.manifest_seq : null;
    if (expectedSeq === undefined) {
      expectedSeq = pageSeq;
    } else if (pageSeq !== expectedSeq) {
      if (moved >= MAX_SYNC_RESTARTS) {
        log.warn("the vault was written to on every attempt to read it", {
          attempts: moved,
          pages,
        });
        throw new Error(
          "The vault kept changing while it was being read. Another device may be writing to it; try again.",
        );
      }
      moved += 1;
      log.debug("vault changed mid-read, restarting the walk", { attempt: moved, pages });
      expectedSeq = undefined;
      after = 0;
      pageObjects = [];
      continue;
    }
    keyEpoch = page.key_epoch;
    latestRevision = Math.max(latestRevision, page.latest_revision);
    manifest = page.manifest;
    tombstoneFloor = page.tombstone_floor ?? 0;
    pageObjects.push(...page.objects);
    const high = page.objects.reduce((top, object) => Math.max(top, object.revision), 0);
    if (!page.has_more || high <= after) break;
    after = high;
  }
  // Only the newest revision of each object is carried out of the walk.
  const latestByObject = new Map<string, SealedObject>();
  for (const object of pageObjects) {
    const previous = latestByObject.get(object.id);
    if (!previous || object.revision > previous.revision) {
      latestByObject.set(object.id, object);
    }
  }
  log.debug("walked the change log", {
    pages,
    rows: pageObjects.length,
    objects: latestByObject.size,
    key_epoch: keyEpoch,
    snapshot,
    ms: elapsed(started),
  });
  return {
    objects: [...latestByObject.values()],
    keyEpoch,
    latestRevision,
    manifest,
    tombstoneFloor,
  };
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
};

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
    await refreshCollectionKey(session);
  }
  const { collectionKey } = session;
  const opened: OpenedVaultObject[] = [];
  let unopened = 0;
  // Check what was served against what a device signed for, before decrypting any
  // of it. A failure here means an object was withheld, rolled back or
  // substituted, and must not be presented as an empty or partial vault.
  if (walk.manifest) {
    onProgress?.({ stage: "verifying" });
    await verifyManifest(session, walk.manifest, walk.objects.map(entryFor));
  } else if (session.manifestSeq > 0) {
    log.error("the vault was served with no manifest after this device had seen one", {
      seen_seq: session.manifestSeq,
    });
    throw new ManifestError(
      "The server served this vault with no manifest, but this device has seen one. Refusing to continue.",
    );
  }
  if (onProgress && walk.objects.length > 0) {
    onProgress({ stage: "decrypting", count: walk.objects.length });
    // `openObject` is synchronous and holds the main thread for the whole loop
    // below, so the stage above would otherwise never be painted. Yielding to
    // the event loop rather than to a microtask is what lets that paint land.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  for (const obj of walk.objects) {
    // A rotation never re-encrypts a tombstone (clientRotation.ts), so one that
    // has outlived a rotation is still sealed under a key this device no longer
    // holds. The row-level flag already says it is a delete with nothing to
    // read, and the manifest above is what vouches for that flag, so there is
    // nothing to decrypt and a failure here is not this device losing access.
    if (obj.tombstone) continue;
    try {
      const result = openObject(collectionKey, obj.id, state.collection_id, obj.nonce, obj.ciphertext, obj.padded_size);
      if (result.tombstone) continue;
      opened.push({ object: obj, contentType: result.contentType, payload: result.payload });
    } catch {
      // The manifest already verified, so this row is one a device signed for
      // and the server served faithfully: the failure is local, and dropping it
      // silently is what made an unreadable vault look like an emptied one.
      unopened += 1;
    }
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
  return { opened, unopened };
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
      const { seq, keyEpoch, latestRevision } = state;
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
      const { objectCount, root } = state.apply(newEntries);
      const manifest = manifestSignRoot(
        bytesFromJson(session.state.mldsa_seed),
        bytesFromJson(session.state.ed25519_sk),
        session.state.collection_id,
        session.state.device_id,
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
  const { opened, unopened } = await openVault(session, onProgress);
  const sealed: SealedObject[] = [];
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
  for (const { object: obj, contentType, payload: raw } of opened) {
    try {
      sealed.push(obj);
      if (contentType === CALENDAR_EVENT_CONTENT_TYPE || isCalendarEventPayload(raw)) {
        const value = JSON.parse(raw) as { title?: string; start?: string; end?: string; notes?: string; location?: string; participants?: string[]; timezone?: string; calendarId?: string; recurrence?: CalendarEvent["recurrence"] };
        calendarEvents.push({ id: obj.id, title: value.title?.trim() || "Untitled event", start: value.start ?? "", end: value.end, notes: value.notes, location: value.location, participants: value.participants, timezone: value.timezone, calendarId: value.calendarId, recurrence: value.recurrence, raw });
      } else if (contentType === CALENDAR_CONTENT_TYPE || isCalendarPayload(raw)) {
        calendars.push(parseCalendar(obj.id, raw));
      } else if (contentType === ADDRESS_BOOK_CONTENT_TYPE || isAddressBookPayload(raw)) {
        addressBooks.push(parseAddressBook(obj.id, raw));
      } else if (contentType === NOTE_CONTENT_TYPE || isPayloadOfType(raw, "Note")) {
        notes.push(parseNote(obj.id, raw));
      } else if (contentType === NOTEBOOK_CONTENT_TYPE || isPayloadOfType(raw, "Notebook")) {
        notebooks.push(parseNotebook(obj.id, raw));
      } else if (contentType === BOOKMARK_CONTENT_TYPE || isPayloadOfType(raw, "Bookmark")) {
        bookmarks.push(parseBookmark(obj.id, raw));
      } else if (
        contentType === BOOKMARK_COLLECTION_CONTENT_TYPE ||
        isPayloadOfType(raw, "BookmarkCollection")
      ) {
        bookmarkCollections.push(parseBookmarkCollection(obj.id, raw));
      } else if (contentType === TASK_CONTENT_TYPE || isPayloadOfType(raw, "Task")) {
        tasks.push(parseTask(obj.id, raw));
      } else if (contentType === TASK_LIST_CONTENT_TYPE || isPayloadOfType(raw, "TaskList")) {
        taskLists.push(parseTaskList(obj.id, raw));
      } else if (
        contentType === ACCOUNT_SETTINGS_CONTENT_TYPE ||
        isPayloadOfType(raw, "AccountSettings")
      ) {
        // Two objects can answer to this shape until a legacy account's copy
        // at the calendar's id is migrated, so the canonical id wins rather
        // than whichever the server returned last.
        if (obj.id === ACCOUNT_SETTINGS_ID || accountSettingsId !== ACCOUNT_SETTINGS_ID) {
          accountSettings = parseAccountSettings(raw);
          accountSettingsRaw = raw;
          accountSettingsId = obj.id;
        }
      } else if (isContactPayload(raw)) {
        contacts.push(parseContact(obj.id, raw, obj.ciphertext, obj.padded_size));
      } else {
        // Not a shape this build knows. Skipping it is the only safe answer: the
        // old behaviour of falling through to a contact turned any newer content
        // type into a blank contact whose edit or delete destroyed the original.
        sealed.pop();
      }
    } catch {
      sealed.pop();
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
  });
  return {
    sealed,
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
    unopened,
  };
}

/**
 * Saves the account settings, at the one well-known object id.
 *
 * There is no delete: the object is a singleton, and a tombstoned one would read
 * back as the default on every client.
 */
export async function putAccountSettings(
  session: Session,
  settings: AccountSettings,
  previousRaw?: string,
): Promise<void> {
  await putSealed(
    session,
    ACCOUNT_SETTINGS_ID,
    ACCOUNT_SETTINGS_CONTENT_TYPE,
    false,
    serializeAccountSettings(settings, previousRaw),
  );
}
