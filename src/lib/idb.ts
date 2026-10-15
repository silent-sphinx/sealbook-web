/**
 * The one IndexedDB store this app uses, wrapped in promises.
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
const DB_VERSION = 2;
const STORE = "vault";
/**
 * Decrypted attachment blobs, keyed by attachment id, kept apart from the vault
 * snapshot so opening the vault never has to read a single photo, and viewing a
 * photo never has to decrypt the whole snapshot.
 */
const ATTACHMENT_STORE = "attachments";

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
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
      if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
        db.createObjectStore(ATTACHMENT_STORE);
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

/** A cached, already-decrypted attachment blob, or null if not cached. */
export async function idbGetAttachment(id: string): Promise<Blob | null> {
  const db = await open();
  if (!db) return null;
  try {
    return await new Promise<Blob | null>((resolve) => {
      const request = db.transaction(ATTACHMENT_STORE, "readonly").objectStore(ATTACHMENT_STORE).get(id);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function idbPutAttachment(id: string, blob: Blob): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(ATTACHMENT_STORE, "readwrite");
      tx.objectStore(ATTACHMENT_STORE).put(blob, id);
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

export async function idbDeleteAttachment(id: string): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(ATTACHMENT_STORE, "readwrite");
      tx.objectStore(ATTACHMENT_STORE).delete(id);
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
