/**
 * Harness for the suites that drive the app's own state machine.
 *
 * The app keeps this device in `localStorage` and the offline vault snapshot in
 * IndexedDB, which jsdom does not implement. `idb.ts` deliberately resolves
 * rather than rejecting when the database is missing, so without the fake a
 * test would read "no snapshot" and pass for the wrong reason.
 *
 * Fixtures go in through the real `saveDevice` and `saveLocalVault`, so the
 * records a test reads back are ones the app itself wrote, encrypted under the
 * same PBKDF2 and AES-GCM as in a browser.
 */

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach } from "vitest";
import { closeLocalStore, openLocalStore, saveLocalVault } from "../lib/localStore";
import { closeOutbox } from "../lib/outbox";
import { saveConnectionDomain, saveDevice } from "../lib/storage";
import {
  ADDRESS_BOOK_CONTENT_TYPE,
  DEFAULT_ADDRESS_BOOK_ID,
  JSCONTACT_CONTENT_TYPE,
} from "../lib/addressBook";
import type { LocalVault } from "../lib/wasm";
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

/** This device's copy of a vault holding the default address book and `contacts`. */
export function aSnapshot(contacts: Contact[] = []): LocalVault {
  return {
    version: 1,
    latest_revision: contacts.length + 1,
    key_epoch: 0,
    objects: [
      {
        id: DEFAULT_ADDRESS_BOOK_ID,
        content_type: ADDRESS_BOOK_CONTENT_TYPE,
        revision: 1,
        tombstone: false,
        payload: JSON.stringify({ name: "Contacts" }),
      },
      ...contacts.map((contact, index) => ({
        id: contact.id,
        content_type: JSCONTACT_CONTENT_TYPE,
        revision: index + 2,
        tombstone: false,
        payload: contact.raw,
      })),
    ],
  };
}

/** Leaves the browser holding a device, the way a sign-in would have. */
export async function enrolDevice(
  password: string,
  state: DeviceState = aDeviceState(),
): Promise<void> {
  await saveDevice(state, password);
}

/** Leaves the browser holding a vault copy under `password`. */
export async function storeSnapshot(
  password: string,
  vault: LocalVault = aSnapshot(),
): Promise<void> {
  openLocalStore(password);
  const stored = await saveLocalVault(vault);
  closeLocalStore();
  if (!stored) {
    throw new Error("the vault fixture was not stored, so the test would not mean anything");
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
  closeOutbox();
  closeLocalStore();
  localStorage.clear();
  sessionStorage.clear();
  // A fresh factory per test, so one test's snapshot is never another's.
  globalThis.indexedDB = new IDBFactory();
});
