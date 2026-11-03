// @vitest-environment jsdom
/**
 * The screen shown while the first vault read of a session is in flight.
 *
 * The read fetches and decrypts the whole collection before anything can be
 * listed, so what is covered here is that the shell is not rendered empty in
 * the meantime, and that the stage reported by the read is what the screen
 * says.
 *
 * `lib/client` is faked as in the editing suite: an online session needs an
 * OPAQUE exchange only the server can answer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import { aContact, enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import type { VaultProgress } from "./lib/client";

const PASSWORD = "correct horse battery";

/** Held open so the screen can be asserted on mid-read. */
let release: (() => void) | null = null;
let report: ((progress: VaultProgress) => void) | null = null;

vi.mock("./lib/client", async () => {
  const actual = await vi.importActual<typeof import("./lib/client")>("./lib/client");
  return {
    ...actual,
    loginAccount: async (state: unknown) => ({
      state,
      collectionKey: "k",
      token: "t",
      latestRevision: 1,
      keyEpoch: 0,
      manifestSeq: 1,
    }),
    listVault: async (_session: unknown, onProgress?: (progress: VaultProgress) => void) => {
      report = onProgress ?? null;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        addressBooks: [{ id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" }],
        contacts: [aContact("Ada Lovelace", "c1")],
        calendars: [],
        calendarEvents: [],
        notes: [],
        notebooks: [],
        bookmarks: [],
        bookmarkCollections: [],
        accountSettings: DEFAULT_ACCOUNT_SETTINGS,
        unopened: 0,
      };
    },
    ensureDefaultAddressBook: async (_session: unknown, books: unknown) => books,
  };
});

import App from "./App";

async function startUnlock() {
  setConnectionDomain();
  await enrolDevice(PASSWORD);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("Decrypting your Sealbook");
  // Queued changes are sent first, which opens the stored queue before the read.
  await waitFor(() => expect(release).not.toBeNull());
}

beforeEach(() => {
  release = null;
  report = null;
});

describe("the first vault read", () => {
  it("holds the decrypting screen until the vault is listed", async () => {
    await startUnlock();

    // The shell's tabs would otherwise be on screen with every list empty.
    expect(screen.queryByRole("button", { name: /Settings/u })).toBeNull();

    release!();

    expect(await screen.findByText("Ada Lovelace")).toBeDefined();
    expect(screen.queryByText("Decrypting your Sealbook")).toBeNull();
  });

  it("says which stage the read has reached", async () => {
    await startUnlock();

    expect(report).not.toBeNull();
    report!({ stage: "verifying" });
    expect(await screen.findByText(/tampered with/u)).toBeDefined();

    report!({ stage: "decrypting", count: 1 });
    expect(await screen.findByText("Decrypting 1 item…")).toBeDefined();

    release!();
    await screen.findByText("Ada Lovelace");
  });
});
