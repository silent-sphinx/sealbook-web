// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import {
  aContact,
  aSnapshot,
  enrolDevice,
  setConnectionDomain,
  setOnline,
  storeSnapshot,
} from "./test/vault";
import App from "./App";

const PASSWORD = "correct horse battery";

function unlockWith(password: string) {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
}

/** The error the unlock form shows, or null while it is showing none. */
function unlockError(): string | null {
  return screen.queryByRole("alert")?.textContent ?? null;
}

describe("the lock screen", () => {
  it("asks for the password of the device this browser is holding", async () => {
    await enrolDevice(PASSWORD);
    render(<App />);

    // Taken from the stored metadata, which is not secret and survives the lock.
    expect(await screen.findByText("ada")).toBeDefined();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeDefined();
  });

  it("does not offer an unlock when no device is enrolled", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
  });
});

describe("unlocking offline", () => {
  it("opens the vault from the stored snapshot", async () => {
    await enrolDevice(PASSWORD);
    await storeSnapshot(PASSWORD, aSnapshot([aContact("Ada Lovelace")]));
    setOnline(false);

    render(<App />);
    unlockWith(PASSWORD);

    // The whole point of the snapshot: the vault opens with no server at all.
    expect(await screen.findByText("Ada Lovelace")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
  });

  it("says what to do when there is no snapshot to open", async () => {
    await enrolDevice(PASSWORD);
    setOnline(false);

    render(<App />);
    unlockWith(PASSWORD);

    // Rather than an empty vault, which would read as having lost the data.
    await waitFor(() => {
      expect(unlockError()).toContain("Connect to the server once before using the vault offline");
    });
    expect(screen.getByRole("button", { name: "Unlock" })).toBeDefined();
  });

  it("keeps the vault shut on the wrong password", async () => {
    await enrolDevice(PASSWORD);
    await storeSnapshot(PASSWORD, aSnapshot([aContact("Ada Lovelace")]));
    setOnline(false);

    render(<App />);
    unlockWith("not the password");

    await waitFor(() => {
      expect(unlockError()).not.toBeNull();
    });
    // The snapshot is encrypted under the password, so a wrong one cannot read
    // it even though the record is right there.
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeDefined();
  });

  it("will not open a snapshot a different password wrote", async () => {
    await enrolDevice(PASSWORD);
    await storeSnapshot("a different password", aSnapshot([aContact("Ada Lovelace")]));
    setOnline(false);

    render(<App />);
    unlockWith(PASSWORD);

    // The device record opens, so the password is right; the snapshot predates
    // a password change and is not readable under it.
    await waitFor(() => {
      expect(unlockError()).toContain("Connect to the server once before using the vault offline");
    });
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
  });
});

describe("the recovery screen", () => {
  function goToRecovery() {
    // The recovery method lives under the existing-account tab, not account creation.
    fireEvent.click(screen.getByRole("tab", { name: "Set up device" }));
    fireEvent.click(screen.getByRole("button", { name: /Restore with recovery words/ }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a new password" } });
  }

  function restore() {
    fireEvent.click(screen.getByRole("button", { name: "Restore vault on this device" }));
  }

  it("rejects a phrase holding a word that is not on the BIP-39 list", async () => {
    setConnectionDomain();
    render(<App />);
    goToRecovery();

    const phrase = Array(23).fill("abandon").concat("notaword").join(" ");
    fireEvent.change(screen.getByLabelText("Recovery words"), { target: { value: phrase } });
    restore();

    // Caught before recovery is attempted, so a typo never reaches the server.
    expect(
      await screen.findByText(/"notaword" is not a valid BIP-39 recovery word/),
    ).toBeDefined();
  });

  it("asks for all 24 words when fewer are entered", async () => {
    setConnectionDomain();
    render(<App />);
    goToRecovery();

    fireEvent.change(screen.getByLabelText("Recovery words"), {
      target: { value: "abandon ability able" },
    });
    restore();

    expect(
      await screen.findByText(/Please enter all 24 words \(3 entered so far\)/),
    ).toBeDefined();
  });
});

// Mirrors App.tsx: the vault warns one minute before locking and locks after
// fifteen minutes of inactivity.
const IDLE_WARNING_MS = 14 * 60 * 1000;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

// Captured before any fake timers are installed, so the unlock's off-thread
// crypto can be given real wall-clock while the fake clock drives the idle timers.
const realSetTimeout = globalThis.setTimeout.bind(globalThis);

describe("the idle lock", () => {
  beforeEach(() => {
    // The idle timers are faked; setImmediate stays real so the unlock's own
    // snapshot decryption can settle between advances of the clock.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    // lock() revokes the server session on its way out, and there is none here.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server in this test")));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Waits real time so the off-thread crypto can settle without advancing the fake clock. */
  async function settle(ms = 50) {
    await act(async () => {
      await new Promise((resolve) => realSetTimeout(resolve, ms));
    });
  }

  async function openOfflineVault() {
    await enrolDevice(PASSWORD);
    await storeSnapshot(PASSWORD, aSnapshot([aContact("Ada Lovelace")]));
    setOnline(false);

    render(<App />);
    unlockWith(PASSWORD);
    for (let i = 0; i < 40 && screen.queryByText("Ada Lovelace") === null; i += 1) {
      await settle();
    }
    expect(screen.getByText("Ada Lovelace")).toBeDefined();
  }

  it("warns, then locks the vault and clears the password at the timeout", async () => {
    await openOfflineVault();

    // A minute out the countdown shows while the vault is still open.
    await act(async () => {
      vi.advanceTimersByTime(IDLE_WARNING_MS);
    });
    expect(screen.getByText("Locking soon")).toBeDefined();
    expect(screen.queryByText("Ada Lovelace")).not.toBeNull();

    // At the timeout the lock screen returns and the password field is empty.
    await act(async () => {
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS - IDLE_WARNING_MS);
    });
    await settle();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeDefined();
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("resets the idle timer on activity", async () => {
    await openOfflineVault();

    // Just short of the warning, a keystroke, then the same span again: without
    // the reset the warning would already be up.
    await act(async () => {
      vi.advanceTimersByTime(IDLE_WARNING_MS - 1000);
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown"));
    });
    await act(async () => {
      vi.advanceTimersByTime(IDLE_WARNING_MS - 1000);
    });

    expect(screen.queryByText("Locking soon")).toBeNull();
    expect(screen.queryByText("Ada Lovelace")).not.toBeNull();
  });

  it("still locks after the warning is dismissed with Stay signed in", async () => {
    await openOfflineVault();

    await act(async () => {
      vi.advanceTimersByTime(IDLE_WARNING_MS);
    });
    fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    expect(screen.queryByText("Locking soon")).toBeNull();

    // Dismissing the warning does not reset the lock timer, so the rest of the
    // minute still ends in a lock.
    await act(async () => {
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS - IDLE_WARNING_MS);
    });
    await settle();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeDefined();
    expect(screen.queryByText("Ada Lovelace")).toBeNull();
  });

  it("locks at the timeout chosen for this device", async () => {
    localStorage.setItem("sealbook.auto-lock-minutes", "1");
    await openOfflineVault();

    await act(async () => {
      vi.advanceTimersByTime(30 * 1000);
    });
    expect(screen.getByText("Locking soon")).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(30 * 1000);
    });
    await settle();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeDefined();
  });

  it("never locks when the timeout is off", async () => {
    localStorage.setItem("sealbook.auto-lock-minutes", "0");
    await openOfflineVault();

    await act(async () => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(screen.queryByText("Locking soon")).toBeNull();
    expect(screen.queryByText("Ada Lovelace")).not.toBeNull();
  });
});
