export type SettingsSection =
  | "account"
  | "features"
  | "appearance"
  | "contacts"
  | "calendar"
  | "notes"
  | "bookmarks";

export const SECTIONS: { id: SettingsSection; label: string; nav: string; blurb: string }[] = [
  {
    id: "account",
    label: "Account settings",
    nav: "Identity, security, and recovery",
    blurb:
      "Manage your identity, cryptographic credentials, recovery phrase, and account data.",
  },
  {
    id: "features",
    label: "Feature settings",
    nav: "Turn features on or off",
    blurb:
      "Choose which parts of Sealbook this account uses. The choice is stored in your vault, so every device signed in to the account follows it.",
  },
  {
    id: "appearance",
    label: "Appearance",
    nav: "Accent colour",
    blurb:
      "Choose the accent Sealbook highlights things with. Like your other preferences it is stored in your vault, so every device signed in to the account picks it up.",
  },
  {
    id: "contacts",
    label: "Contacts settings",
    nav: "Detail level, import and export",
    blurb:
      "Choose how much a contact can hold, and move contact data in and out of Sealbook while keeping your address books organized.",
  },
  {
    id: "calendar",
    label: "Calendar settings",
    nav: "Timezone and event display",
    blurb: "Choose how dates and times are displayed throughout your calendar.",
  },
  {
    id: "notes",
    label: "Notes settings",
    nav: "Import and export notes",
    blurb: "Move notes in and out of Sealbook as Markdown or as a full JSON backup.",
  },
  {
    id: "bookmarks",
    label: "Bookmarks settings",
    nav: "Import and export bookmarks",
    blurb: "Move bookmarks in and out of Sealbook as a JSON backup that preserves collections, tags and notes.",
  },
];