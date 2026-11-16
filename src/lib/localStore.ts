/**
 * This device's copy of the vault and its queue of unsent writes, under a key
 * derived from the password once per session. The outbox is not a cache, so a
 * failure to store it is raised.
 */

import { b64ToByteArray, b64encode } from "./bytes";
import { describeError, log } from "./log";
import { idbDelete, idbGet, idbPut } from "./idb";
import { deriveStorageKey, deviceEnrolled } from "./storage";
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

let password: string | null = null;
/** Keys by salt, so records written under another salt still open. */
let keys = new Map<string, Promise<CryptoKey>>();
let writeSalt: string | null = null;

export const EMPTY_OUTBOX: Outbox = { version: 1, writes: [], failed: [] };

export function emptyVault(): LocalVault {
  return { version: 1, latest_revision: 0, key_epoch: 0, objects: [] };
}

/** Nothing is derived until the first use. */
export function openLocalStore(sessionPassword: string): void {
  if (sessionPassword === password) return;
  password = sessionPassword;
  keys = new Map();
  writeSalt = null;
}

export function closeLocalStore(): void {
  password = null;
  keys = new Map();
  writeSalt = null;
}

export function localStoreOpen(): boolean {
  return password !== null;
}

function keyFor(salt: string, kdf?: string): Promise<CryptoKey> {
  const id = `${kdf ?? ""}:${salt}`;
  const held = keys.get(id);
  if (held) return held;
  if (!password) return Promise.reject(new Error("the local store is closed"));
  const key = deriveStorageKey(password, Uint8Array.from(b64ToByteArray(salt)), kdf);
  keys.set(id, key);
  return key;
}

async function seal(text: string): Promise<Envelope> {
  writeSalt ??= b64encode(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kdf = localStorageKdf();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await keyFor(writeSalt, kdf),
    new TextEncoder().encode(text),
  );
  return {
    version: ENVELOPE_VERSION,
    kdf,
    salt: writeSalt,
    iv: b64encode(iv),
    ciphertext: b64encode(new Uint8Array(ciphertext)),
  };
}

/** The plaintext, or null when the record is absent or will not decrypt. */
async function open(record: string): Promise<{ text: string | null; present: boolean }> {
  const stored = await idbGet<Envelope>(record);
  if (!stored || stored.version !== ENVELOPE_VERSION) return { text: null, present: false };
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(b64ToByteArray(stored.iv)) },
      await keyFor(stored.salt, stored.kdf),
      Uint8Array.from(b64ToByteArray(stored.ciphertext)),
    );
    writeSalt ??= stored.salt;
    return { text: new TextDecoder().decode(plaintext), present: true };
  } catch {
    return { text: null, present: true };
  }
}

/** This device's copy of the vault, or null when there is none it can read. */
export async function loadLocalVault(): Promise<LocalVault | null> {
  if (!password) return null;
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
  if (!password || !deviceEnrolled()) return false;
  const written = await idbPut(VAULT_RECORD, await seal(coreLocalVaultWrite(vault)));
  if (!written) {
    log.warn("the vault copy could not be saved, so offline use will show older data");
  }
  void idbDelete(LEGACY_SNAPSHOT_RECORD);
  return written;
}

/** One that will not open under this password is set aside, not overwritten. */
export async function loadOutbox(): Promise<Outbox> {
  if (!password) return EMPTY_OUTBOX;
  const { text, present } = await open(OUTBOX_RECORD);
  if (text === null) {
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
  if (!password) throw new OutboxStorageError(new Error("the local store is closed"));
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
  if (!password || nextPassword === password) {
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
