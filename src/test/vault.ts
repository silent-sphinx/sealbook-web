/**
 * Harness for the suites that drive the app's own state machine.
 *
 * The app keeps this device in `localStorage` and the offline vault snapshot in
 * IndexedDB, which jsdom does not implement. `idb.ts` deliberately resolves
 * rather than rejecting when the database is missing, so without the fake a
 * test would read "no snapshot" and pass for the wrong reason.
 *
 * Fixtures go in through the real `saveDevice` and `saveVaultSnapshot`, so the
 * records a test reads back are ones the app itself wrote, encrypted under the
 * same PBKDF2 and AES-GCM as in a browser.
 */

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach } from "vitest";
import { saveConnectionDomain, saveDevice, saveVaultSnapshot, type VaultSnapshot } from "../lib/storage";
import { DEFAULT_ACCOUNT_SETTINGS } from "../lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "../lib/addressBook";
import type { Contact, DeviceState } from "../lib/types";

export const TEST_SERVER = "https://vault.example.com";

/**
 * Stand-ins for the key material. Nothing here is used as a key: the unlock
 * paths under test re-save and decrypt this record without ever handing it to
 * the crypto module.
 */
export function aDeviceState(overrides: Partial<DeviceState> = {}): DeviceState {
  return {
    server: TEST_SERVER,
    username: "ada",
    account_id: "account-1",
    collection_id: "collection-1",
    device_id: "device-1",
    kdf_salt: "AAAAAAAAAAAAAAAAAAAAAA==",
    hpke_sk: "AAAAAAAAAAAAAAAAAAAAAA==",
    mldsa_seed: "AAAAAAAAAAAAAAAAAAAAAA==",
    ed25519_sk: "AAAAAAAAAAAAAAAAAAAAAA==",
    ...overrides,
  };
}

export function aContact(name: string, id = `contact-${name}`): Contact {
  return {
    id,
    name,
    emails: [],
    phones: [],
    work: [],
    dates: [],
    socials: [],
    addressBookId: DEFAULT_ADDRESS_BOOK_ID,
    raw: JSON.stringify({ "@type": "Card", name: { full: name } }),
    ciphertext: "",
    paddedSize: 0,
  };
}

export function aSnapshot(contacts: Contact[] = []): VaultSnapshot {
  return {
    contacts,
    addressBooks: [{ id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" }],
    calendars: [],
    calendarEvents: [],
    notes: [],
    notebooks: [],
    accountSettings: DEFAULT_ACCOUNT_SETTINGS,
  };
}

/** Leaves the browser holding a device, the way a sign-in would have. */
export async function enrolDevice(
  password: string,
  state: DeviceState = aDeviceState(),
): Promise<void> {
  await saveDevice(state, password);
}

/** Leaves the browser holding an offline snapshot under the same password. */
export async function storeSnapshot(
  password: string,
  snapshot: VaultSnapshot = aSnapshot(),
): Promise<void> {
  const stored = await saveVaultSnapshot(snapshot, password);
  if (!stored) {
    throw new Error("the snapshot fixture was not stored, so the test would not mean anything");
  }
}

export function setOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

/**
 * Seeds the stored connection domain, so a render with no enrolled device shows
 * the sign-in methods rather than the server-address step that gates them.
 */
export function setConnectionDomain(server: string = TEST_SERVER): void {
  saveConnectionDomain(server);
}

/**
 * jsdom performs no layout, so it ships neither observer the shell builds on:
 * the header measures itself to size the calendar, and SplitPane measures its
 * own column. Both only need the constructor to exist for a render to get
 * through; nothing under test depends on a measurement.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * jsdom ships no `matchMedia` either, and the shell uses it to choose between a
 * static sidebar column and a slide-over drawer rather than to style one. This
 * answers as a wide viewport would, so what a test looks for is on the page
 * instead of behind a closed drawer; `prefers-reduced-motion` answers false.
 */
function stubMatchMedia(): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

beforeEach(() => {
  globalThis.ResizeObserver = NoopResizeObserver;
  stubMatchMedia();
  // Present in jsdom but not on every element path the shell touches.
  Element.prototype.scrollIntoView ??= function scrollIntoView(): void {};
  setOnline(true);
});

afterEach(() => {
  localStorage.clear();
  // A fresh factory per test, so one test's snapshot is never another's.
  globalThis.indexedDB = new IDBFactory();
});
