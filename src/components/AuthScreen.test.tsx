// @vitest-environment jsdom
/**
 * The registration and sign-in screen, mounted on its own.
 *
 * Every value it shows and every action it takes belongs to `App`, so what is
 * under test is the wiring: which of the three forms a given set of props
 * draws, that each one reports back through the callback it was given, and that
 * the server gate in front of them all comes first.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "../test/dom";
import { AuthScreen, type Mode } from "./AuthScreen";
import type { DeviceMetadata } from "../lib/storage";

const SERVER = "https://vault.example.com";

const STORED: DeviceMetadata = {
  server: SERVER,
  username: "ada",
  account_id: "account-1",
  collection_id: "collection-1",
  device_id: "device-1",
};

type Props = Parameters<typeof AuthScreen>[0];

/**
 * Every callback as a spy and every value at its resting state, so a test names
 * only the props it is about.
 */
function mount(overrides: Partial<Props> = {}) {
  const spies = {
    saveDomain: vi.fn<(value: string) => boolean>(() => true),
    onModeChange: vi.fn<(mode: Mode) => void>(),
    onUsernameChange: vi.fn<(value: string) => void>(),
    onPasswordChange: vi.fn<(value: string) => void>(),
    onConfirmPasswordChange: vi.fn<(value: string) => void>(),
    onUnlock: vi.fn<(event: { preventDefault: () => void }) => void>((event) =>
      event.preventDefault(),
    ),
    onRegister: vi.fn<(event: { preventDefault: () => void }) => void>((event) =>
      event.preventDefault(),
    ),
    onPairJoin: vi.fn<(event: { preventDefault: () => void }) => void>((event) =>
      event.preventDefault(),
    ),
    onConfirmSignOut: vi.fn<() => void>(),
    onSignOut: vi.fn<() => void>(),
    onCloseSignOut: vi.fn<() => void>(),
    onGoToRecover: vi.fn<() => void>(),
  };
  const props: Props = {
    connectionDomain: SERVER,
    error: null,
    mode: "register",
    stored: null,
    locked: false,
    username: "",
    password: "",
    confirmPassword: "",
    busy: false,
    signingOut: false,
    unlockPasswordRef: { current: null },
    ...spies,
    ...overrides,
  };
  const view = render(<AuthScreen {...props} />);
  return {
    ...spies,
    rerender: (next: Partial<Props>) => view.rerender(<AuthScreen {...props} {...next} />),
  };
}

describe("AuthScreen, the unlock screen", () => {
  // Each form's fields are `required`, and jsdom enforces that before it will
  // submit, so a submission test mounts with the values already in the props
  // `App` would be holding by then rather than typing them in here.
  it("unlocks the device it is holding", () => {
    const { onUnlock, onPasswordChange } = mount({
      locked: true,
      stored: STORED,
      password: "hunter2",
    });

    expect(screen.getByText("ada")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter22" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    expect(onPasswordChange.mock.calls).toEqual([["hunter22"]]);
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it("holds the unlock while a derivation is running", () => {
    mount({ locked: true, stored: STORED, busy: true });

    const submit = screen.getByRole("button", { name: "Please wait…" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports a failed unlock to a screen reader", () => {
    mount({ locked: true, stored: STORED, error: "That password is not right." });

    expect(screen.getByRole("alert").textContent).toBe("That password is not right.");
  });

  it("asks before signing out, and only signs out on the dialog", () => {
    const { onConfirmSignOut, onSignOut } = mount({ locked: true, stored: STORED });

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onConfirmSignOut).toHaveBeenCalledTimes(1);
    // The dialog is `App`'s to open, so nothing has gone yet.
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("signs out from an icon button in the account card, named for screen readers", () => {
    mount({ locked: true, stored: STORED });

    const signOut = screen.getByRole("button", { name: "Sign out" });

    expect(signOut.textContent).toBe("");
    expect(signOut.parentElement?.textContent).toContain(STORED.username);
  });

  it("closes the dialog before signing out, so the screen is not torn away first", () => {
    const calls: string[] = [];
    mount({
      locked: true,
      stored: STORED,
      signingOut: true,
      onCloseSignOut: vi.fn<() => void>(() => calls.push("close")),
      onSignOut: vi.fn<() => void>(() => calls.push("out")),
    });

    const dialog = screen.getByRole("dialog", { name: "Sign out" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));

    expect(calls).toEqual(["close", "out"]);
  });
});

describe("AuthScreen, setting a device up", () => {
  it("offers both methods and reports the one chosen", () => {
    const { onModeChange } = mount();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Create account", "Set up device"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);

    fireEvent.click(screen.getByRole("tab", { name: "Set up device" }));
    expect(onModeChange.mock.calls).toEqual([["signin"]]);
  });

  it("registers an account from the username and both passwords", () => {
    const { onRegister, onUsernameChange, onConfirmPasswordChange } = mount({
      username: "ada",
      password: "hunter2",
      confirmPassword: "hunter2",
    });

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "grace" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "hunter3" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(onUsernameChange.mock.calls).toEqual([["grace"]]);
    expect(onConfirmPasswordChange.mock.calls).toEqual([["hunter3"]]);
    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  it("rates the password being chosen, and says nothing about an empty one", () => {
    const { rerender } = mount();

    expect(screen.queryByText(/Password strength/)).toBeNull();

    rerender({ password: "short" });
    expect(screen.getByText("Password strength: Weak")).not.toBeNull();

    rerender({ password: "Correct-Horse-9" });
    expect(screen.getByText("Password strength: Strong")).not.toBeNull();
  });

  it("starts a pairing from the username alone", () => {
    const { onPairJoin } = mount({ mode: "signin", username: "ada" });

    expect(screen.queryByLabelText("Confirm password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start pairing →" }));

    expect(onPairJoin).toHaveBeenCalledTimes(1);
  });

  it("hands the recovery words off to their own screen", () => {
    const { onGoToRecover } = mount({ mode: "signin" });

    fireEvent.click(screen.getByRole("button", { name: "Restore with recovery words →" }));

    expect(onGoToRecover).toHaveBeenCalledTimes(1);
  });
});

describe("AuthScreen, the server in front of it", () => {
  it("asks for a server before offering any sign-in method", () => {
    const { saveDomain } = mount({ connectionDomain: "" });

    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.change(screen.getByLabelText("Server address"), {
      target: { value: "vault.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(saveDomain.mock.calls).toEqual([["vault.example.com"]]);
  });

  it("asks for a server before unlocking a device it already holds", () => {
    mount({ connectionDomain: "", locked: true, stored: STORED });

    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.getByLabelText("Server address")).not.toBeNull();
  });

  it("changes a configured server, and keeps the dialog open on a bad address", () => {
    const saveDomain = vi.fn<(value: string) => boolean>(() => false);
    mount({ saveDomain });

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const dialog = screen.getByRole("dialog", { name: "Change server" });
    fireEvent.change(within(dialog).getByLabelText("Server address"), {
      target: { value: "not a server" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save server" }));

    expect(saveDomain.mock.calls).toEqual([["not a server"]]);
    expect(within(dialog).getByRole("alert").textContent).toBe("Enter a valid server address.");
  });
});
