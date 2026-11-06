import type { FeatureKey } from "./types";

export type SettingsSection =
  | "account"
  | "features"
  | "appearance"
  | "lock"
  | "contacts"
  | "calendar"
  | "notes"
  | "bookmarks"
  | "tasks";

export type AccountPage =
  | "username"
  | "password"
  | "devices"
  | "recovery"
  | "data"
  | "signout"
  | "delete";

/** One row in the settings sidebar, and the page it opens. */
export type SettingsPage = AccountPage | Exclude<SettingsSection, "account">;

export type PageMeta = {
  id: SettingsPage;
  label: string;
  blurb: string;
  danger?: boolean;
  /** Set on the pages that belong to a feature, which go when it is turned off. */
  feature?: FeatureKey;
  /** Usable offline, since nothing on it reaches the server. */
  local?: boolean;
};

export type PageGroup = { label: string; pages: PageMeta[] };

export const PAGE_GROUPS: PageGroup[] = [
  {
    label: "Account",
    pages: [
      {
        id: "username",
        label: "Username",
        blurb: "The name you sign in with. Changing it keeps everything in your vault where it is.",
      },
      {
        id: "password",
        label: "Password",
        blurb: "Your password unlocks this device's keys. Changing it re-wraps them under the new one.",
      },
      {
        id: "devices",
        label: "Devices",
        blurb: "Every device signed in to this account. Revoke the ones you no longer use.",
      },
      {
        id: "recovery",
        label: "Recovery phrase",
        blurb: "Your 24 recovery words are the way back in when no signed-in device is left.",
      },
      {
        id: "data",
        label: "Backup and restore",
        blurb: "Download a decrypted copy of your whole vault, or restore one from a backup file.",
      },
      {
        id: "signout",
        label: "Sign out",
        blurb: "Remove this device's keys from this browser.",
        local: true,
      },
      {
        id: "delete",
        label: "Delete account",
        blurb: "Permanently erase your account and everything in it.",
        danger: true,
      },
    ],
  },
  {
    label: "Preferences",
    pages: [
      {
        id: "features",
        label: "Features",
        blurb:
          "Choose which parts of Sealbook this account uses.",
        local: true,
      },
      {
        id: "appearance",
        label: "Appearance",
        blurb:
          "Choose the accent Sealbook highlights things with.",
        local: true,
      },
      {
        id: "lock",
        label: "Auto-lock",
        blurb:
          "Choose how long this browser can sit idle before the vault locks.",
        local: true,
      },
    ],
  },
  {
    label: "Apps",
    pages: [
      {
        id: "contacts",
        label: "Contacts",
        blurb: "Choose how much a contact can hold, and move contacts in and out of Sealbook.",
        feature: "contacts",
      },
      {
        id: "calendar",
        label: "Calendar",
        blurb: "Choose the timezone your calendar shows, and move events in and out of Sealbook.",
        feature: "calendar",
      },
      {
        id: "notes",
        label: "Notes",
        blurb: "Move notes in and out of Sealbook as Markdown or as a full JSON backup.",
        feature: "notes",
      },
      {
        id: "bookmarks",
        label: "Bookmarks",
        blurb: "Move bookmarks in and out of Sealbook as a JSON backup that keeps collections, tags and notes.",
        feature: "bookmarks",
      },
      {
        id: "tasks",
        label: "Tasks",
        blurb: "Move tasks in and out of Sealbook as a JSON backup that keeps due dates, repeats, priorities, tags and subtasks.",
        feature: "tasks",
      },
    ],
  },
];

/** The page a section link lands on; the account section opens on its first page. */
export function pageForSection(section: SettingsSection): SettingsPage {
  return section === "account" ? "username" : section;
}
