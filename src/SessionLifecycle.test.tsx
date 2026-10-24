// @vitest-environment jsdom
/**
 * The session lifecycle past the unlock, mounted end to end.
 *
 * `App.test.tsx` covers the way in and the idle lock. What is left is what
 * happens to a session already open: the reconnect that upgrades an offline
 * vault to a live one, the lock that keeps this device enrolled, and the sign
 * out that does not.
 *
 * The distinction the reconnect turns on is not visible from the lock screen:
 * an offline session holds no collection key and no token, so until
 * `loginAccount` has answered the vault is read-only and Settings is shut. A
 * reconnect that updates neither would leave a live account behind an offline
 * banner for the rest of the session.
 *
 * `lib/client` is faked as in the contact suites: an online session needs an
 * OPAQUE exchange only the server can answer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import {
  aContact,
  aSnapshot,
  enrolDevice,
  setConnectionDomain,
  setOnline,
  snapshotWritten,
  storeSnapshot,
  storedSnapshot,
} from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import { loadDeviceMetadata } from "./lib/storage";
import type { Contact, DeviceState } from "./lib/types";
import type { Session } from "./lib/client";

const PASSWORD = "correct horse battery";

/** What the server would answer with, as against what the snapshot holds. */
let served: Contact[] = [];
const loginAccount = vi.hoisted(() => vi.fn<(state: DeviceState, password: string) => Promise<Session>>());
const revokeSession = vi.hoisted(() => vi.fn<(session: Session) => Promise<void>>());

vi.mock("./lib/client", async () => {
  const actual = await vi.importActual<typeof import("./lib/client")>("./lib/client");
  return {
    ...actual,
    loginAccount,
    revokeSession,
    listVault: async () => ({
      sealed: [],
      addressBooks: [{ id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" }],
      contacts: [...served],
      calendars: [],
      calendarEvents: [],
      notes: [],
      notebooks: [],
      bookmarks: [],
      bookmarkCollections: [],
      accountSettings: DEFAULT_ACCOUNT_SETTINGS,
      unopened: 0,
    }),
    ensureDefaultAddressBook: async (_session: unknown, books: unknown) => books,
    listDevices: async () => [],
  };
});

import App from "./App";

function aSession(state: DeviceState): Session {
  return { state, collectionKey: "k", token: "t", latestRevision: 1, keyEpoch: 0, manifestSeq: 1 } as Session;
}

function unlock() {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
}

/** Leaves the vault open from the stored snapshot, with no server reached. */
async function openOffline(snapshotContacts: Contact[]) {
  await enrolDevice(PASSWORD);
  await storeSnapshot(PASSWORD, aSnapshot(snapshotContacts));
  setOnline(false);
  render(<App />);
  await screen.findByRole("button", { name: "Unlock" });
  unlock();
  await screen.findByText(snapshotContacts[0]!.name);
}

/** Leaves the vault open against the faked server. */
async function openOnline() {
  await enrolDevice(PASSWORD);
  setConnectionDomain();
  render(<App />);
  await screen.findByRole("button", { name: "Unlock" });
  unlock();
  await screen.findByText(served[0]!.name);
  // The contacts are on screen one derivation before the unlock is finished.
  await snapshotWritten();
}

function goOnline() {
  setOnline(true);
  window.dispatchEvent(new Event("online"));
}

function goOffline() {
  setOnline(false);
  window.dispatchEvent(new Event("offline"));
}

beforeEach(() => {
  vi.clearAllMocks();
  served = [aContact("Grace Hopper", "c2")];
  loginAccount.mockImplementation(async (state) => aSession(state));
  revokeSession.mockResolvedValue(undefined);
});

describe("an offline vault", () => {
  it("says so, and keeps the editing controls out of reach", async () => {
    await openOffline([aContact("Ada Lovelace", "c1")]);

    expect(screen.getByRole("status").textContent).toContain("App is offline");
    // Both reach the server, so neither is offered while it cannot be reached.
    expect(screen.queryByRole("button", { name: "Add device" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Settings/u }));
    expect(await screen.findByText("Settings are unavailable while offline.")).toBeDefined();
  });

  it("logs in again when the browser comes back, and lists what the server has", async () => {
    await openOffline([aContact("Ada Lovelace", "c1")]);
    const stale = await storedSnapshot();

    goOnline();

    await waitFor(() => expect(loginAccount).toHaveBeenCalledTimes(1));
    // The server's listing replaces the snapshot's, rather than being merged
    // into it: the snapshot is this device's stale copy, not a second source.
    expect(await screen.findByText("Grace Hopper")).toBeDefined();
    await waitFor(() => expect(screen.queryByText("Ada Lovelace")).toBeNull());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Add device" })).toBeDefined();
    // The reconnect rewrites the snapshot behind the listing it has already
    // shown, and the next test unlocks twice over whatever thread is left.
    await snapshotWritten(stale);
  });

  it("keeps showing the snapshot when the server is still unreachable", async () => {
    loginAccount.mockRejectedValue(new Error("Failed to fetch"));
    await openOffline([aContact("Ada Lovelace", "c1")]);

    goOnline();

    await waitFor(() => expect(loginAccount).toHaveBeenCalledTimes(1));
    // Rather than an empty vault or a lock screen, which would both read as
    // having lost the data this device still holds.
    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain("App is offline");
  });
});

describe("going offline with the vault open", () => {
  it("keeps the vault readable and shuts the writes off", async () => {
    await openOnline();

    goOffline();
    fireEvent.click(screen.getByRole("button", { name: /Settings/u }));
    await screen.findByText("Settings are unavailable while offline.");

    fireEvent.click(screen.getByRole("button", { name: /Contacts/u }));
    expect(await screen.findByText("Grace Hopper")).toBeDefined();
  });
});

describe("refreshing", () => {
  it("re-reads the vault and shows what the server now has", async () => {
    await openOnline();

    served = [aContact("Katherine Johnson", "c3")];
    fireEvent.click(screen.getByRole("button", { name: "Refresh vault" }));

    expect(await screen.findByText("Katherine Johnson")).toBeDefined();
    await waitFor(() => expect(screen.queryByText("Grace Hopper")).toBeNull());
  });

  it("is not offered while offline", async () => {
    await openOffline([aContact("Ada Lovelace", "c1")]);

    expect(screen.queryByRole("button", { name: "Refresh vault" })).toBeNull();
  });
});

describe("locking", () => {
  it("clears the vault but keeps this device enrolled", async () => {
    await openOnline();

    fireEvent.click(screen.getByRole("button", { name: "Lock" }));

    // The device record stays, so the way back in is the password alone.
    expect(await screen.findByRole("button", { name: "Unlock" })).toBeDefined();
    expect(screen.queryByText("Grace Hopper")).toBeNull();
    expect(await loadDeviceMetadata()).not.toBeNull();
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    // The server session is no use to anyone once the vault is shut.
    await waitFor(() => expect(revokeSession).toHaveBeenCalledTimes(1));
  });

  it("opens again from the same stored device", async () => {
    await openOnline();
    fireEvent.click(screen.getByRole("button", { name: "Lock" }));
    await screen.findByRole("button", { name: "Unlock" });

    unlock();

    expect(await screen.findByText("Grace Hopper")).toBeDefined();
    expect(loginAccount).toHaveBeenCalledTimes(2);
  });
});

describe("signing out", () => {
  it("takes this browser's keys with it, so there is nothing left to unlock", async () => {
    await openOnline();

    fireEvent.click(screen.getByRole("button", { name: /Settings/u }));
    fireEvent.click(await screen.findByRole("button", { name: /Sign Out/u }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out…" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    // Not a lock: the stored device is gone, so the lock screen has nothing to
    // ask for and the app is back to setting one up.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull());
    expect(await loadDeviceMetadata()).toBeNull();
    expect(screen.queryByText("Grace Hopper")).toBeNull();
  });
});
