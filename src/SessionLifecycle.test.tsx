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
 * `loginAccount` has answered its edits only queue. A reconnect that updates
 * neither would leave them queued behind an offline banner.
 *
 * `lib/client` is faked as in the contact suites: an online session needs an
 * OPAQUE exchange only the server can answer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "./test/dom";
import {
  aContact,
  aSnapshot,
  enrolDevice,
  setConnectionDomain,
  setOnline,
  storeSnapshot,
} from "./test/vault";
import { currentOutbox, mutateOutbox } from "./lib/outbox";
import { coreOutboxSettle, type PendingWrite } from "./lib/wasm";
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
/** What each flush was handed, in place of a server to send it to. */
let flushed: PendingWrite[][] = [];

vi.mock("./lib/client", async () => {
  const actual = await vi.importActual<typeof import("./lib/client")>("./lib/client");
  return {
    ...actual,
    loginAccount,
    revokeSession,
    flushOutbox: async () => {
      const writes = currentOutbox().writes;
      flushed.push(writes);
      await mutateOutbox((outbox) => coreOutboxSettle(outbox, writes.map((write) => write.id)));
      return { refused: new Map(), settled: new Map() };
    },
    listVault: async () => ({
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
  flushed = [];
  served = [aContact("Grace Hopper", "c2")];
  loginAccount.mockImplementation(async (state) => aSession(state));
  revokeSession.mockResolvedValue(undefined);
});

describe("an offline vault", () => {
  it("says so, and keeps what needs the server out of reach", async () => {
    await openOffline([aContact("Ada Lovelace", "c1")]);

    expect(screen.getByRole("status").textContent).toContain("You're offline");
    expect(screen.queryByRole("button", { name: "Add device" })).toBeNull();
    expect(screen.getByRole("button", { name: "New contact" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Settings/u }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("button", { name: "Sign out…" })).toBeDefined();
  });

  it("queues an edit, then sends it once the browser comes back", async () => {
    await openOffline([aContact("Ada Lovelace", "c1")]);

    fireEvent.click(screen.getByRole("button", { name: "New contact" }));
    fireEvent.change(await screen.findByLabelText("Full name"), {
      target: { value: "Katherine Johnson" },
    });
    fireEvent.click(
      screen
        .getAllByRole("button", { name: "Add contact" })
        .find((button) => button.getAttribute("type") === "submit")!,
    );

    expect(await screen.findByText("1 change waiting to sync.", { exact: false })).toBeDefined();
    expect(screen.getAllByText("Katherine Johnson").length).toBeGreaterThan(0);
    expect(flushed).toEqual([]);

    goOnline();

    await waitFor(() => expect(flushed.length).toBeGreaterThan(0));
    const sent = flushed[0]!;
    expect(sent).toHaveLength(1);
    expect(sent[0]!.base).toBeUndefined();
    expect(JSON.parse(sent[0]!.payload)).toMatchObject({ name: { full: "Katherine Johnson" } });
    await waitFor(() => expect(screen.queryByText(/waiting to sync/u)).toBeNull());
  });

  it("logs in again when the browser comes back, and lists what the server has", async () => {
    await openOffline([aContact("Ada Lovelace", "c1")]);

    goOnline();

    await waitFor(() => expect(loginAccount).toHaveBeenCalledTimes(1));
    // The server's listing replaces the snapshot's, rather than being merged
    // into it: the snapshot is this device's stale copy, not a second source.
    expect(await screen.findByText("Grace Hopper")).toBeDefined();
    await waitFor(() => expect(screen.queryByText("Ada Lovelace")).toBeNull());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Add device" })).toBeDefined();
  });

  it("keeps showing the snapshot when the server is still unreachable", async () => {
    loginAccount.mockRejectedValue(new Error("Failed to fetch"));
    await openOffline([aContact("Ada Lovelace", "c1")]);

    goOnline();

    await waitFor(() => expect(loginAccount).toHaveBeenCalledTimes(1));
    // Rather than an empty vault or a lock screen, which would both read as
    // having lost the data this device still holds.
    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain("You're offline");
  });
});

describe("going offline with the vault open", () => {
  it("keeps the vault readable and shuts off what needs the server", async () => {
    await openOnline();

    goOffline();
    fireEvent.click(screen.getByRole("button", { name: /Settings/u }));
    fireEvent.click(await screen.findByRole("button", { name: "Devices" }));
    await screen.findByText(/needs a connection to the server/u);

    const tabs = screen.getByRole("navigation", { name: "Main Navigation" });
    fireEvent.click(within(tabs).getByRole("button", { name: "Contacts" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out…" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Sign out" })).getByRole("button", { name: "Sign out" }),
    );

    // Not a lock: the stored device is gone, so the lock screen has nothing to
    // ask for and the app is back to setting one up.
    expect(await screen.findByLabelText("Username")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
    expect(await loadDeviceMetadata()).toBeNull();
    expect(screen.queryByText("Grace Hopper")).toBeNull();
  });
});
