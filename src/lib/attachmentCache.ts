/**
 * The decrypted-attachment cache, which is encrypted at rest.
 *
 * Attachments arrive from the server sealed and are opened for display, so
 * caching them to avoid re-downloading a photo on every view means writing
 * account content to this origin. That content is kept under the same AES-GCM
 * key the vault snapshot uses, derived from the password once per session and
 * held in memory only: a device handed on after sign-out holds nothing
 * readable, and `clearDevice` empties the store outright.
 *
 * The cache is a convenience, never a source of truth. Every failure here falls
 * back to downloading the attachment again.
 */

import { b64ToByteArray, b64encode } from "./bytes";
import { describeError, log } from "./log";
import {
  idbAttachmentIndex,
  idbDeleteAttachments,
  idbGetAttachment,
  idbPutAttachment,
  idbTouchAttachment,
  type CachedAttachmentRow,
} from "./idb";
import { ATTACHMENT_CACHE_SALT_KEY, deriveStorageKey } from "./storage";
import type { NoteAttachment } from "./types";

const RECORD_VERSION = 1;
/**
 * What the whole cache may occupy. The origin quota has to hold the vault
 * snapshot as well, and an unbounded cache is what made writes start failing.
 */
export const ATTACHMENT_CACHE_BUDGET = 64 * 1024 * 1024;
/**
 * Larger attachments are shown without being cached, so one file cannot take
 * the budget on its own and leave nothing for the photos being browsed.
 */
export const MAX_CACHED_ATTACHMENT_SIZE = 16 * 1024 * 1024;

let sessionPassword: string | null = null;
let keyPromise: Promise<CryptoKey | null> | null = null;

/**
 * The cache's own salt, persisted because the cache outlives a session.
 *
 * A storage area that will not hold it gets a salt for this session alone,
 * which costs the entries written before the next reload and nothing else:
 * anything unreadable is dropped on the read that finds it.
 */
function cacheSalt(): Uint8Array<ArrayBuffer> {
  try {
    const stored = localStorage.getItem(ATTACHMENT_CACHE_SALT_KEY);
    if (stored) return Uint8Array.from(b64ToByteArray(stored));
  } catch {
    // unreadable or malformed; fall through to a fresh salt
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  try {
    localStorage.setItem(ATTACHMENT_CACHE_SALT_KEY, b64encode(salt));
  } catch (err) {
    log.warn("the attachment cache salt could not be stored, so the cache lasts this session", {
      reason: describeError(err),
    });
  }
  return salt;
}

/** Opens the cache for a session. The key itself is derived on first use. */
export function primeAttachmentCache(password: string): void {
  if (!password) return;
  sessionPassword = password;
  keyPromise = null;
}

/**
 * Forgets the key and the password it came from, on lock or sign-out. The
 * entries stay, unreadable.
 */
export function closeAttachmentCache(): void {
  sessionPassword = null;
  keyPromise = null;
}

/**
 * The cache key, derived once and on demand rather than at unlock: 600,000
 * PBKDF2 iterations are too much work to add to every unlock, most of which go
 * on to view no attachment at all, and the unlock has two such derivations in
 * front of it already. The password is held only until this runs.
 */
function cacheKey(): Promise<CryptoKey | null> {
  if (keyPromise) return keyPromise;
  const password = sessionPassword;
  if (!password) return Promise.resolve(null);
  sessionPassword = null;
  keyPromise = deriveStorageKey(password, cacheSalt()).catch((err) => {
    log.warn("the attachment cache key could not be derived, so attachments are not cached", {
      reason: describeError(err),
    });
    return null;
  });
  return keyPromise;
}

function boundTo(id: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(id);
}

/**
 * The cached attachment, or null when it is absent, unreadable, or the cache is
 * closed. An entry that will not decrypt is dropped: the key that wrote it is
 * gone, so it is dead weight against the budget.
 */
export async function readCachedAttachment(attachment: NoteAttachment): Promise<Blob | null> {
  if (!sessionPassword && !keyPromise) return null;
  const record = await idbGetAttachment(attachment.id);
  if (!record || record.version !== RECORD_VERSION) {
    // A miss costs a download, so the key is started here rather than waited
    // on: it is then ready for the write that follows, in parallel with the
    // transfer instead of ahead of it.
    void cacheKey();
    return null;
  }
  const key = await cacheKey();
  if (!key) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: record.iv, additionalData: boundTo(attachment.id) },
      key,
      record.ciphertext,
    );
    void idbTouchAttachment(attachment.id);
    return new Blob([plaintext], { type: attachment.mimeType });
  } catch {
    log.debug("a cached attachment did not decrypt and was dropped", {
      attachment_id: attachment.id,
    });
    await idbDeleteAttachments([attachment.id]);
    return null;
  }
}

export async function writeCachedAttachment(id: string, blob: Blob): Promise<void> {
  if (blob.size > MAX_CACHED_ATTACHMENT_SIZE) return;
  const key = await cacheKey();
  if (!key) return;
  let ciphertext: ArrayBuffer;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: boundTo(id) },
      key,
      await blob.arrayBuffer(),
    );
  } catch (err) {
    log.warn("an attachment could not be encrypted for the cache", {
      attachment_id: id,
      reason: describeError(err),
    });
    return;
  }
  await idbDeleteAttachments(await evictionFor(id, blob.size));
  const written = await idbPutAttachment(id, {
    version: RECORD_VERSION,
    iv,
    ciphertext: new Uint8Array(ciphertext),
    bytes: blob.size,
    lastUsed: Date.now(),
  });
  if (!written) {
    // Named rather than swallowed: a silent false here is the whole cache
    // quietly turning itself off.
    log.warn("the attachment cache would not take this file, so it downloads again next time", {
      attachment_id: id,
      bytes: blob.size,
    });
  }
}

async function evictionFor(id: string, bytes: number): Promise<string[]> {
  const stale = staleEntries(await idbAttachmentIndex(), id, bytes);
  if (stale.length > 0) {
    log.debug("evicting cached attachments to stay inside the cache budget", {
      count: stale.length,
    });
  }
  return stale;
}

/**
 * The entries to drop, least recently used first, so that `bytes` more fits
 * inside the budget. An entry under the same id is being replaced rather than
 * added, so its size is not counted against the budget.
 */
export function staleEntries(
  index: readonly CachedAttachmentRow[],
  id: string,
  bytes: number,
  budget = ATTACHMENT_CACHE_BUDGET,
): string[] {
  const others = index.filter((row) => row.id !== id);
  let total = others.reduce((sum, row) => sum + row.bytes, bytes);
  if (total <= budget) return [];
  const stale: string[] = [];
  for (const row of [...others].sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (total <= budget) break;
    stale.push(row.id);
    total -= row.bytes;
  }
  return stale;
}

export async function forgetCachedAttachment(id: string): Promise<void> {
  await idbDeleteAttachments([id]);
}
