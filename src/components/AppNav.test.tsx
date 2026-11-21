// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "../test/dom";
import { AppRail, MobileTabBar, syncSummary, type NavTab, type SyncState } from "./AppNav";

const TABS: NavTab[] = [
  { id: "contacts", label: "Contacts", icon: "user" },
  { id: "calendar", label: "Calendar", icon: "calendar" },
  { id: "notes", label: "Notes", icon: "page" },
  { id: "settings", label: "Settings", icon: "settings" },
];

const SYNCED: SyncState = { offline: false, pending: 0, failed: 0 };

function props(overrides: Partial<Parameters<typeof AppRail>[0]> = {}) {
  return {
    tabs: TABS,
    active: "contacts",
    onSelect: vi.fn<(id: string) => void>(),
    onSearch: vi.fn<() => void>(),
    searchShortcut: "Ctrl K",
    onAddDevice: vi.fn<() => void>(),
    onRefresh: vi.fn<() => void>(),
    refreshing: false,
    onLock: vi.fn<() => void>(),
    onAccount: vi.fn(),
    username: "grace",
    deviceName: "Smoky Tiger",
    sync: SYNCED,
    ...overrides,
  };
}

describe("syncSummary", () => {
  it("says everything is synced when nothing is waiting", () => {
    expect(syncSummary(SYNCED)).toBe("All changes synced");
  });

  it("counts waiting changes, in the singular and the plural", () => {
    expect(syncSummary({ ...SYNCED, pending: 1 })).toBe("1 change waiting to sync");
    expect(syncSummary({ ...SYNCED, pending: 3 })).toBe("3 changes waiting to sync");
  });

  it("puts changes that could not sync ahead of everything else", () => {
    expect(syncSummary({ offline: true, pending: 2, failed: 1 })).toBe("1 change couldn't sync");
  });

  it("says so when offline, with or without changes waiting", () => {
    expect(syncSummary({ offline: true, pending: 0, failed: 0 })).toBe(
      "Offline. Changes are kept on this device",
    );
    expect(syncSummary({ offline: true, pending: 2, failed: 0 })).toBe(
      "Offline, 2 changes waiting to sync",
    );
  });
});

describe("the rail logo", () => {
  it("goes to the overview when there is one", () => {
    const onSelect = vi.fn<(id: string) => void>();
    const tabs = [{ id: "overview", label: "Overview", icon: "home" as const }, ...TABS];
    render(<AppRail {...props({ tabs, onSelect })} />);
    fireEvent.click(screen.getByRole("button", { name: "Sealbook home" }));
    expect(onSelect).toHaveBeenCalledWith("overview");
  });

  it("is plain artwork without one", () => {
    render(<AppRail {...props()} />);
    expect(screen.queryByRole("button", { name: "Sealbook home" })).toBeNull();
  });
});

describe("the desktop rail", () => {
  it("names the controls exactly as the header they replaced did", () => {
    render(<AppRail {...props()} />);
    const nav = screen.getByRole("navigation", { name: "Main Navigation" });

    for (const name of ["Contacts", "Calendar", "Notes", "Settings", "Search", "Add device", "Refresh vault", "Lock"]) {
      expect(within(nav).getByRole("button", { name })).toBeDefined();
    }
  });

  it("marks only the current tab, by its label", () => {
    render(<AppRail {...props({ active: "notes" })} />);
    const current = screen
      .getByRole("navigation", { name: "Main Navigation" })
      .querySelectorAll('[aria-current="page"]');

    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute("aria-label")).toBe("Notes");
  });

  it("matches a single button for /Settings/, which the session tests rely on", () => {
    render(<AppRail {...props()} />);

    expect(screen.getAllByRole("button", { name: /Settings/u })).toHaveLength(1);
  });

  it("offers neither Add device nor Refresh while offline, and says it is offline instead", () => {
    render(<AppRail {...props({ onAddDevice: undefined, onRefresh: undefined, sync: { ...SYNCED, offline: true } })} />);

    expect(screen.queryByRole("button", { name: "Add device" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh vault" })).toBeNull();
    expect(screen.getByRole("img", { name: "Offline" })).toBeDefined();
  });

  it("describes the sync state on Refresh without adding a live region", () => {
    render(<AppRail {...props({ sync: { ...SYNCED, pending: 2 } })} />);

    const refresh = screen.getByRole("button", { name: "Refresh vault" });
    const described = document.getElementById(refresh.getAttribute("aria-describedby") ?? "");

    expect(described?.textContent).toBe("2 changes waiting to sync");
    // The offline banner is the shell's one status, so the rail must not add another.
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("selects a tab and runs the vault controls", () => {
    const rail = props();
    render(<AppRail {...rail} />);

    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh vault" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock" }));

    expect(rail.onSelect).toHaveBeenCalledWith("calendar");
    expect(rail.onSearch).toHaveBeenCalledTimes(1);
    expect(rail.onRefresh).toHaveBeenCalledTimes(1);
    expect(rail.onLock).toHaveBeenCalledTimes(1);
  });

  it("opens an account menu that names the user and device, and closes on a second click", () => {
    const rail = props();
    render(<AppRail {...rail} />);

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("grace")).toBeDefined();
    expect(within(menu).getByText("Smoky Tiger")).toBeDefined();
    expect(within(menu).getByText("All changes synced")).toBeDefined();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Manage devices" }));
    expect(rail.onAccount).toHaveBeenCalledWith("devices");

    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the phone tab bar", () => {
  it("shows the feature tabs and keeps Settings behind More", () => {
    render(<MobileTabBar {...props()} />);
    const nav = screen.getByRole("navigation", { name: "Main Navigation" });

    expect(within(nav).getByRole("button", { name: "Contacts" })).toBeDefined();
    expect(within(nav).queryByRole("button", { name: "Settings" })).toBeNull();
    expect(within(nav).getByRole("button", { name: "More" })).toBeDefined();
  });

  it("holds Search, the vault controls, Settings and Lock in More", () => {
    const bar = props();
    render(<MobileTabBar {...bar} />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const menu = screen.getByRole("menu");
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);

    expect(labels).toEqual([
      "Search",
      "Add device",
      "Refresh vault",
      "Settings",
      "Your account",
      "Manage devices",
      "Lock",
    ]);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Settings" }));
    expect(bar.onSelect).toHaveBeenCalledWith("settings");
  });

  it("drops Add device and Refresh vault from More while offline", () => {
    render(<MobileTabBar {...props({ onAddDevice: undefined, onRefresh: undefined })} />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const labels = within(screen.getByRole("menu"))
      .getAllByRole("menuitem")
      .map((item) => item.textContent);

    expect(labels).not.toContain("Add device");
    expect(labels).not.toContain("Refresh vault");
    expect(labels).toContain("Lock");
  });

  it("marks no feature tab as current while Settings is the page", () => {
    render(<MobileTabBar {...props({ active: "settings" })} />);

    // Settings has no tab of its own here, so nothing in the bar claims to be the
    // current page; the fill on More is the only sign, and it is not announced.
    const nav = screen.getByRole("navigation", { name: "Main Navigation" });
    expect(nav.querySelector('[aria-current="page"]')).toBeNull();
  });
});
