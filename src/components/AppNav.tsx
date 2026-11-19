import { useId, type MouseEvent } from "react";
import { focusRing } from "../lib/styles";
import type { SettingsSection } from "../lib/settingsModel";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { Icon, type IconName } from "./Icon";
import { Logo } from "./AuthLayout";

export type NavTab = { id: string; label: string; icon: IconName };

export type SyncState = { offline: boolean; pending: number; failed: number };

type NavProps = {
  /** Every visible tab, Settings included; the rail sets Settings apart at its foot. */
  tabs: NavTab[];
  active: string;
  onSelect: (id: string) => void;
  onSearch: () => void;
  searchShortcut: string;
  /** Undefined while offline, so the control is absent rather than disabled. */
  onAddDevice?: () => void;
  onRefresh?: () => void;
  refreshing: boolean;
  onLock: () => void;
  onAccount: (section: SettingsSection) => void;
  username: string;
  deviceName: string;
  sync: SyncState;
};

const plural = (count: number) => (count === 1 ? "" : "s");

/** What the vault is doing about the user's changes, in a sentence. */
export function syncSummary({ offline, pending, failed }: SyncState): string {
  if (failed > 0) return `${failed} change${plural(failed)} couldn't sync`;
  if (offline) {
    return pending > 0
      ? `Offline, ${pending} change${plural(pending)} waiting to sync`
      : "Offline. Changes are kept on this device";
  }
  if (pending > 0) return `${pending} change${plural(pending)} waiting to sync`;
  return "All changes synced";
}

function syncDot({ offline, pending, failed }: SyncState): string | null {
  if (failed > 0) return "bg-warning";
  if (offline) return "bg-danger";
  if (pending > 0) return "bg-accent animate-pulse";
  return null;
}

/** The panel the account button and the phone's "More" tab open above their items. */
function AccountHeader({ username, deviceName, sync }: Pick<NavProps, "username" | "deviceName" | "sync">) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-text">{username}</p>
      {deviceName ? <p className="truncate text-xs text-mute">{deviceName}</p> : null}
      <p className="mt-1.5 text-2xs text-mute">{syncSummary(sync)}</p>
    </div>
  );
}

function RailButton({
  label,
  icon,
  tip,
  current = false,
  onClick,
  spinning = false,
  dot,
  describedBy,
  keyShortcuts,
}: {
  label: string;
  icon: IconName;
  tip?: string;
  /** The page this button is the way to: gets `aria-current` and the fill. */
  current?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  spinning?: boolean;
  dot?: string | null;
  describedBy?: string;
  keyShortcuts?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? "page" : undefined}
      aria-describedby={describedBy}
      aria-keyshortcuts={keyShortcuts}
      data-tip={tip ?? label}
      onClick={onClick}
      className={`tip relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150 ${focusRing} ${
        current
          ? "bg-accent-soft text-accent before:absolute before:-left-2.5 before:h-5 before:w-[3px] before:rounded-r-full before:bg-accent"
          : "text-mute hover:bg-hover hover:text-text"
      }`}
    >
      <Icon name={icon} className={`size-5 ${spinning ? "animate-spin" : ""}`} strokeWidth={1.35} />
      {dot ? (
        <span
          aria-hidden="true"
          className={`absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-bg ${dot}`}
        />
      ) : null}
    </button>
  );
}

/**
 * The desktop shell's navigation: the five feature tabs down the rail, and the
 * controls that act on the whole vault at its foot. It replaces a header that
 * wrapped onto a second row below 1280px and took 100px of every view's height.
 *
 * Search, Add device, Refresh and Lock are named exactly as they were in the
 * header, because they are the same controls. Sync state rides on the Refresh
 * button's tooltip and description rather than in a live region, so it is there
 * for anyone who asks and does not interrupt anyone who does not.
 */
export function AppRail({
  tabs,
  active,
  onSelect,
  onSearch,
  searchShortcut,
  onAddDevice,
  onRefresh,
  refreshing,
  onLock,
  onAccount,
  username,
  deviceName,
  sync,
}: NavProps) {
  const menu = useContextMenu();
  const syncId = useId();
  const features = tabs.filter((tab) => tab.id !== "settings");
  const settings = tabs.find((tab) => tab.id === "settings");
  const summary = syncSummary(sync);

  function openAccount(event: MouseEvent<HTMLButtonElement>) {
    if (menu.menu?.trigger === "account") {
      menu.close();
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    // Anchored to the rail rather than the avatar, which is narrower than it.
    const rail = event.currentTarget.closest("nav")?.getBoundingClientRect().right ?? box.right;
    menu.openAt({ x: rail + 6, y: box.bottom }, accountItems(onAccount), {
      trigger: "account",
      header: <AccountHeader username={username} deviceName={deviceName} sync={sync} />,
    });
  }

  return (
    <>
      <nav
        aria-label="Main Navigation"
        className="relative z-(--z-rail) flex w-(--sb-rail-w) shrink-0 flex-col items-center gap-1 border-r border-line bg-bg/60 py-3 backdrop-blur-xl"
      >
        <div className="tip relative mb-3 flex size-9 items-center justify-center" data-tip="Sealbook">
          <Logo className="size-7" />
        </div>

        {features.map((tab) => (
          <RailButton
            key={tab.id}
            label={tab.label}
            icon={tab.icon}
            current={active === tab.id}
            onClick={() => onSelect(tab.id)}
          />
        ))}

        <div className="mt-auto flex flex-col items-center gap-1">
          <RailButton
            label="Search"
            icon="search"
            tip={`Search  ${searchShortcut}`}
            keyShortcuts={searchShortcut.includes("⌘") ? "Meta+K" : "Control+K"}
            onClick={onSearch}
          />
          {onAddDevice ? <RailButton label="Add device" icon="devicePlus" onClick={onAddDevice} /> : null}
          {onRefresh ? (
            <>
              <RailButton
                label="Refresh vault"
                icon="refresh"
                tip={`Refresh vault. ${summary}`}
                describedBy={syncId}
                spinning={refreshing}
                dot={syncDot(sync)}
                onClick={onRefresh}
              />
              <span id={syncId} className="sr-only">
                {summary}
              </span>
            </>
          ) : (
            <span
              role="img"
              aria-label="Offline"
              data-tip={summary}
              className="tip relative flex size-10 items-center justify-center text-danger"
            >
              <Icon name="offline" className="size-5" strokeWidth={1.35} />
            </span>
          )}
          {settings ? (
            <RailButton
              label={settings.label}
              icon={settings.icon}
              current={active === settings.id}
              onClick={() => onSelect(settings.id)}
            />
          ) : null}
          <RailButton label="Lock" icon="lock" onClick={onLock} />
          <button
            type="button"
            aria-label="Account"
            aria-haspopup="menu"
            data-menu-trigger
            data-tip={username}
            onClick={openAccount}
            className={`tip relative mt-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent-soft text-xs font-semibold uppercase text-accent transition-colors hover:bg-accent-line ${focusRing}`}
          >
            {username.slice(0, 1) || "?"}
          </button>
        </div>
      </nav>
      <ContextMenu state={menu.menu} onClose={menu.close} />
    </>
  );
}

function accountItems(onAccount: NavProps["onAccount"]): MenuItem[] {
  return [
    { label: "Your account", icon: "user", onSelect: () => onAccount("account") },
    { label: "Manage devices", icon: "device", onSelect: () => onAccount("devices") },
  ];
}

/**
 * The phone's navigation. It sits in the flow as the shell's last row rather
 * than fixed over the content, so no view needs bottom padding to clear it, and
 * it pads itself for the home indicator. The tabs that do not fit five across,
 * with the whole-vault controls, are behind "More".
 */
export function MobileTabBar({
  tabs,
  active,
  onSelect,
  onSearch,
  onAddDevice,
  onRefresh,
  onLock,
  onAccount,
  username,
  deviceName,
  sync,
}: NavProps) {
  const menu = useContextMenu();
  const features = tabs.filter((tab) => tab.id !== "settings");
  const settings = tabs.find((tab) => tab.id === "settings");
  const dot = syncDot(sync);

  function openMore(event: MouseEvent<HTMLButtonElement>) {
    if (menu.menu?.trigger === "more") {
      menu.close();
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const items: MenuItem[] = [
      { label: "Search", icon: "search", onSelect: onSearch },
      ...(onAddDevice ? [{ label: "Add device", icon: "devicePlus" as const, onSelect: onAddDevice }] : []),
      ...(onRefresh ? [{ label: "Refresh vault", icon: "refresh" as const, onSelect: onRefresh }] : []),
      ...(settings
        ? [{ label: settings.label, icon: settings.icon, onSelect: () => onSelect(settings.id) }]
        : []),
      ...accountItems(onAccount),
      { label: "Lock", icon: "lock", onSelect: onLock },
    ];
    menu.openAt({ x: box.right, y: box.top }, items, {
      trigger: "more",
      header: <AccountHeader username={username} deviceName={deviceName} sync={sync} />,
    });
  }

  const moreActive = active === "settings";

  return (
    <>
      <nav
        aria-label="Main Navigation"
        className="mobile-tabbar flex shrink-0 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
      >
        {features.map((tab) => {
          const current = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-label={tab.label}
              aria-current={current ? "page" : undefined}
              onClick={() => onSelect(tab.id)}
              className={`flex h-(--sb-tabbar-h) min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors ${focusRing} ${
                current ? "text-accent" : "text-mute"
              }`}
            >
              <span
                className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                  current ? "bg-accent-soft" : ""
                }`}
              >
                <Icon name={tab.icon} className="size-5" strokeWidth={1.35} />
              </span>
              <span className="max-w-full truncate px-0.5">{tab.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-label="More"
          aria-haspopup="menu"
          data-menu-trigger
          onClick={openMore}
          className={`relative flex h-(--sb-tabbar-h) min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors ${focusRing} ${
            moreActive ? "text-accent" : "text-mute"
          }`}
        >
          <span
            className={`relative flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
              moreActive ? "bg-accent-soft" : ""
            }`}
          >
            <Icon name="more" className="size-5" />
            {dot ? (
              <span
                aria-hidden="true"
                className={`absolute right-2.5 top-1 size-2 rounded-full ring-2 ring-bg ${dot}`}
              />
            ) : null}
          </span>
          <span>More</span>
        </button>
      </nav>
      <ContextMenu state={menu.menu} onClose={menu.close} />
    </>
  );
}
