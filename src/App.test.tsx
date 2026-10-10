// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import {
  aContact,
  aSnapshot,
  enrolDevice,
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
