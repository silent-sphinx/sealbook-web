/**
 * This device's copy of the vault and its queue of unsent writes, under a key
 * derived from the password once per session and kept without it. The outbox is not a cache, so a
 * failure to store it is raised.
 */

import { b64ToByteArray, b64encode } from "./bytes";
import { describeError, log } from "./log";
import { idbDelete, idbGet, idbPut } from "./idb";
import {
  aesKeyFrom,
  companionKey,
  deriveStorageKey,
  deviceEnrolled,
  STORE_SALT_KEY,
  stretchPassword,
} from "./storage";
import { installAttachmentCacheKey } from "./attachmentCache";
import { localStorageKdf } from "./wasm";
import {
  coreLocalVaultRead,
  coreLocalVaultWrite,
  coreOutboxRead,
  coreOutboxWrite,
  type LocalVault,
  type Outbox,
} from "./wasm";

const VAULT_RECORD = "local-vault";
const OUTBOX_RECORD = "outbox";
/** An outbox that did not open under this session's password, kept rather than overwritten. */
const LOCKED_OUTBOX_RECORD = "outbox-locked";
/** The view-model snapshot this module replaced. */
const LEGACY_SNAPSHOT_RECORD = "snapshot";
const ENVELOPE_VERSION = 1;
/** How many writes are queued, readable while locked so sign-out can warn. */
const QUEUED_KEY = "sealbook.queued-changes";

type Envelope = {
  version: number;
  /** The stretching suite; absent on a record made under PBKDF2. */
  kdf?: string;
  salt: string;
  iv: string;
  ciphertext: string;
};

/** The outbox could not be stored, so an edit would be lost on reload. */
export class OutboxStorageError extends Error {
  constructor(cause: unknown) {
    super(
      "This browser would not store the change, so it has not been saved. " +
        "Free some space or allow site data, then try again.",
    );
    this.name = "OutboxStorageError";
    this.cause = cause;
  }
}

/**
 * Whether the store is open, and the keys it holds once `ready` settles. The
 * password is used once, to derive them, and is not kept: a script that runs in
 * this page can use these keys but not learn what the password was, which
 * would also open the device record and sign in elsewhere.
 */
let opened = false;
let ready: Promise<void> = Promise.resolve();
let epoch = 0;
/** Keys by suite and salt, so records written under another still open. */
let keys = new Map<string, CryptoKey>();
let writeSalt: string | null = null;

export const EMPTY_OUTBOX: Outbox = { version: 1, writes: [], failed: [] };

export function emptyVault(): LocalVault {
  return { version: 1, latest_revision: 0, key_epoch: 0, objects: [] };
}

const keyId = (salt: string, kdf?: string) => `${kdf ?? ""}:${salt}`;

/** The salt writes go under: the one tabs share, else a stored record's, else new. */
function sharedWriteSalt(records: (Envelope | null)[]): string {
  try {
    const stored = localStorage.getItem(STORE_SALT_KEY);
    if (stored) return stored;
  } catch {
    // unreadable; fall through to one for this session
  }
  const current = records.find((record) => record?.version === ENVELOPE_VERSION && record.kdf);
  const salt = current?.salt ?? b64encode(crypto.getRandomValues(new Uint8Array(16)));
  try {
    localStorage.setItem(STORE_SALT_KEY, salt);
  } catch {
    // each tab then writes under its own salt, as it did before this was shared
  }
  return salt;
}

/**
 * Derives what this session needs from the password and lets it go: the key
 * writes use, and one for each suite and salt a stored record is under, which
 * is how a record from before a suite change is still read once.
 */
async function deriveKeys(password: string, generation: number): Promise<void> {
  const records = await Promise.all([VAULT_RECORD, OUTBOX_RECORD].map((id) => idbGet<Envelope>(id)));
  const salt = sharedWriteSalt(records);
  const wanted = new Map<string, { salt: string; kdf?: string }>();
  wanted.set(keyId(salt, localStorageKdf()), { salt, kdf: localStorageKdf() });
  for (const record of records) {
    if (record?.version === ENVELOPE_VERSION && typeof record.salt === "string") {
      wanted.set(keyId(record.salt, record.kdf), { salt: record.salt, kdf: record.kdf });
    }
  }
  const derived = new Map<string, CryptoKey>();
  let cacheKey: CryptoKey | null = null;
  const writeId = keyId(salt, localStorageKdf());
  for (const [id, { salt: wantedSalt, kdf }] of wanted) {
    const wantedBytes = Uint8Array.from(b64ToByteArray(wantedSalt));
    if (id === writeId && kdf) {
      // One stretch serves the offline copy and the attachment cache, which
      // would otherwise each cost an Argon2id run at every unlock.
      const material = stretchPassword(password, wantedBytes, kdf);
      derived.set(id, await aesKeyFrom(material));
      cacheKey = await companionKey(material, "sealbook-attachment-cache-v1");
    } else {
      derived.set(id, await deriveStorageKey(password, wantedBytes, kdf));
    }
  }
  if (generation !== epoch) return;
  keys = derived;
  writeSalt = salt;
  if (cacheKey && deviceEnrolled()) installAttachmentCacheKey(cacheKey);
}

/** Starts deriving the keys. What uses them waits for it. */
export function openLocalStore(sessionPassword: string): void {
  closeLocalStore();
  opened = true;
  const generation = epoch;
  ready = deriveKeys(sessionPassword, generation).catch((err: unknown) => {
    log.error("the local store keys could not be derived, so the offline copy is unavailable", {
      reason: describeError(err),
    });
    if (generation === epoch) closeLocalStore();
  });
}

export function closeLocalStore(): void {
  epoch += 1;
  opened = false;
  ready = Promise.resolve();
  keys = new Map();
  writeSalt = null;
}

export function localStoreOpen(): boolean {
  return opened;
}

/** Whether the keys are there, once they have been derived. */
async function usable(): Promise<boolean> {
  if (!opened) return false;
  const generation = epoch;
  await ready;
  return opened && generation === epoch && writeSalt !== null;
}

function keyFor(salt: string, kdf?: string): CryptoKey {
  const key = keys.get(keyId(salt, kdf));
  if (!key) throw new Error("no key is held for this record");
  return key;
}

/**
 * Sealed under the salt and key held when it was called. Read once, before any
 * await: a lock that lands while this runs empties both, and a record written
 * with the salt gone is one nothing can open.
 */
async function seal(text: string): Promise<Envelope> {
  const salt = writeSalt;
  if (!salt) throw new Error("the local store is closed");
  const kdf = localStorageKdf();
  const key = keyFor(salt, kdf);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text),
  );
  return {
    version: ENVELOPE_VERSION,
    kdf,
    salt,
    iv: b64encode(iv),
    ciphertext: b64encode(new Uint8Array(ciphertext)),
  };
}

/** The plaintext, or null when the record is absent or will not decrypt. */
async function open(
  record: string,
): Promise<{ text: string | null; present: boolean; keyed: boolean }> {
  const stored = await idbGet<Envelope>(record);
  if (!stored || stored.version !== ENVELOPE_VERSION) {
    return { text: null, present: false, keyed: true };
  }
  const key = keys.get(keyId(stored.salt, stored.kdf));
  // Not a wrong password: a record under a salt this session never derived,
  // written by another tab after this one opened. Not the same as one that
  // fails to decrypt, which is set aside.
  if (!key) return { text: null, present: true, keyed: false };
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(b64ToByteArray(stored.iv)) },
      key,
      Uint8Array.from(b64ToByteArray(stored.ciphertext)),
    );
    return { text: new TextDecoder().decode(plaintext), present: true, keyed: true };
  } catch {
    return { text: null, present: true, keyed: true };
  }
}

/** This device's copy of the vault, or null when there is none it can read. */
export async function loadLocalVault(): Promise<LocalVault | null> {
  if (!(await usable())) return null;
  const { text } = await open(VAULT_RECORD);
  if (text === null) return null;
  try {
    return coreLocalVaultRead(text);
  } catch (err) {
    log.warn("the stored vault copy is not readable by this build", {
      reason: describeError(err),
    });
    return null;
  }
}

/** Resolves false when the copy could not be stored, so offline use is stale. */
export async function saveLocalVault(vault: LocalVault): Promise<boolean> {
  if (!deviceEnrolled() || !(await usable())) return false;
  const written = await idbPut(VAULT_RECORD, await seal(coreLocalVaultWrite(vault)));
  if (!written) {
    log.warn("the vault copy could not be saved, so offline use will show older data");
  }
  void idbDelete(LEGACY_SNAPSHOT_RECORD);
  return written;
}

/** One that will not open under this password is set aside, not overwritten. */
export async function loadOutbox(): Promise<Outbox> {
  if (!(await usable())) return EMPTY_OUTBOX;
  const { text, present, keyed } = await open(OUTBOX_RECORD);
  if (text === null) {
    if (present && !keyed) {
      throw new Error(
        "The queued changes on this device were saved by another tab under a different key. Reload to continue.",
      );
    }
    if (present) {
      log.warn("the outbox did not open under this password, so it was set aside");
      const stored = await idbGet<Envelope>(OUTBOX_RECORD);
      if (stored && (await idbPut(LOCKED_OUTBOX_RECORD, stored))) {
        await idbDelete(OUTBOX_RECORD);
      }
    }
    return EMPTY_OUTBOX;
  }
  try {
    return coreOutboxRead(text);
  } catch (err) {
    throw new Error(`The queued changes on this device are from a newer version of Sealbook. ${describeError(err)}`);
  }
}

/** Raises `OutboxStorageError` when the browser will not take it. */
export async function saveOutbox(outbox: Outbox): Promise<void> {
  if (!(await usable())) throw new OutboxStorageError(new Error("the local store is closed"));
  if (!deviceEnrolled()) throw new OutboxStorageError(new Error("this device was signed out"));
  let envelope: Envelope;
  try {
    envelope = await seal(coreOutboxWrite(outbox));
  } catch (err) {
    throw new OutboxStorageError(err);
  }
  if (!(await idbPut(OUTBOX_RECORD, envelope))) {
    log.error("the outbox could not be stored");
    throw new OutboxStorageError(new Error("IndexedDB refused the write"));
  }
  try {
    localStorage.setItem(QUEUED_KEY, String(outbox.writes.length + outbox.failed.length));
  } catch {
    // the count only words a warning
  }
}

/** Writes queued on this device, as of the last save. */
export function queuedCount(): number {
  try {
    return Number(localStorage.getItem(QUEUED_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Re-encrypts both records for a password changed on this device. */
export async function rekeyLocalStore(nextPassword: string): Promise<void> {
  if (!opened) {
    openLocalStore(nextPassword);
    return;
  }
  const vault = await loadLocalVault();
  const outbox = await loadOutbox();
  openLocalStore(nextPassword);
  await saveOutbox(outbox);
  if (vault) await saveLocalVault(vault);
}

/** Whether queued writes exist under a password other than this session's. */
export async function hasLockedOutbox(): Promise<boolean> {
  return (await idbGet<Envelope>(LOCKED_OUTBOX_RECORD)) !== null;
}

export async function clearLocalStore(): Promise<void> {
  closeLocalStore();
  try {
    localStorage.removeItem(QUEUED_KEY);
  } catch {
    // nothing to clear
  }
  await Promise.all([
    idbDelete(VAULT_RECORD),
    idbDelete(OUTBOX_RECORD),
    idbDelete(LOCKED_OUTBOX_RECORD),
    idbDelete(LEGACY_SNAPSHOT_RECORD),
  ]);
}
