// @vitest-environment jsdom
/**
 * The account pages of `SettingsView`, mounted over a faked `lib/client`.
 *
 * Every flow here ends in `onPersistSession`, which re-saves this browser's
 * device record encrypted under a password. Which password it is handed is the
 * part worth pinning: a change that re-saves under the old one leaves the
 * device unopenable on the next unlock, and nothing on screen says so.
 *
 * `changeUsername`, `changePassword`, `revokeDevice` and `rotatePhrase` each
 * start with an OPAQUE exchange only the server can answer, so they are faked
 * rather than driven. What is under test is the view: which guards refuse
 * before a request is made, what each call is given, and what is cleared after.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "./test/dom";
import { aDeviceState } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import type { DeviceSummary, Session } from "./lib/client";

const THIS_DEVICE = "device-1";
const OTHER_DEVICE = "device-2";

type Rotation = { session: Session; phrase: string };

const changeUsername = vi.hoisted(() =>
  vi.fn<(session: Session, name: string, password: string) => Promise<Session>>(),
);
const changePassword = vi.hoisted(() =>
  vi.fn<(session: Session, current: string, next: string) => Promise<Session>>(),
);
const deleteAccount = vi.hoisted(() => vi.fn<(session: Session, password: string) => Promise<void>>());
const listDevices = vi.hoisted(() => vi.fn<(session: Session) => Promise<DeviceSummary[]>>());
const revokeDevice = vi.hoisted(() =>
  vi.fn<(session: Session, deviceId: string, password: string, onProgress?: unknown) => Promise<Rotation>>(),
);
const rotatePhrase = vi.hoisted(() =>
  vi.fn<(session: Session, password: string, onProgress?: unknown) => Promise<Rotation>>(),
);
const clearDevice = vi.hoisted(() => vi.fn<() => Promise<void>>());

vi.mock("./lib/client", async () => {
  const actual = await vi.importActual<typeof import("./lib/client")>("./lib/client");
  return { ...actual, changeUsername, changePassword, deleteAccount, listDevices, revokeDevice, rotatePhrase };
});

vi.mock("./lib/storage", async () => {
  const actual = await vi.importActual<typeof import("./lib/storage")>("./lib/storage");
  return { ...actual, clearDevice };
});

import { SettingsView } from "./components/SettingsView";

const session = {
  state: aDeviceState({ username: "ada", device_id: THIS_DEVICE }),
  collectionKey: "k",
  token: "t",
  latestRevision: 1,
  keyEpoch: 0,
  manifestSeq: 1,
} as Session;

/** The session each rotation hands back, so a test can tell it from the one it started with. */
const rotated = { ...session, keyEpoch: 1 } as Session;

function aDeviceSummary(device_id: string): DeviceSummary {
  return { device_id, mldsa_pk: "", ed25519_pk: "", xwing_hpke_pk: "" };
}

const handlers = {
  onSessionUpdate: vi.fn<(updated: Session) => void>(),
  onPersistSession: vi.fn<(updated: Session, password: string) => Promise<void>>(),
  onAccountDeleted: vi.fn<() => void>(),
  onSignOut: vi.fn<() => void>(),
  onRefresh: vi.fn<() => Promise<void>>(),
};

function mount(page: string) {
  render(
    <SettingsView
      session={session}
      contacts={[]}
      addressBooks={[]}
      calendars={[]}
      calendarEvents={[]}
      notes={[]}
      notebooks={[]}
      bookmarks={[]}
      bookmarkCollections={[]}
      tasks={[]}
      taskLists={[]}
      onSessionUpdate={handlers.onSessionUpdate}
      onPersistSession={handlers.onPersistSession}
      onAccountDeleted={handlers.onAccountDeleted}
      onSignOut={handlers.onSignOut}
      onRefresh={handlers.onRefresh}
      timezone="Europe/London"
      onTimezoneChange={() => undefined}
      accountSettings={DEFAULT_ACCOUNT_SETTINGS}
      onSaveAccountSettings={async () => undefined}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: new RegExp(page, "u") }));
}

/** The one message the page under test shows, or null while it shows none. */
function message(): string | null {
  return screen.queryByRole("alert")?.textContent ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  handlers.onPersistSession.mockResolvedValue(undefined);
  handlers.onRefresh.mockResolvedValue(undefined);
  listDevices.mockResolvedValue([aDeviceSummary(THIS_DEVICE)]);
});

describe("changing the username", () => {
  function fill(name: string, password: string) {
    fireEvent.change(screen.getByLabelText("New Username"), { target: { value: name } });
    fireEvent.change(screen.getByLabelText("Current Password (to confirm)"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Update Username" }));
  }

  it("refuses the name the account already has", async () => {
    mount("Update Your Username");
    fill("ada", "correct horse battery");

    expect(await screen.findByText("New username cannot be identical to current username.")).toBeDefined();
    expect(changeUsername).not.toHaveBeenCalled();
  });

  it("refuses a name outside the length the server accepts", async () => {
    mount("Update Your Username");
    fill("ad", "correct horse battery");

    expect(await screen.findByText("Username must be between 3 and 64 characters.")).toBeDefined();

    fill("a".repeat(65), "correct horse battery");
    expect(await screen.findByText("Username must be between 3 and 64 characters.")).toBeDefined();
    expect(changeUsername).not.toHaveBeenCalled();
  });

  it("persists the device under the password that was confirmed", async () => {
    changeUsername.mockResolvedValue(rotated);
    mount("Update Your Username");
    fill("ada.lovelace", "correct horse battery");

    await waitFor(() => expect(changeUsername).toHaveBeenCalledWith(session, "ada.lovelace", "correct horse battery"));
    expect(handlers.onPersistSession).toHaveBeenCalledWith(rotated, "correct horse battery");
    expect(handlers.onSessionUpdate).toHaveBeenCalledWith(rotated);
    expect(await screen.findByText('Username successfully updated to "ada.lovelace".')).toBeDefined();
    // Cleared, so the password is not left sitting in a live input.
    expect((screen.getByLabelText("Current Password (to confirm)") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("New Username") as HTMLInputElement).value).toBe("");
  });

  it("keeps the session as it was when the server refuses", async () => {
    changeUsername.mockRejectedValue(new Error("username taken"));
    mount("Update Your Username");
    fill("grace", "correct horse battery");

    // Reported through `friendlyError`, so the server's wording never reaches
    // the page raw.
    expect(await screen.findByText("That name is taken.")).toBeDefined();
    expect(handlers.onPersistSession).not.toHaveBeenCalled();
    expect(handlers.onSessionUpdate).not.toHaveBeenCalled();
  });
});

describe("changing the password", () => {
  function fill(current: string, next: string, confirm: string) {
    fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: current } });
    fireEvent.change(screen.getByLabelText("New Password"), { target: { value: next } });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), { target: { value: confirm } });
    fireEvent.click(screen.getByRole("button", { name: "Change Password" }));
  }

  it("refuses one shorter than the minimum", async () => {
    mount("Change Your Password");
    fill("correct horse battery", "short", "short");

    expect(await screen.findByText("Password must be at least 8 characters long.")).toBeDefined();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("refuses one the confirmation does not match", async () => {
    mount("Change Your Password");
    fill("correct horse battery", "a new password", "a new pasword");

    expect(await screen.findByText("New passwords do not match.")).toBeDefined();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("re-saves this device under the new password, not the old one", async () => {
    changePassword.mockResolvedValue(rotated);
    mount("Change Your Password");
    fill("correct horse battery", "a new password", "a new password");

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith(session, "correct horse battery", "a new password"),
    );
    // Under the old password the stored record would not open on the next unlock.
    expect(handlers.onPersistSession).toHaveBeenCalledWith(rotated, "a new password");
    expect(handlers.onSessionUpdate).toHaveBeenCalledWith(rotated);
    expect(await screen.findByText(/Password updated successfully/u)).toBeDefined();
    expect((screen.getByLabelText("New Password") as HTMLInputElement).value).toBe("");
  });
});

describe("revoking another device", () => {
  beforeEach(() => {
    listDevices.mockResolvedValue([aDeviceSummary(THIS_DEVICE), aDeviceSummary(OTHER_DEVICE)]);
  });

  const aPhrase = () => Array.from({ length: 24 }, (_, index) => `word${index + 1}`).join(" ");

  async function revoke(password: string) {
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke device" });
    fireEvent.change(within(dialog).getByLabelText("Confirm your password"), { target: { value: password } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke device" }));
  }

  it("offers no revoke for the device being used", async () => {
    mount("Manage Paired Devices");

    expect(await screen.findByText("This device")).toBeDefined();
    // One other device, so exactly one button: this one cannot revoke itself.
    expect(screen.getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
  });

  it("asks for the password before it will rotate", async () => {
    mount("Manage Paired Devices");
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Revoke device" })).getByRole("button", { name: "Revoke device" }));

    expect(await screen.findByText("Enter your password to confirm.")).toBeDefined();
    expect(revokeDevice).not.toHaveBeenCalled();
  });

  it("rotates the vault key away from the revoked device", async () => {
    revokeDevice.mockResolvedValue({ session: rotated, phrase: aPhrase() });
    mount("Manage Paired Devices");

    await revoke("correct horse battery");

    await waitFor(() =>
      expect(revokeDevice).toHaveBeenCalledWith(session, OTHER_DEVICE, "correct horse battery", expect.any(Function)),
    );
    await waitFor(() => expect(message()).toContain("your previous one no longer works"));
    expect(handlers.onPersistSession).toHaveBeenCalledWith(rotated, "correct horse battery");
    expect(handlers.onSessionUpdate).toHaveBeenCalledWith(rotated);
    // The rotation re-encrypted every object, so the list in hand is stale.
    expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the replacement phrase on the devices page the revoke happened on", async () => {
    revokeDevice.mockResolvedValue({ session: rotated, phrase: aPhrase() });
    mount("Manage Paired Devices");

    await revoke("correct horse battery");

    // The message points below itself, and the old phrase is already dead.
    await waitFor(() => expect(message()).toContain("Save the new recovery phrase below"));
    expect(screen.getByText("word1")).toBeDefined();
    expect(screen.getByText("word24")).toBeDefined();
  });
});

describe("generating a new recovery phrase", () => {
  function openDialog() {
    mount("Generate New Recovery Codes");
    fireEvent.click(screen.getByRole("button", { name: "Generate New Codes" }));
    return screen.getByRole("dialog", { name: "Generate New Recovery Words?" });
  }

  it("will not rotate until the password is given", () => {
    const dialog = openDialog();

    // The rotation re-wraps the vault key, so there is nothing to do without it.
    expect(
      within(dialog).getByRole("button", { name: "Yes, Generate New Codes" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(rotatePhrase).not.toHaveBeenCalled();
  });

  it("shows the new words and re-saves the device under the same password", async () => {
    const phrase = Array.from({ length: 24 }, (_, index) => `word${index + 1}`).join(" ");
    rotatePhrase.mockResolvedValue({ session: rotated, phrase });
    const dialog = openDialog();

    fireEvent.change(within(dialog).getByPlaceholderText("Current password"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, Generate New Codes" }));

    await waitFor(() =>
      expect(rotatePhrase).toHaveBeenCalledWith(session, "correct horse battery", expect.any(Function)),
    );
    expect(handlers.onPersistSession).toHaveBeenCalledWith(rotated, "correct horse battery");
    expect(await screen.findByText("word24")).toBeDefined();
    // The key moved, so the vault has to be re-read under it.
    expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("signing out", () => {
  it("warns harder when nothing else is signed in", async () => {
    mount("Sign Out");

    expect(
      await screen.findByText(/This is the only device signed in to ada\./u),
    ).toBeDefined();
  });

  it("names the way back in when another device is signed in", async () => {
    listDevices.mockResolvedValue([aDeviceSummary(THIS_DEVICE), aDeviceSummary(OTHER_DEVICE)]);
    mount("Sign Out");

    expect(
      await screen.findByText(/another device that is still signed in, or your 24 recovery words/u),
    ).toBeDefined();
  });

  it("signs out only once the dialog is confirmed", async () => {
    mount("Sign Out");

    fireEvent.click(screen.getByRole("button", { name: "Sign out…" }));
    const dialog = screen.getByRole("dialog", { name: "Sign out" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(handlers.onSignOut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sign out…" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Sign out" })).getByRole("button", { name: "Sign out" }),
    );
    expect(handlers.onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe("deleting the account", () => {
  function openDialog() {
    mount("Delete Account");
    fireEvent.click(screen.getByRole("button", { name: "Delete Account…" }));
  }

  it("keeps the button disabled until the username is typed exactly", () => {
    openDialog();
    const confirm = screen.getByRole("button", { name: "Permanently Delete Account" });
    const typed = screen.getByPlaceholderText("ada");

    fireEvent.change(screen.getByPlaceholderText("Current password"), {
      target: { value: "correct horse battery" },
    });
    expect(confirm.hasAttribute("disabled")).toBe(true);

    fireEvent.change(typed, { target: { value: "Ada" } });
    expect(confirm.hasAttribute("disabled")).toBe(true);

    fireEvent.change(typed, { target: { value: "ada" } });
    expect(confirm.hasAttribute("disabled")).toBe(false);
  });

  it("clears this browser's keys once the server has purged the account", async () => {
    deleteAccount.mockResolvedValue(undefined);
    clearDevice.mockResolvedValue(undefined);
    openDialog();

    fireEvent.change(screen.getByPlaceholderText("ada"), { target: { value: "ada" } });
    fireEvent.change(screen.getByPlaceholderText("Current password"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Permanently Delete Account" }));

    await waitFor(() => expect(handlers.onAccountDeleted).toHaveBeenCalledTimes(1));
    expect(deleteAccount).toHaveBeenCalledWith(session, "correct horse battery");
    expect(clearDevice).toHaveBeenCalledTimes(1);
  });

  it("leaves the keys in place when the server refuses", async () => {
    deleteAccount.mockRejectedValue(new Error("Wrong password"));
    openDialog();

    fireEvent.change(screen.getByPlaceholderText("ada"), { target: { value: "ada" } });
    fireEvent.change(screen.getByPlaceholderText("Current password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Permanently Delete Account" }));

    expect(await screen.findByText("Wrong password.")).toBeDefined();
    // Clearing them on a failed delete would lock the account out of a vault
    // that is still there.
    expect(clearDevice).not.toHaveBeenCalled();
    expect(handlers.onAccountDeleted).not.toHaveBeenCalled();
  });
});
