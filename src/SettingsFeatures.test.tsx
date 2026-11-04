// @vitest-environment jsdom
/**
 * The account-wide preferences in `SettingsView`: which features are on, the
 * accent, and the contact detail level.
 *
 * All three go out through the one `onSaveAccountSettings` prop and come back
 * in through `accountSettings`, so none of them has a local copy to drift. What
 * these cover is that the view stays honest about that: a failed write leaves
 * the control showing what the vault still holds, and a feature that is off
 * takes its own settings page out of reach rather than leaving a page for a tab
 * that is not there.
 *
 * `lib/client` is faked because `SettingsView` loads the device list on mount
 * and that reaches the server.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "./test/dom";
import { aDeviceState } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS, withFeature } from "./lib/accountSettings";
import type { AccountSettings } from "./lib/types";
import type { Session } from "./lib/client";

vi.mock("./lib/client", async () => {
  const actual = await vi.importActual<typeof import("./lib/client")>("./lib/client");
  return { ...actual, listDevices: async () => [] };
});

import type { SettingsSection } from "./components/SettingsView";
import { SettingsHarness } from "./test/settings";

const session = {
  state: aDeviceState({ username: "ada" }),
  collectionKey: "k",
  token: "t",
  latestRevision: 1,
  keyEpoch: 0,
  manifestSeq: 1,
} as Session;

const onSaveAccountSettings = vi.fn<(settings: AccountSettings) => Promise<void>>();

/**
 * Mounts with the given settings. They are the prop rather than state, so a
 * control that only looks saved shows up as the screen not changing.
 */
function mount(settings: AccountSettings, initialSection?: SettingsSection) {
  render(
    <SettingsHarness
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
      onSessionUpdate={() => undefined}
      onPersistSession={async () => undefined}
      onAccountDeleted={() => undefined}
      onSignOut={() => undefined}
      onRefresh={async () => undefined}
      timezone="Europe/London"
      onTimezoneChange={() => undefined}
      accountSettings={settings}
      onSaveAccountSettings={onSaveAccountSettings}
      initialSection={initialSection}
    />,
  );
}

function section(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

const onlyNotes = withFeature(
  withFeature(
    withFeature(withFeature(DEFAULT_ACCOUNT_SETTINGS, "contacts", false), "calendar", false),
    "bookmarks",
    false,
  ),
  "tasks",
  false,
);

beforeEach(() => {
  vi.clearAllMocks();
  onSaveAccountSettings.mockResolvedValue(undefined);
});

describe("turning a feature off", () => {
  it("writes the whole settings object with that one flag flipped", async () => {
    mount(DEFAULT_ACCOUNT_SETTINGS);
    section("Features");

    fireEvent.click(screen.getByRole("switch", { name: "Bookmarks enabled" }));

    await waitFor(() => expect(onSaveAccountSettings).toHaveBeenCalledTimes(1));
    expect(onSaveAccountSettings.mock.calls[0]![0].features).toEqual({
      contacts: true,
      calendar: true,
      notes: true,
      bookmarks: false,
      tasks: true,
    });
    expect(await screen.findByText(/Bookmarks disabled for this account/u)).toBeDefined();
  });

  it("leaves the switch where it was when the write fails", async () => {
    onSaveAccountSettings.mockRejectedValue(new Error("unauthorized"));
    mount(DEFAULT_ACCOUNT_SETTINGS);
    section("Features");

    fireEvent.click(screen.getByRole("switch", { name: "Notes enabled" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Your session expired. Lock and unlock again.");
    // The switch reads the prop, so it is still on: nothing was stored.
    expect(screen.getByRole("switch", { name: "Notes enabled" }).getAttribute("aria-checked")).toBe("true");
  });

  it("will not offer to turn off the last one left", () => {
    mount(onlyNotes);
    section("Features");

    const last = screen.getByRole("switch", { name: "Notes enabled" });
    expect(last.getAttribute("aria-checked")).toBe("true");
    expect(last.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Your only enabled feature, so it has to stay on.")).toBeDefined();

    // The other four are off and so can be turned back on.
    expect(screen.getByRole("switch", { name: "Contacts enabled" }).hasAttribute("disabled")).toBe(false);
  });
});

describe("the settings a disabled feature would own", () => {
  it("are not listed at all", () => {
    mount(onlyNotes);

    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const rows = within(nav).getAllByRole("button").map((row) => row.textContent);
    expect(rows).toContain("Notes");
    expect(rows).not.toContain("Contacts");
    expect(rows).not.toContain("Calendar");
    // Account, features and appearance are not a feature's own page, so they stay.
    expect(rows).toContain("Username");
    expect(rows).toContain("Features");
    expect(rows).toContain("Appearance");
  });

  it("fall back to the account page when asked for directly", () => {
    // The last tab is remembered across sessions, so the section asked for can
    // be one the account has since turned off.
    mount(onlyNotes, "calendar");

    expect(screen.getByRole("heading", { name: "Username", level: 1 })).toBeDefined();
    expect(screen.queryByText("Calendar timezone")).toBeNull();
  });

  it("open normally while the feature is on", () => {
    mount(DEFAULT_ACCOUNT_SETTINGS, "calendar");

    expect(screen.getByRole("heading", { name: "Calendar", level: 1 })).toBeDefined();
    expect(screen.getByText("Calendar timezone")).toBeDefined();
  });
});

describe("the accent", () => {
  it("is saved when a different one is picked", async () => {
    mount(DEFAULT_ACCOUNT_SETTINGS);
    section("Appearance");

    fireEvent.click(screen.getByRole("radio", { name: /Rose/u }));

    await waitFor(() => expect(onSaveAccountSettings).toHaveBeenCalledTimes(1));
    expect(onSaveAccountSettings.mock.calls[0]![0].accent).toBe("rose");
  });

  it("writes nothing when the one already active is picked", () => {
    mount(DEFAULT_ACCOUNT_SETTINGS);
    section("Appearance");

    const active = screen.getAllByRole("radio").find((radio) => radio.getAttribute("aria-checked") === "true");
    fireEvent.click(active!);

    expect(onSaveAccountSettings).not.toHaveBeenCalled();
  });
});

describe("the contact detail level", () => {
  it("is saved with the rest of the settings when it changes", async () => {
    mount(DEFAULT_ACCOUNT_SETTINGS);
    section("Contacts");

    fireEvent.click(screen.getByRole("radio", { name: /Detailed/u }));

    await waitFor(() => expect(onSaveAccountSettings).toHaveBeenCalledTimes(1));
    const saved = onSaveAccountSettings.mock.calls[0]![0];
    expect(saved.contactMode).toBe("detailed");
    // Carried rather than rebuilt, so switching mode cannot drop the rest.
    expect(saved.features).toEqual(DEFAULT_ACCOUNT_SETTINGS.features);
    expect(saved.accent).toBe(DEFAULT_ACCOUNT_SETTINGS.accent);
    expect(await screen.findByText(/Detailed contacts are on/u)).toBeDefined();
  });

  it("writes nothing when the mode already in use is picked", () => {
    mount(DEFAULT_ACCOUNT_SETTINGS);
    section("Contacts");

    fireEvent.click(screen.getByRole("radio", { name: /Basic/u }));

    expect(onSaveAccountSettings).not.toHaveBeenCalled();
  });
});
