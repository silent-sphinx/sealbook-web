import { b64ToByteArray, b64encode } from "./bytes";
import { describeError, log } from "./log";
import { idbClearAttachments } from "./idb";
import { clearLocalStore } from "./localStore";
import type { PinnedPosture } from "./profile";
import type { DeviceState } from "./types";
import { localStorageKdf, localStorageKey } from "./wasm";

const KEY = "sealbook.device";
export const DEVICE_STORAGE_KEY = KEY;
/** Where the snapshot used to live, before it outgrew localStorage. */
const LEGACY_VAULT_KEY = "sealbook.vault";
const DOMAIN_KEY = "sealbook.connection-domain";
const POSTURE_KEY = "sealbook.server-posture";
/** Read by `attachmentCache.ts`, which derives its key the same way this does. */
export const ATTACHMENT_CACHE_SALT_KEY = "sealbook.attachment-cache-salt";
/**
 * A plaintext copy of the vault's accent, so the lock screen can wear it before
 * the settings decrypt. A colour name is all it reveals, and sign-out removes it.
 */
export const ACCENT_HINT_KEY = "sealbook.accent";
const STORAGE_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;

export type DeviceMetadata = Pick<
  DeviceState,
  "server" | "username" | "account_id" | "collection_id" | "device_id"
>;

type DeviceEnvelope = {
  version: number;
  metadata: DeviceMetadata;
  /** The stretching suite the key came from; absent on a record made under PBKDF2. */
  kdf?: string;
  salt: string;
  iv: string;
  ciphertext: string;
};

export function loadAccentHint(): string | null {
  try {
    return localStorage.getItem(ACCENT_HINT_KEY);
  } catch {
    return null;
  }
}

export function saveAccentHint(accent: string): void {
  try {
    localStorage.setItem(ACCENT_HINT_KEY, accent);
  } catch {
    // storage unavailable; the lock screen falls back to the default accent
  }
}

export function loadConnectionDomain(): string | null {
  try {
    return localStorage.getItem(DOMAIN_KEY);
  } catch (err) {
    log.warn("could not read the stored connection domain", { reason: describeError(err) });
    return null;
  }
}

export function saveConnectionDomain(server: string): void {
  try {
    localStorage.setItem(DOMAIN_KEY, server);
  } catch (err) {
    log.warn("could not store the connection domain, so it will be asked for again", {
      reason: describeError(err),
    });
  }
}

/**
 * The crypto posture a server advertised the last time this browser signed in
 * there. Read before sign-in, so a server that has since weakened itself is
 * caught before any credential is sent. Kept unencrypted and keyed by server:
 * the two flags are not secret, and the check runs before the device record can
 * be decrypted. A missing or unreadable store is a server not yet pinned, which
 * is a first visit, so a read failure returns null rather than throwing.
 */
export function loadServerPosture(server: string): PinnedPosture | null {
  try {
    const raw = localStorage.getItem(POSTURE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, PinnedPosture>;
    return map[server] ?? null;
  } catch (err) {
    log.warn("could not read the stored server posture", { reason: describeError(err) });
    return null;
  }
}

export function saveServerPosture(server: string, posture: PinnedPosture): void {
  try {
    const raw = localStorage.getItem(POSTURE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, PinnedPosture>) : {};
    map[server] = posture;
    localStorage.setItem(POSTURE_KEY, JSON.stringify(map));
  } catch (err) {
    log.warn("could not store the server posture, so a later downgrade may go unnoticed", {
      reason: describeError(err),
    });
  }
}

function readStored(): DeviceEnvelope | DeviceState | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as DeviceEnvelope | DeviceState;
  } catch (err) {
    log.error("the stored device record is not readable JSON", { reason: describeError(err) });
    return null;
  }
}

function metadataOf(state: DeviceState): DeviceMetadata {
  const { server, username, account_id, collection_id, device_id } = state;
  return { server, username, account_id, collection_id, device_id };
}

export function loadDeviceMetadata(): DeviceMetadata | null {
  const stored = readStored();
  if (!stored) return null;
  if ("version" in stored && stored.version === STORAGE_VERSION) {
    return stored.metadata;
  }
  if ("hpke_sk" in stored) {
    // Legacy plaintext blob. The metadata is not secret and prefills sign-in;
    // the secrets it also holds are never returned (see loadDevice).
    return metadataOf(stored);
  }
  return null;
}

/**
 * The key for something this browser keeps under the password. A record that
 * names no suite predates Argon2id and was made under PBKDF2, which is kept
 * only so such a record can still be read and then re-saved.
 *
 * The Argon2id run is synchronous wasm, so it holds the page for as long as it
 * takes.
 */
export async function deriveStorageKey(
  password: string,
  salt: Uint8Array,
  kdf?: string,
): Promise<CryptoKey> {
  if (kdf) {
    const raw = b64ToByteArray(localStorageKey(password, b64encode(salt), kdf));
    return crypto.subtle.importKey("raw", Uint8Array.from(raw), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt).buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    await awaitImportPassword(password),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function awaitImportPassword(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
}

/**
 * The vault cannot be opened without reaching the server this once.
 *
 * Raised where there is no offline snapshot to fall back on, or where the one
 * stored predates the current password. The message is written for a person and
 * names the remedy, so `friendlyError` passes it through instead of flattening
 * it into "try again", which is the one thing that cannot work here.
 */
export class OfflineUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflineUnavailableError";
  }
}

export class DeviceStorageError extends Error {
  constructor(cause: unknown) {
    super(
      "This browser would not store this device's key, so it is not enrolled. " +
        "Private browsing or blocked site data is the usual cause; allow site data and sign in again.",
    );
    this.name = "DeviceStorageError";
    this.cause = cause;
  }
}

/**
 * Whether this browser still holds an enrolled device record. Stores that
 * outlive a session check it before writing, because a tab that was open when
 * another one signed out would otherwise write its data back into a browser the
 * user has just cleared. A storage area that cannot be read counts as enrolled,
 * so the check never takes away a write that would have worked.
 */
export function deviceEnrolled(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return true;
  }
}

/**
 * What the ciphertext is bound to, so the plaintext `metadata` beside it (which
 * prefills sign-in and names the server) cannot be swapped for another
 * account's or another server's without the record failing to open. A fixed
 * field order, not the stored object's, so it survives a round trip.
 */
function metadataAad(metadata: DeviceMetadata): Uint8Array<ArrayBuffer> {
  const { server, username, account_id, collection_id, device_id } = metadata;
  return new TextEncoder().encode(
    JSON.stringify([server, username, account_id, collection_id, device_id]),
  );
}

export async function saveDevice(state: DeviceState, password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kdf = localStorageKdf();
  const key = await deriveStorageKey(password, salt, kdf);
  const { session_token: _sessionToken, ...secretState } = state;
  const metadata = metadataOf(state);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: metadataAad(metadata) },
    key,
    new TextEncoder().encode(JSON.stringify(secretState)),
  );
  const envelope: DeviceEnvelope = {
    version: STORAGE_VERSION,
    metadata,
    kdf,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(new Uint8Array(ciphertext)),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(envelope));
  } catch (err) {
    // The one write here that cannot degrade like the others: without the
    // envelope the browser is not enrolled, and the server-side work has
    // already succeeded by this point, so the failure is named rather than
    // swallowed or left as an opaque DOMException.
    log.error("this browser refused to store the device's keys", {
      reason: describeError(err),
    });
    throw new DeviceStorageError(err);
  }
}

/**
 * Decrypts the stored device state, or returns null when the password is wrong.
 *
 * A pre-v1 install holds the device state — including `hpke_sk` — as plaintext
 * in localStorage. Such a blob is deliberately *not* returned: handing back
 * secrets the password has not unlocked would make this function's contract a
 * lie, and any future caller treating a non-null result as proof of the
 * password would have an authentication bypass. Callers see null, sign in
 * against the server instead, and `saveDevice` then replaces the plaintext blob
 * with an encrypted envelope. `hasLegacyPlaintextDevice` lets the UI explain
 * why the sign-in is being asked for.
 */
/**
 * A pre-v1 device blob, which localStorage holds as plaintext rather than
 * encrypted under the password.
 *
 * Named to make the danger explicit: nothing here proves the user knows the
 * password, so the returned state must only be used to drive a server login
 * that does check it. Deliberately separate from `loadDevice` so a caller
 * cannot treat "got state back" as "password was correct".
 */
export function loadUnverifiedLegacyDevice(): DeviceState | null {
  const stored = readStored();
  if (!stored || !("hpke_sk" in stored)) return null;
  const { session_token: _sessionToken, ...state } = stored;
  return state;
}

export async function loadDevice(password: string): Promise<DeviceState | null> {
  const stored = readStored();
  if (!stored) return null;
  if ("hpke_sk" in stored) {
    log.info("this device was enrolled before stored keys were encrypted; signing in to re-save it");
    return null;
  }
  if (stored.version !== STORAGE_VERSION) {
    log.warn("the stored device record is from another storage version", {
      stored_version: stored.version,
      expected_version: STORAGE_VERSION,
    });
    return null;
  }
  let state: DeviceState;
  try {
    const salt = Uint8Array.from(b64ToByteArray(stored.salt));
    const key = await deriveStorageKey(password, salt, stored.kdf);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Uint8Array.from(b64ToByteArray(stored.iv)),
        // A record without a suite predates the binding.
        ...(stored.kdf ? { additionalData: metadataAad(stored.metadata) } : {}),
      },
      key,
      Uint8Array.from(b64ToByteArray(stored.ciphertext)),
    );
    state = JSON.parse(new TextDecoder().decode(plaintext)) as DeviceState;
  } catch {
    // Expected on a wrong password: the AEAD tag is what checks it.
    log.debug("the stored device record did not decrypt under this password");
    return null;
  }
  if (!stored.kdf) {
    // The password is in hand, which is the only time an older record can be
    // moved off PBKDF2. Failing to is not a failed unlock.
    try {
      await saveDevice(state, password);
      log.info("the stored device record was re-saved under Argon2id");
    } catch (err) {
      log.warn("the stored device record could not be re-saved under Argon2id", {
        reason: describeError(err),
      });
    }
  }
  return state;
}

/**
 * Awaited rather than fired off: the attachment cache holds the account's files,
 * so a sign-out that returns before the store is empty has not signed out.
 */
export async function clearDevice(): Promise<void> {
  log.info("clearing this device's stored keys, offline snapshot and attachment cache");
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_VAULT_KEY);
    localStorage.removeItem(ATTACHMENT_CACHE_SALT_KEY);
    localStorage.removeItem(ACCENT_HINT_KEY);
  } catch (err) {
    // A throwing storage area must not stop the stores below being emptied.
    log.warn("the stored device record could not be removed", { reason: describeError(err) });
  }
  await Promise.all([clearLocalStore(), idbClearAttachments()]);
}
