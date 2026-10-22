/**
 * The IndexedDB stores this app uses, wrapped in promises.
 *
 * The offline vault snapshot lives here rather than in `localStorage` because
 * `localStorage` is capped near 5 MB per origin while a single note may be
 * megabytes, and a write over the cap throws where the snapshot is written for
 * its side effect. IndexedDB's origin quota is orders of magnitude larger.
 *
 * Every call resolves rather than rejecting on an unavailable database: in a
 * private window, under storage pressure, or with site data blocked, the right
 * behaviour is no offline snapshot, not a failed unlock.
 */

import { describeError, log } from "./log";

const DB_NAME = "sealbook";
const DB_VERSION = 3;
const STORE = "vault";
/**
 * Encrypted attachment records, keyed by attachment id, kept apart from the
 * vault snapshot so opening the vault never has to read a single photo, and
 * viewing a photo never has to decrypt the whole snapshot. `attachmentCache.ts`
 * owns what goes in; this module only moves records in and out.
 */
const ATTACHMENT_STORE = "attachments";
/**
 * Plaintext size and last use per cached attachment, so the cache budget can be
 * measured and the least recently used entries found without reading every
 * ciphertext back out of the store.
 */
const ATTACHMENT_META_STORE = "attachmentMeta";

/** An encrypted cache entry. Plaintext attachment bytes never reach this store. */
export type CachedAttachment = {
  version: number;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
  /** Plaintext size, which is what the cache budget is measured in. */
  bytes: number;
  lastUsed: number;
};

type AttachmentMeta = { bytes: number; lastUsed: number };

export type CachedAttachmentRow = AttachmentMeta & { id: string };

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      log.warn("IndexedDB is unavailable, so the vault cannot be kept offline", {
        reason: describeError(err),
      });
      resolve(null);
      return;
    }
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
      // Version 2 held decrypted blobs in the attachment store. Version 3 holds
      // encrypted records, and the old entries cannot be re-encrypted without
      // the password, so the store is dropped rather than migrated: leaving it
      // would keep exactly the plaintext this version exists to remove.
      if (event.oldVersion < 3 && db.objectStoreNames.contains(ATTACHMENT_STORE)) {
        db.deleteObjectStore(ATTACHMENT_STORE);
      }
      if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
        db.createObjectStore(ATTACHMENT_STORE);
      }
      if (!db.objectStoreNames.contains(ATTACHMENT_META_STORE)) {
        db.createObjectStore(ATTACHMENT_META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      log.warn("the offline database would not open", {
        reason: describeError(request.error),
      });
      resolve(null);
    };
    // A second tab holding an older version would otherwise leave this pending
    // for ever.
    request.onblocked = () => {
      log.warn("another tab is holding an older offline database open");
      resolve(null);
    };
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Resolves false when the write could not be made, so a caller can degrade. */
export async function idbPut(key: string, value: unknown): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch {
    return false;
  } finally {
    db.close();
  }
}

export async function idbDelete(key: string): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // nothing to clean up
  } finally {
    db.close();
  }
}

/**
 * Runs one readwrite transaction across both attachment stores, so a record and
 * its metadata are never written or removed apart from each other.
 *
 * Resolves false on an unavailable database, a refused transaction, or a body
 * that throws, which is what a quota failure arrives as.
 */
async function writeAttachments(
  body: (records: IDBObjectStore, meta: IDBObjectStore) => void,
): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction([ATTACHMENT_STORE, ATTACHMENT_META_STORE], "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
      try {
        body(tx.objectStore(ATTACHMENT_STORE), tx.objectStore(ATTACHMENT_META_STORE));
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  } finally {
    db.close();
  }
}

/** A cached attachment record, still encrypted, or null if not cached. */
export async function idbGetAttachment(id: string): Promise<CachedAttachment | null> {
  const db = await open();
  if (!db) return null;
  try {
    return await new Promise<CachedAttachment | null>((resolve) => {
      const request = db
        .transaction(ATTACHMENT_STORE, "readonly")
        .objectStore(ATTACHMENT_STORE)
        .get(id);
      request.onsuccess = () => resolve((request.result as CachedAttachment | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function idbPutAttachment(id: string, record: CachedAttachment): Promise<boolean> {
  const { bytes, lastUsed } = record;
  return writeAttachments((records, meta) => {
    records.put(record, id);
    meta.put({ bytes, lastUsed } satisfies AttachmentMeta, id);
  });
}

/** Moves an entry to the recent end of the eviction order after a cache hit. */
export async function idbTouchAttachment(id: string, lastUsed = Date.now()): Promise<void> {
  await writeAttachments((_records, meta) => {
    const existing = meta.get(id);
    existing.onsuccess = () => {
      const row = existing.result as AttachmentMeta | undefined;
      if (row) meta.put({ ...row, lastUsed } satisfies AttachmentMeta, id);
    };
  });
}

export async function idbDeleteAttachments(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await writeAttachments((records, meta) => {
    for (const id of ids) {
      records.delete(id);
      meta.delete(id);
    }
  });
}

/** Empties the cache, which is what sign-out needs and nothing else does. */
export async function idbClearAttachments(): Promise<void> {
  await writeAttachments((records, meta) => {
    records.clear();
    meta.clear();
  });
}

/** Every cached entry's size and last use, for the budget and the eviction order. */
export async function idbAttachmentIndex(): Promise<CachedAttachmentRow[]> {
  const db = await open();
  if (!db) return [];
  try {
    return await new Promise<CachedAttachmentRow[]>((resolve) => {
      const rows: CachedAttachmentRow[] = [];
      const request = db
        .transaction(ATTACHMENT_META_STORE, "readonly")
        .objectStore(ATTACHMENT_META_STORE)
        .openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(rows);
          return;
        }
        const row = cursor.value as AttachmentMeta;
        rows.push({ id: String(cursor.key), bytes: row.bytes, lastUsed: row.lastUsed });
        cursor.continue();
      };
      // A partial index still bounds the store; it just evicts less precisely.
      request.onerror = () => resolve(rows);
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}
