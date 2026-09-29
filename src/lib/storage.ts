import { b64ToByteArray, b64encode } from "./bytes";
import type { AddressBook, Calendar, CalendarEvent, Contact, DeviceState } from "./types";

const KEY = "sealbook.device";
const VAULT_KEY = "sealbook.vault";
const DOMAIN_KEY = "sealbook.connection-domain";
const STORAGE_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;

export type VaultSnapshot = {
  contacts: Contact[];
  addressBooks: AddressBook[];
  calendars: Calendar[];
  calendarEvents: CalendarEvent[];
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

function readVault(): VaultEnvelope | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(VAULT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as VaultEnvelope;
    return stored.version === STORAGE_VERSION ? stored : null;
  } catch {
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

export async function saveVaultSnapshot(snapshot: VaultSnapshot, password: string): Promise<void> {
  if (!password) return;
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
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(envelope));
  } catch {
    // A full or unavailable storage area must not block normal online use.
  }
}

export async function loadVaultSnapshot(password: string): Promise<VaultSnapshot | null> {
  const stored = readVault();
  if (!stored) return null;
  try {
    const salt = Uint8Array.from(b64ToByteArray(stored.salt));
    const key = await deriveStorageKey(password, salt);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(b64ToByteArray(stored.iv)) },
      key,
      Uint8Array.from(b64ToByteArray(stored.ciphertext)),
    );
    const snapshot = JSON.parse(new TextDecoder().decode(plaintext)) as VaultSnapshot;
    if (
      !Array.isArray(snapshot.contacts) ||
      !Array.isArray(snapshot.addressBooks) ||
      !Array.isArray(snapshot.calendars) ||
      !Array.isArray(snapshot.calendarEvents)
    ) {
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function clearDevice(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(VAULT_KEY);
}
