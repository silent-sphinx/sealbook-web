import { b64ToByteArray, b64encode } from "./bytes";
import { idbDelete, idbGet, idbPut } from "./idb";
import { DEFAULT_ACCOUNT_SETTINGS, normalizeAccountSettings } from "./accountSettings";
import type {
  AccountSettings,
  AddressBook,
  Calendar,
  CalendarEvent,
  Contact,
  DeviceState,
  Note,
  Notebook,
} from "./types";

const KEY = "sealbook.device";
/** Where the snapshot used to live, before it outgrew localStorage. */
const LEGACY_VAULT_KEY = "sealbook.vault";
const VAULT_RECORD = "snapshot";
const DOMAIN_KEY = "sealbook.connection-domain";
const STORAGE_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;

export type VaultSnapshot = {
  contacts: Contact[];
  addressBooks: AddressBook[];
  calendars: Calendar[];
  calendarEvents: CalendarEvent[];
  notes: Note[];
  notebooks: Notebook[];
  accountSettings: AccountSettings;
};

export type DeviceMetadata = Pick<
  DeviceState,
  "server" | "username" | "account_id" | "collection_id" | "device_id"
>;

type DeviceEnvelope = {
  version: number;
  metadata: DeviceMetadata;
  salt: string;
  iv: string;
  ciphertext: string;
};

type VaultEnvelope = {
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

export function loadConnectionDomain(): string | null {
  try {
    return localStorage.getItem(DOMAIN_KEY);
  } catch {
    return null;
  }
}

export function saveConnectionDomain(server: string): void {
  try {
    localStorage.setItem(DOMAIN_KEY, server);
  } catch {
    // storage unavailable; ignore
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
  } catch {
    return null;
  }
}

async function readVault(): Promise<VaultEnvelope | null> {
  // The snapshot moved to IndexedDB when notes raised the per-object ceiling past
  // what localStorage can hold. Nothing migrates the old item: dropping it costs
  // one online refresh and avoids carrying a second code path for ever.
  try {
    localStorage.removeItem(LEGACY_VAULT_KEY);
  } catch {
    // storage unavailable; nothing to drop
  }
  const stored = await idbGet<VaultEnvelope>(VAULT_RECORD);
  if (!stored) return null;
  return stored.version === STORAGE_VERSION ? stored : null;
}

/**
 * The shape check for a decrypted snapshot, pure so it can be tested without
 * `crypto.subtle` or a storage area.
 *
 * The four original collections are required: a snapshot missing one is corrupt
 * rather than old. Anything added later defaults to empty, so a snapshot written
 * by an earlier build still opens instead of silently disabling offline mode.
 */
export function normalizeSnapshot(value: unknown): VaultSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<VaultSnapshot>;
  if (
    !Array.isArray(raw.contacts) ||
    !Array.isArray(raw.addressBooks) ||
    !Array.isArray(raw.calendars) ||
    !Array.isArray(raw.calendarEvents)
  ) {
    return null;
  }
  return {
    contacts: raw.contacts,
    addressBooks: raw.addressBooks,
    calendars: raw.calendars,
    calendarEvents: raw.calendarEvents,
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    notebooks: Array.isArray(raw.notebooks) ? raw.notebooks : [],
    // A snapshot written before the feature toggles existed carries no settings,
    // which reads as every feature enabled rather than as none. The whole object
    // is normalized, not just its flags, so an offline open keeps the contact
    // mode and the accent the account chose.
    accountSettings: raw.accountSettings
      ? normalizeAccountSettings(raw.accountSettings)
      : DEFAULT_ACCOUNT_SETTINGS,
  };
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

async function deriveStorageKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
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

export async function saveDevice(state: DeviceState, password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveStorageKey(password, salt);
  const { session_token: _sessionToken, ...secretState } = state;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(secretState)),
  );
  const envelope: DeviceEnvelope = {
    version: STORAGE_VERSION,
    metadata: metadataOf(state),
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(new Uint8Array(ciphertext)),
  };
  localStorage.setItem(KEY, JSON.stringify(envelope));
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
  if ("hpke_sk" in stored) return null;
  if (stored.version !== STORAGE_VERSION) return null;
  try {
    const salt = Uint8Array.from(b64ToByteArray(stored.salt));
    const key = await deriveStorageKey(password, salt);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(b64ToByteArray(stored.iv)) },
      key,
      Uint8Array.from(b64ToByteArray(stored.ciphertext)),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as DeviceState;
  } catch {
    return null;
  }
}

/** Resolves false when the snapshot could not be stored, so offline is stale. */
export async function saveVaultSnapshot(
  snapshot: VaultSnapshot,
  password: string,
): Promise<boolean> {
  if (!password) return false;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveStorageKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(snapshot)),
  );
  const envelope: VaultEnvelope = {
    version: STORAGE_VERSION,
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(new Uint8Array(ciphertext)),
  };
  // A full or unavailable storage area must not block normal online use, so a
  // failed write is reported rather than thrown.
  return idbPut(VAULT_RECORD, envelope);
}

export async function loadVaultSnapshot(password: string): Promise<VaultSnapshot | null> {
  const stored = await readVault();
  if (!stored) return null;
  try {
    const salt = Uint8Array.from(b64ToByteArray(stored.salt));
    const key = await deriveStorageKey(password, salt);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(b64ToByteArray(stored.iv)) },
      key,
      Uint8Array.from(b64ToByteArray(stored.ciphertext)),
    );
    return normalizeSnapshot(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    return null;
  }
}

export function clearDevice(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_VAULT_KEY);
  void idbDelete(VAULT_RECORD);
}
