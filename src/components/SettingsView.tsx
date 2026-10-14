import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import type { DeviceSummary, Session } from "../lib/client";
import {
  changePassword,
  changeUsername,
  deleteCalendar,
  deleteCalendarEvent,
  deleteAccount,
  putCalendar,
  putCalendarEvents,
  listDevices,
  revokeDevice,
  rotatePhrase,
} from "../lib/client";
import {
  ACCENTS,
  ACCENT_COLORS,
  ACCENT_LABELS,
  CONTACT_MODES,
  CONTACT_MODE_LABELS,
  FEATURES,
  FEATURE_LABELS,
  canDisableFeature,
  isFeatureEnabled,
  normalizeAccent,
  normalizeContactMode,
  withAccent,
  withContactMode,
  withFeature,
} from "../lib/accountSettings";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatIcs, parseCalendarImport } from "../lib/ics";
import { triggerDownload } from "../lib/importExport";
import { formatRecoveryWordsFile } from "../lib/phrase";
import { clearDevice } from "../lib/storage";
import { friendlyError } from "../lib/errors";
import {
  btnDanger,
  btnPrimary,
  btnSecondary,
  field,
  focusRing,
  selectField,
} from "../lib/styles";
import type {
  AccentKey,
  AccountSettings,
  AddressBook,
  Calendar,
  CalendarEvent,
  Contact,
  ContactMode,
  FeatureKey,
  Note,
  Notebook,
} from "../lib/types";
import { DEFAULT_CALENDAR_COLOR } from "../lib/types";
import { allTimezones, utcOffsetLabel } from "../lib/timezone";
import { Modal } from "./Modal";
import { AccountExportSection } from "./AccountExportSection";
import { ImportExportSection } from "./ImportExportSection";
import { NotesImportExportSection } from "./NotesImportExportSection";
import { PasswordField } from "./PasswordField";

const MAX_CALENDAR_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CALENDAR_EVENTS = 1_000;

type Props = {
  session: Session;
  contacts: Contact[];
  addressBooks: AddressBook[];
  calendars: Calendar[];
  calendarEvents: CalendarEvent[];
  notes: Note[];
  notebooks: Notebook[];
  onSessionUpdate: (updated: Session) => void;
  onPersistSession: (updated: Session, password: string) => Promise<void>;
  onAccountDeleted: () => void;
  onSignOut: () => void;
  onRefresh: () => Promise<void>;
  onCreateBook?: (name: string) => Promise<string | undefined>;
  onCreateNotebook?: (name: string) => Promise<string | undefined>;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  accountSettings: AccountSettings;
  /** Rejects when the write fails, so the toggle can report it and stay put. */
  onSaveAccountSettings: (settings: AccountSettings) => Promise<void>;
  /** Read once on mount; the view unmounts whenever the Settings tab is left. */
  initialSection?: SettingsSection;
};

export type SettingsSection =
  | "account"
  | "features"
  | "appearance"
  | "contacts"
  | "calendar"
  | "notes";

/**
 * One place per section, so adding a fourth feature is a row here rather than an
 * arm in each of three parallel lists.
 */
const SECTIONS: { id: SettingsSection; label: string; nav: string; blurb: string }[] = [
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
];

export function SettingsView({
  session,
  contacts,
  addressBooks,
  calendars,
  calendarEvents,
  notes,
  notebooks,
  onSessionUpdate,
  onPersistSession,
  onAccountDeleted,
  onSignOut,
  onRefresh,
  onCreateBook,
  onCreateNotebook,
  timezone,
  onTimezoneChange,
  accountSettings,
  onSaveAccountSettings,
  initialSection,
}: Props) {
  const [activeSectionState, setActiveSection] = useState<SettingsSection>(
    initialSection ?? "account",
  );
  // Calendar import state
  const icsInputRef = useRef<HTMLInputElement | null>(null);
  // Prefix for the ids that tie this view's labels to their controls.
  const ids = useId();
  const [icsDragActive, setIcsDragActive] = useState(false);
  const [icsFile, setIcsFile] = useState<{ name: string; size: number } | null>(null);
  const [parsedIcsFormat, setParsedIcsFormat] = useState<string | null>(null);
  const [parsedEvents, setParsedEvents] = useState<Omit<CalendarEvent, "id">[]>([]);
  const [skippedEvents, setSkippedEvents] = useState(0);
  const [icsCalendarId, setIcsCalendarId] = useState("");
  const [isCreatingCalendar, setIsCreatingCalendar] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState("");
  const [importingIcs, setImportingIcs] = useState(false);
  const [icsProgress, setIcsProgress] = useState<{ current: number; total: number } | null>(null);
  const [icsImportMsg, setIcsImportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Calendar export state
  const [exportCalendarId, setExportCalendarId] = useState("all");
  const [calendarExportFormat, setCalendarExportFormat] = useState<"ics" | "json">("ics");
  const [icsExportMsg, setIcsExportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Username state
  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Password state
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Recovery phrase state
  const [phraseBusy, setPhraseBusy] = useState(false);
  const [newWords, setNewWords] = useState<string[] | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [devicesMsg, setDevicesMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<DeviceSummary | null>(null);
  const [revokePassword, setRevokePassword] = useState("");
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeProgress, setRevokeProgress] = useState({ done: 0, total: 0 });
  const [copiedPhrase, setCopiedPhrase] = useState(false);
  const [phraseMsg, setPhraseMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showPhraseConfirm, setShowPhraseConfirm] = useState(false);
  // Rotating the phrase rotates the vault key, which needs the password to
  // re-wrap it, so this is no longer a one-click action.
  const [phrasePassword, setPhrasePassword] = useState("");
  const [phraseProgress, setPhraseProgress] = useState({ done: 0, total: 0 });

  // Feature toggle state
  const [featureBusy, setFeatureBusy] = useState<FeatureKey | null>(null);
  const [featureMsg, setFeatureMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Accent state
  const [accentBusy, setAccentBusy] = useState<AccentKey | null>(null);
  const [accentMsg, setAccentMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Contact mode state
  const [contactModeBusy, setContactModeBusy] = useState(false);
  const [contactModeMsg, setContactModeMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Sign out state
  const [signOutConfirm, setSignOutConfirm] = useState(false);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Handlers
  async function handleToggleFeature(feature: FeatureKey, enabled: boolean) {
    const next = withFeature(accountSettings, feature, enabled);
    if (next === accountSettings) {
      setFeatureMsg({
        type: "error",
        text: "At least one of contacts, calendar, and notes has to stay on.",
      });
      return;
    }
    setFeatureBusy(feature);
    setFeatureMsg(null);
    try {
      await onSaveAccountSettings(next);
      setFeatureMsg({
        type: "success",
        text: `${FEATURE_LABELS[feature]} ${enabled ? "enabled" : "disabled"} for this account. Other devices pick the change up on their next sync.`,
      });
    } catch (err) {
      setFeatureMsg({ type: "error", text: friendlyError(err) });
    } finally {
      setFeatureBusy(null);
    }
  }

  async function handleAccent(accent: AccentKey) {
    if (normalizeAccent(accountSettings.accent) === accent) return;
    setAccentBusy(accent);
    setAccentMsg(null);
    try {
      await onSaveAccountSettings(withAccent(accountSettings, accent));
      setAccentMsg({
        type: "success",
        text: `${ACCENT_LABELS[accent]} it is. Other devices pick the change up on their next sync.`,
      });
    } catch (err) {
      setAccentMsg({ type: "error", text: friendlyError(err) });
    } finally {
      setAccentBusy(null);
    }
  }

  async function handleContactMode(mode: ContactMode) {
    if (normalizeContactMode(accountSettings.contactMode) === mode) return;
    setContactModeBusy(true);
    setContactModeMsg(null);
    try {
      await onSaveAccountSettings(withContactMode(accountSettings, mode));
      setContactModeMsg({
        type: "success",
        text:
          mode === "detailed"
            ? "Detailed contacts are on. Open a contact and use Add section to start filling them in."
            : "Back to basic contacts. Anything already filled in stays in your vault and comes back when you switch again.",
      });
    } catch (err) {
      setContactModeMsg({ type: "error", text: friendlyError(err) });
    } finally {
      setContactModeBusy(false);
    }
  }

  async function handleChangeUsername(e: FormEvent) {
    e.preventDefault();
    setUsernameMsg(null);
    const targetName = newUsername.trim();
    if (!targetName) return;
    if (targetName === session.state.username) {
      setUsernameMsg({
        type: "error",
        text: "New username cannot be identical to current username.",
      });
      return;
    }
    if (targetName.length < 3 || targetName.length > 64) {
      setUsernameMsg({
        type: "error",
        text: "Username must be between 3 and 64 characters.",
      });
      return;
    }
    if (!usernamePassword) {
      setUsernameMsg({
        type: "error",
        text: "Please enter your current password to confirm.",
      });
      return;
    }

    setUsernameBusy(true);
    try {
      const updated = await changeUsername(
        session,
        targetName,
        usernamePassword,
      );
      await onPersistSession(updated, usernamePassword);
      onSessionUpdate(updated);
      setNewUsername("");
      setUsernamePassword("");
      setUsernameMsg({
        type: "success",
        text: `Username successfully updated to "${targetName}".`,
      });
    } catch (err) {
      setUsernameMsg({
        type: "error",
        text: friendlyError(err),
      });
    } finally {
      setUsernameBusy(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordMsg(null);
    if (!newPassword) return;
    if (!passwordCurrent) {
      setPasswordMsg({ type: "error", text: "Please enter your current password to confirm." });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({
        type: "error",
        text: "Password must be at least 8 characters long.",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({
        type: "error",
        text: "New passwords do not match.",
      });
      return;
    }

    setPasswordBusy(true);
    try {
      const updated = await changePassword(session, passwordCurrent, newPassword);
      await onPersistSession(updated, newPassword);
      onSessionUpdate(updated);
      setPasswordCurrent("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg({
        type: "success",
        text: "Password updated successfully. Encryption keys have been re-wrapped.",
      });
    } catch (err) {
      setPasswordMsg({
        type: "error",
        text: friendlyError(err),
      });
    } finally {
      setPasswordBusy(false);
    }
  }

  const loadDevices = useCallback(async () => {
    try {
      setDevices(await listDevices(session));
    } catch (err) {
      setDevicesMsg({ type: "error", text: friendlyError(err) });
    }
  }, [session]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  async function handleRevokeDevice() {
    if (!revokeTarget) return;
    if (!revokePassword) {
      setRevokeError("Enter your password to confirm.");
      return;
    }
    setRevokeBusy(true);
    setRevokeError(null);
    setDevicesMsg(null);
    setRevokeProgress({ done: 0, total: 0 });
    try {
      const { session: updated, phrase } = await revokeDevice(
        session,
        revokeTarget.device_id,
        revokePassword,
        (done, total) => setRevokeProgress({ done, total }),
      );
      await onPersistSession(updated, revokePassword);
      onSessionUpdate(updated);
      // Rotating the key invalidates the old phrase, so surface the new one in
      // the same place a freshly generated phrase appears.
      setNewWords(phrase.split(/\s+/u).filter(Boolean));
      setCopiedPhrase(false);
      setRevokeTarget(null);
      setRevokePassword("");
      setDevicesMsg({
        type: "success",
        text: "Device revoked and the vault key rotated. Save the new recovery phrase below — your previous one no longer works.",
      });
      await loadDevices();
      await onRefresh();
    } catch (err) {
      setRevokeError(friendlyError(err));
    } finally {
      setRevokeBusy(false);
      setRevokeProgress({ done: 0, total: 0 });
    }
  }

  async function handleGeneratePhrase() {
    if (!phrasePassword) {
      setPhraseMsg({ type: "error", text: "Enter your password to confirm." });
      return;
    }
    setPhraseBusy(true);
    setPhraseMsg(null);
    setPhraseProgress({ done: 0, total: 0 });
    try {
      const { session: updated, phrase } = await rotatePhrase(
        session,
        phrasePassword,
        (done, total) => setPhraseProgress({ done, total }),
      );
      await onPersistSession(updated, phrasePassword);
      onSessionUpdate(updated);
      setNewWords(phrase.split(/\s+/u).filter(Boolean));
      setCopiedPhrase(false);
      setShowPhraseConfirm(false);
      setPhrasePassword("");
      setPhraseMsg({
        type: "success",
        text: "New recovery phrase generated and the vault key rotated. Your previous recovery words no longer work.",
      });
      await onRefresh();
    } catch (err) {
      setPhraseMsg({
        type: "error",
        text: friendlyError(err),
      });
    } finally {
      setPhraseBusy(false);
      setPhraseProgress({ done: 0, total: 0 });
    }
  }

  function downloadWords() {
    if (!newWords) return;
    const text = formatRecoveryWordsFile(newWords);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sealbook-new-recovery-words.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function printWords() {
    if (!newWords) return;
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (win) {
      const doc = win.document;
      doc.title = "Sealbook Recovery Words";
      doc.body.style.cssText = "font-family:system-ui,sans-serif;padding:40px;max-width:480px;margin:0 auto";
      const heading = doc.createElement("h2");
      heading.textContent = "Sealbook Recovery Words";
      heading.style.margin = "0 0 4px";
      const note = doc.createElement("p");
      note.textContent = "Keep this document safe and secret. Replaces all previous phrases.";
      note.style.cssText = "color:#666;margin:0 0 24px;font-size:14px";
      const table = doc.createElement("table");
      table.style.cssText = "border-collapse:collapse;font-size:15px";
      newWords.forEach((word, index) => {
        const row = table.insertRow();
        const number = row.insertCell();
        number.textContent = String(index + 1);
        number.style.cssText = "text-align:right;padding-right:12px;color:#888;font-variant-numeric:tabular-nums";
        const value = row.insertCell();
        value.textContent = word;
        value.style.fontFamily = "monospace";
      });
      doc.body.append(heading, note, table);
      win.focus();
      win.print();
    }
  }

  function copyWords() {
    if (!newWords) return;
    navigator.clipboard.writeText(newWords.join(" ")).then(() => {
      setCopiedPhrase(true);
      setTimeout(() => {
        void navigator.clipboard.writeText("").catch(() => undefined);
        setCopiedPhrase(false);
      }, 2500);
    });
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText.trim() !== session.state.username) {
      setDeleteError(
        `Please type "${session.state.username}" exactly to confirm deletion.`,
      );
      return;
    }
    if (!deletePassword) {
      setDeleteError("Please enter your current password to confirm deletion.");
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount(session, deletePassword);
      clearDevice();
      setShowDeleteModal(false);
      onAccountDeleted();
    } catch (err) {
      setDeleteError(friendlyError(err));
      setDeleteBusy(false);
    }
  }

  // Events selected for export, mirroring the contacts export filter.
  const exportEvents = exportCalendarId === "all"
    ? calendarEvents
    : calendarEvents.filter((event) => event.calendarId === exportCalendarId);

  function handleIcsFileRead(file: File) {
    setIcsImportMsg(null);
    if (file.size > MAX_CALENDAR_FILE_BYTES) {
      setIcsImportMsg({ type: "error", text: "Calendar files must be 5 MB or smaller." });
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content !== "string" || !content.trim()) {
        setIcsImportMsg({ type: "error", text: `File "${file.name}" is empty.` });
        return;
      }
      try {
        const trimmed = content.trimStart();
        const { events, skipped } = parseCalendarImport(content, timezone, icsCalendarId);
        if (events.length === 0) {
          setIcsImportMsg({
            type: "error",
            text: skipped.length
              ? `No calendar events in "${file.name}" could be used: ${skipped.length} could not be read.`
              : `No calendar events could be parsed from "${file.name}". Ensure it is a valid .ics or .json file.`,
          });
          return;
        }
        if (events.length > MAX_CALENDAR_EVENTS) {
          setIcsImportMsg({ type: "error", text: "Calendar files may contain at most 1,000 events." });
          return;
        }
        setIcsCalendarId((current) => current || calendars[0]?.id || "");
        setIcsFile({ name: file.name, size: file.size });
        setParsedIcsFormat(trimmed.startsWith("[") || trimmed.startsWith("{") ? "JSON" : "ICS");
        setParsedEvents(events);
        setSkippedEvents(skipped.length);
      } catch (err) {
        setIcsImportMsg({ type: "error", text: `Failed to parse file: ${friendlyError(err)}` });
      }
    };
    reader.onerror = () => {
      setIcsImportMsg({ type: "error", text: "Failed to read file from disk." });
    };
    reader.readAsText(file);
  }

  function onIcsInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      handleIcsFileRead(file);
    }
    e.target.value = "";
  }

  function handleIcsDrag(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIcsDragActive(true);
    } else if (e.type === "dragleave") {
      setIcsDragActive(false);
    }
  }

  function handleIcsDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIcsDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleIcsFileRead(file);
    }
  }

  function resetIcsImport() {
    setIcsFile(null);
    setParsedIcsFormat(null);
    setParsedEvents([]);
    setSkippedEvents(0);
    setIcsProgress(null);
    setIsCreatingCalendar(false);
    setNewCalendarName("");
  }

  async function createIcsCalendar(name: string): Promise<string> {
    const id = await putCalendar(session, { name, color: DEFAULT_CALENDAR_COLOR });
    setIcsCalendarId(id);
    return id;
  }

  async function handleExecuteIcsImport() {
    if (parsedEvents.length === 0) return;

    setImportingIcs(true);
    setIcsImportMsg(null);
    setIcsProgress({ current: 0, total: parsedEvents.length });
    const importedEventIds: string[] = [];
    let createdCalendarId: string | undefined;

    try {
      let finalCalendarId = icsCalendarId;
      const creatingName = newCalendarName.trim();

      if (isCreatingCalendar && creatingName) {
        finalCalendarId = await createIcsCalendar(creatingName);
        createdCalendarId = finalCalendarId;
      }

      for (let offset = 0; offset < parsedEvents.length; offset += 256) {
        const batch = parsedEvents.slice(offset, offset + 256).map((event) => ({
          ...event,
          calendarId: finalCalendarId,
        }));
        importedEventIds.push(...await putCalendarEvents(session, batch));
        setIcsProgress({ current: Math.min(offset + batch.length, parsedEvents.length), total: parsedEvents.length });
      }

      await onRefresh();

      const calendarName = isCreatingCalendar && creatingName
        ? creatingName
        : calendars.find((calendar) => calendar.id === finalCalendarId)?.name ?? "your calendar";
      setIcsImportMsg({
        type: "success",
        text: `Successfully imported ${parsedEvents.length} event${
          parsedEvents.length === 1 ? "" : "s"
        } into "${calendarName}".${
          skippedEvents ? ` ${skippedEvents} could not be read and were skipped.` : ""
        }`,
      });

      resetIcsImport();
    } catch (err) {
      await Promise.allSettled(importedEventIds.map((id) => deleteCalendarEvent(session, id)));
      if (createdCalendarId) await deleteCalendar(session, createdCalendarId);
      if (importedEventIds.length > 0 || createdCalendarId) await onRefresh();
      setIcsImportMsg({ type: "error", text: `Import failed: ${friendlyError(err)}` });
    } finally {
      setImportingIcs(false);
      setIcsProgress(null);
    }
  }

  function exportCalendar() {
    if (exportEvents.length === 0) {
      setIcsExportMsg({
        type: "error",
        text: "No events available to export in the selected calendar.",
      });
      return;
    }
    setIcsExportMsg(null);
    try {
      const name = exportCalendarId === "all"
        ? "Sealbook"
        : calendars.find((calendar) => calendar.id === exportCalendarId)?.name ?? "Sealbook";
      const stamp = new Date().toISOString().slice(0, 10);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "calendar";
      const filename = `${slug}-${stamp}.${calendarExportFormat}`;
      if (calendarExportFormat === "json") {
        triggerDownload(filename, "application/json", JSON.stringify(exportEvents, null, 2));
      } else {
        triggerDownload(filename, "text/calendar;charset=utf-8", formatIcs(exportEvents, name));
      }
      setIcsExportMsg({
        type: "success",
        text: `Exported ${exportEvents.length} event${
          exportEvents.length === 1 ? "" : "s"
        } as "${filename}".`,
      });
    } catch (err) {
      setIcsExportMsg({ type: "error", text: `Export failed: ${friendlyError(err)}` });
    }
  }

  // A disabled feature keeps no settings page: its import, export, and display
  // options are for a tab that is not there. Derived rather than corrected in an
  // effect, so the page being read cannot be one that has just gone away.
  const sections = SECTIONS.filter(
    (section) =>
      section.id === "account" ||
      section.id === "features" ||
      section.id === "appearance" ||
      isFeatureEnabled(accountSettings, section.id),
  );
  const activeSection = sections.some((section) => section.id === activeSectionState)
    ? activeSectionState
    : "account";
  // Until the list loads, the milder warning is still true, so it is the default.
  const onlyDevice =
    devices !== null &&
    !devices.some((device) => device.device_id !== session.state.device_id);

  return (
    <div className="grid gap-8 animate-fade-in-up lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="h-fit rounded-2xl border border-line bg-panel/75 p-3 shadow-sm lg:sticky lg:top-6">
        <div className="px-3 pb-3 pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mute/70">
            Settings
          </p>
          <p className="mt-1 text-xs leading-relaxed text-mute">
            Manage your Sealbook workspace
          </p>
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Settings sections">
          {sections.map(({ id, label, nav: description }) => (
            <button
              key={id}
              type="button"
              aria-current={activeSection === id ? "page" : undefined}
              onClick={() => setActiveSection(id)}
              className={`min-w-[190px] rounded-xl border px-3 py-3 text-left transition-colors lg:min-w-0 ${activeSection === id
                ? "border-accent/30 bg-accent/10 text-text"
                : "border-transparent text-mute hover:border-line hover:bg-surface/60 hover:text-text"
                }`}
            >
              <span className="block text-sm font-semibold">{label}</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-mute">
                {description}
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 space-y-8">
        <div className="border-b border-line pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            Preferences
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-text">
            {sections.find((section) => section.id === activeSection)?.label}
          </h2>
          <p className="mt-1 text-sm text-mute">
            {sections.find((section) => section.id === activeSection)?.blurb}
          </p>
        </div>

      {activeSection === "features" && (
        <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm">
          <h3 className="text-base font-semibold text-text">Enabled features</h3>
          <p className="mt-1 text-xs leading-relaxed text-mute">
            Turning one off hides its tab and its settings on every device signed in to
            this account. Nothing is deleted: the entries stay in your vault and come
            back when you turn the feature on again.
          </p>

          <ul className="mt-5 space-y-3">
            {FEATURES.map((feature) => {
              const enabled = isFeatureEnabled(accountSettings, feature);
              // The last one on cannot be turned off, so its switch is disabled
              // rather than left to fail on click.
              const isLastEnabled = enabled && !canDisableFeature(accountSettings, feature);
              const label = FEATURE_LABELS[feature];
              return (
                <li
                  key={feature}
                  className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-bg/50 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text">{label}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-mute">
                      {isLastEnabled
                        ? "Your only enabled feature, so it has to stay on."
                        : enabled
                          ? "Available on every device on this account."
                          : "Hidden on every device on this account."}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${label} enabled`}
                    disabled={isLastEnabled || featureBusy !== null}
                    onClick={() => void handleToggleFeature(feature, !enabled)}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${enabled
                      ? "border-accent/40 bg-accent"
                      : "border-line bg-surface"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-block h-4 w-4 rounded-full bg-bg transition-transform duration-150 ${enabled ? "translate-x-[22px]" : "translate-x-1"}`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>

          {featureMsg ? (
            <p
              role="alert"
              className={`mt-4 rounded-lg border px-3 py-2 text-xs leading-relaxed ${featureMsg.type === "success"
                ? "border-line bg-bg text-mute"
                : "border-danger/30 bg-danger/10 text-danger"}`}
            >
              {featureMsg.text}
            </p>
          ) : null}
        </section>
      )}

      {activeSection === "appearance" && (
        <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm">
          <h3 className="text-base font-semibold text-text">Accent colour</h3>
          <p className="mt-1 text-xs leading-relaxed text-mute">
            The accent tints buttons, links, selected rows, and focus rings. Calendar
            colours are set per calendar and are left alone, as is the gold a note being
            edited is marked with.
          </p>

          <div
            role="radiogroup"
            aria-label="Accent colour"
            className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {ACCENTS.map((accent) => {
              const active = normalizeAccent(accountSettings.accent) === accent;
              const { base, dim } = ACCENT_COLORS[accent];
              return (
                <button
                  key={accent}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={accentBusy !== null}
                  onClick={() => void handleAccent(accent)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${active
                    ? "border-accent/40 bg-accent/10"
                    : "border-line/80 bg-bg/50 hover:border-line-light"}`}
                >
                  {/* The one place the colour cannot come from the accent
                      tokens: a swatch has to show the accent it offers, not the
                      one the account is already on. */}
                  <span
                    aria-hidden="true"
                    style={{ backgroundColor: base, borderColor: dim }}
                    className="h-6 w-6 shrink-0 rounded-full border"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text">
                      {ACCENT_LABELS[accent]}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-mute">
                      {accentBusy === accent
                        ? "Saving\u2026"
                        : active
                          ? "Currently in use."
                          : base}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {accentMsg ? (
            <p
              role="alert"
              className={`mt-4 rounded-lg border px-3 py-2 text-xs leading-relaxed ${accentMsg.type === "success"
                ? "border-line bg-bg text-mute"
                : "border-danger/30 bg-danger/10 text-danger"}`}
            >
              {accentMsg.text}
            </p>
          ) : null}
        </section>
      )}

      {activeSection === "calendar" && (<>
        <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm">
          <h3 className="text-base font-semibold text-text">Calendar timezone</h3>
          <select value={timezone} onChange={(event) => onTimezoneChange(event.target.value)} className={`${field} mt-5`}>
            {[...new Set([timezone, ...allTimezones])].map((zone) => <option key={zone} value={zone}>{zone} [{utcOffsetLabel(zone)}]</option>)}
          </select>
        </section>

        <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm space-y-8">
          <div>
            <h3 className="text-base font-semibold text-text">
              Import &amp; Export Calendars
            </h3>
            <p className="mt-1 text-xs text-mute leading-relaxed">
              Move events between Sealbook and Apple Calendar, Google Calendar, or
              Outlook using the standard ICS format, or export encrypted backups.
            </p>
          </div>

          {/* SUB-SECTION 1: IMPORT */}
          <div className="rounded-xl border border-line/80 bg-bg/50 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
                  ↓
                </span>
                <h4 className="text-sm font-semibold text-text">Import Events</h4>
              </div>
              <span className="text-[11px] text-mute font-mono">
                .ics, .json
              </span>
            </div>

            {/* Dropzone / File Picker */}
            {!icsFile ? (
              // The file input below is `display: none`, so it is not in the
              // accessibility tree and cannot be tabbed to. This zone is the only
              // way to pick a file, so it carries the button semantics and the
              // keyboard activation itself.
              <div
                role="button"
                tabIndex={0}
                aria-label="Choose a calendar file to import, or drop one here"
                onDragEnter={handleIcsDrag}
                onDragLeave={handleIcsDrag}
                onDragOver={handleIcsDrag}
                onDrop={handleIcsDrop}
                onClick={() => icsInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  icsInputRef.current?.click();
                }}
                className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-7 text-center transition-all cursor-pointer ${focusRing} ${
                  icsDragActive
                    ? "border-accent bg-accent/10 scale-[0.99]"
                    : "border-line/80 hover:border-line-light hover:bg-surface/30"
                }`}
              >
                <input
                  ref={icsInputRef}
                  type="file"
                  accept=".ics,.json,text/calendar,application/json"
                  onChange={onIcsInputChange}
                  className="hidden"
                />
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface border border-line text-accent mb-2">
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.56l2.22 2.22a.75.75 0 1 0 1.06-1.06l-3.5-3.5a.75.75 0 0 0-1.06 0l-3.5 3.5a.75.75 0 0 0 1.06 1.06l2.22-2.22v8.69ZM3.5 14.25a.75.75 0 0 1 .75.75v1.5c0 .414.336.75.75.75h10a.75.75 0 0 0 .75-.75V15a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 15 18.75H5A2.25 2.25 0 0 1 2.75 16.5V15a.75.75 0 0 1 .75-.75Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <p className="text-xs font-medium text-text">
                  Click to select file or drag &amp; drop here
                </p>
                <p className="mt-1 text-[11px] text-mute">
                  Supports Apple Calendar / Google Calendar / Outlook (.ics), or Sealbook (.json)
                </p>
              </div>
            ) : (
              /* File Preview & Calendar Selection */
              <div className="space-y-4 rounded-xl border border-accent/30 bg-surface/40 p-4 animate-fade-in">
                <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3">
                  <div>
                    <p className="text-xs font-semibold text-text truncate max-w-xs sm:max-w-sm">
                      {icsFile.name}
                    </p>
                    <p className="text-[11px] text-accent font-medium mt-0.5">
                      Detected {parsedIcsFormat} · {parsedEvents.length} event
                      {parsedEvents.length === 1 ? "" : "s"} found
                      {skippedEvents ? ` · ${skippedEvents} unreadable and skipped` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={importingIcs}
                    onClick={resetIcsImport}
                    className="text-xs text-mute hover:text-text cursor-pointer"
                  >
                    Change file
                  </button>
                </div>

                {/* Calendar Selection Prompt */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <label htmlFor={`${ids}-ics-calendar`} className="text-xs font-medium text-text">
                      Target Calendar
                    </label>
                    <button
                      type="button"
                      disabled={importingIcs}
                      onClick={() => setIsCreatingCalendar(!isCreatingCalendar)}
                      className="text-[11px] text-accent hover:underline cursor-pointer"
                    >
                      {isCreatingCalendar ? "Select existing calendar" : "+ Create new calendar"}
                    </button>
                  </div>

                  {isCreatingCalendar || calendars.length === 0 ? (
                    <input
                      id={`${ids}-ics-calendar`}
                      type="text"
                      value={newCalendarName}
                      onChange={(e) => setNewCalendarName(e.target.value)}
                      placeholder="e.g. Work, Personal, Travel"
                      className={field}
                      disabled={importingIcs}
                      autoFocus
                    />
                  ) : (
                    <select
                      id={`${ids}-ics-calendar`}
                      value={icsCalendarId}
                      onChange={(e) => setIcsCalendarId(e.target.value)}
                      disabled={importingIcs}
                      className={selectField}
                    >
                      {calendars.map((calendar) => (
                        <option key={calendar.id} value={calendar.id}>
                          {calendar.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Sample Event Preview */}
                <div className="rounded-lg border border-line/70 bg-bg/70 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                    Preview (First {Math.min(parsedEvents.length, 3)} of{" "}
                    {parsedEvents.length})
                  </p>
                  <div className="space-y-1.5 text-xs">
                    {parsedEvents.slice(0, 3).map((event, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between py-1 border-b border-line/40 last:border-0"
                      >
                        <span className="font-medium text-text truncate max-w-[160px]">
                          {event.title}
                        </span>
                        <span className="text-mute truncate max-w-[180px] text-[11px] font-mono">
                          {event.start.slice(0, 16).replace("T", " ")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Progress Bar */}
                {importingIcs && icsProgress && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-[11px] text-mute">
                      <span>Encrypting &amp; uploading events…</span>
                      <span className="font-mono font-medium text-accent">
                        {icsProgress.current} / {icsProgress.total}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface border border-line">
                      <div
                        className="h-full bg-accent transition-all duration-150"
                        style={{
                          width: `${(icsProgress.current / icsProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    disabled={importingIcs}
                    onClick={resetIcsImport}
                    className={btnSecondary}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      importingIcs ||
                      ((isCreatingCalendar || calendars.length === 0) && !newCalendarName.trim()) ||
                      (!isCreatingCalendar && calendars.length > 0 && !icsCalendarId) ||
                      parsedEvents.length === 0
                    }
                    onClick={handleExecuteIcsImport}
                    className={btnPrimary}
                  >
                    {importingIcs
                      ? `Importing (${icsProgress?.current || 0}/${parsedEvents.length})…`
                      : `Import ${parsedEvents.length} Event${
                          parsedEvents.length === 1 ? "" : "s"
                        }`}
                  </button>
                </div>
              </div>
            )}

            {icsImportMsg && (
              <div
                className={`rounded-lg px-3 py-2 text-xs font-medium ${
                  icsImportMsg.type === "success"
                    ? "bg-accent/10 text-accent border border-accent/20"
                    : "bg-danger/10 text-danger border border-danger/20"
                }`}
              >
                {icsImportMsg.text}
              </div>
            )}
          </div>

          {/* SUB-SECTION 2: EXPORT */}
          <div className="rounded-xl border border-line/80 bg-bg/50 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
                  ↑
                </span>
                <h4 className="text-sm font-semibold text-text">Export Events</h4>
              </div>
              <span className="text-[11px] text-mute font-mono">
                {exportEvents.length} event{exportEvents.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Source Calendar */}
              <div>
                <label htmlFor={`${ids}-export-calendar`} className="block text-xs font-medium text-text mb-1">
                  Source Calendar
                </label>
                <select
                  id={`${ids}-export-calendar`}
                  value={exportCalendarId}
                  onChange={(e) => setExportCalendarId(e.target.value)}
                  className={selectField}
                >
                  <option value="all">
                    All Calendars ({calendarEvents.length})
                  </option>
                  {calendars.map((calendar) => {
                    const count = calendarEvents.filter(
                      (event) => event.calendarId === calendar.id,
                    ).length;
                    return (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.name} ({count})
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Export Format */}
              <div>
                <label htmlFor={`${ids}-export-format`} className="block text-xs font-medium text-text mb-1">
                  Export Format
                </label>
                <select
                  id={`${ids}-export-format`}
                  value={calendarExportFormat}
                  onChange={(e) => setCalendarExportFormat(e.target.value as "ics" | "json")}
                  className={selectField}
                >
                  <option value="ics">
                    iCalendar (.ics) · Apple, Google, Outlook
                  </option>
                  <option value="json">
                    JSON (.json) · Lossless Full Backup
                  </option>
                </select>
              </div>
            </div>

            {icsExportMsg && (
              <div
                className={`rounded-lg px-3 py-2 text-xs font-medium ${
                  icsExportMsg.type === "success"
                    ? "bg-accent/10 text-accent border border-accent/20"
                    : "bg-danger/10 text-danger border border-danger/20"
                }`}
              >
                {icsExportMsg.text}
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                disabled={exportEvents.length === 0}
                onClick={exportCalendar}
                className={btnPrimary}
              >
                Export {exportEvents.length} Event
                {exportEvents.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </section>
      </>)}

      {activeSection === "account" && <>
      <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-text">Username</h3>
          </div>
          <span className="inline-flex items-center rounded-full bg-accent/15 px-3 py-1 font-mono text-xs font-semibold text-accent border border-accent/20">
            {session.state.username}
          </span>
        </div>

        <form onSubmit={handleChangeUsername} className="mt-6 space-y-4">
          <div>
            <label htmlFor={`${ids}-new-username`} className="block text-xs font-medium text-text">
              New Username
            </label>
            <input
              id={`${ids}-new-username`}
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Enter new username"
              className={field}
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor={`${ids}-username-password`} className="block text-xs font-medium text-text">
              Current Password (to confirm)
            </label>
            <PasswordField
              id={`${ids}-username-password`}
              value={usernamePassword}
              onChange={(e) => setUsernamePassword(e.target.value)}
              placeholder="Current password"
              className={field}
              autoComplete="current-password"
            />
          </div>

          {usernameMsg && (
            <div
              className={`rounded-lg px-3 py-2 text-xs font-medium ${usernameMsg.type === "success"
                ? "bg-accent/10 text-accent border border-accent/20"
                : "bg-danger/10 text-danger border border-danger/20"
                }`}
            >
              {usernameMsg.text}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={usernameBusy || !newUsername || !usernamePassword}
              className={btnPrimary}
            >
              {usernameBusy ? "Updating…" : "Update Username"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm">
        <div>
          <h3 className="text-base font-semibold text-text">Change Password</h3>
        </div>
        <form onSubmit={handleChangePassword} className="mt-6 space-y-4">
          <div>
            <label htmlFor={`${ids}-current-password`} className="block text-xs font-medium text-text">
              Current Password
            </label>
            <PasswordField
              id={`${ids}-current-password`}
              value={passwordCurrent}
              onChange={(e) => setPasswordCurrent(e.target.value)}
              placeholder="Current password"
              className={field}
              autoComplete="current-password"
            />
          </div>

          <div>
            <label htmlFor={`${ids}-new-password`} className="block text-xs font-medium text-text">
              New Password
            </label>
            <PasswordField
              id={`${ids}-new-password`}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={field}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label htmlFor={`${ids}-confirm-password`} className="block text-xs font-medium text-text">
              Confirm New Password
            </label>
            <PasswordField
              id={`${ids}-confirm-password`}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-type new password"
              className={field}
              autoComplete="new-password"
            />
          </div>

          {passwordMsg && (
            <div
              className={`rounded-lg px-3 py-2 text-xs font-medium ${passwordMsg.type === "success"
                ? "bg-accent/10 text-accent border border-accent/20"
                : "bg-danger/10 text-danger border border-danger/20"
                }`}
            >
              {passwordMsg.text}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={passwordBusy || !passwordCurrent || !newPassword || !confirmPassword}
              className={btnPrimary}
            >
              {passwordBusy ? "Updating…" : "Change Password"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-text">Paired devices</h3>
          <p className="text-xs leading-relaxed text-mute max-w-md">
            Every device signed in to this account. Revoking one rotates the vault
            key and re-encrypts your data, so the removed device keeps nothing it
            can still read.
          </p>
        </div>

        <div className="mt-5 space-y-2">
          {devices === null ? (
            <p className="text-xs text-mute">Loading devices...</p>
          ) : devices.length === 0 ? (
            <p className="text-xs text-mute">No devices found.</p>
          ) : (
            devices.map((device) => {
              const isCurrent = device.device_id === session.state.device_id;
              return (
                <div
                  key={device.device_id}
                  className="flex items-center gap-3 rounded-xl border border-line bg-bg/60 px-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs text-text">
                      {device.device_id}
                    </span>
                    {isCurrent ? (
                      <span className="mt-0.5 block text-[11px] text-accent">This device</span>
                    ) : null}
                  </span>
                  {isCurrent ? null : (
                    <button
                      type="button"
                      onClick={() => { setRevokeTarget(device); setRevokePassword(""); setRevokeError(null); setDevicesMsg(null); }}
                      className={`${btnSecondary} shrink-0`}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {devicesMsg ? (
          <p
            role="alert"
            className={`mt-4 rounded-lg border px-3 py-2 text-xs leading-relaxed ${devicesMsg.type === "success"
              ? "border-line bg-bg text-mute"
              : "border-danger/30 bg-danger/10 text-danger"}`}
          >
            {devicesMsg.text}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-text">
              Backup Recovery Codes
            </h3>
            <p className="mt-1 text-xs text-mute max-w-md leading-relaxed">
              Generate a new 24-word recovery phrase. Generating a new phrase{" "}
              <strong className="text-text">
                immediately deletes and replaces your old phrase
              </strong>{" "}
              on the server.
            </p>
          </div>
          <button
            type="button"
            disabled={phraseBusy}
            onClick={() => setShowPhraseConfirm(true)}
            className={`${btnSecondary} shrink-0`}
          >
            {phraseBusy ? "Generating…" : "Generate New Codes"}
          </button>
        </div>

        {phraseMsg && (
          <div
            className={`mt-4 rounded-lg px-3 py-2 text-xs font-medium ${phraseMsg.type === "success"
              ? "bg-accent/10 text-accent border border-accent/20"
              : "bg-danger/10 text-danger border border-danger/20"
              }`}
          >
            {phraseMsg.text}
          </div>
        )}

        {/* Display newly generated 24 words */}
        {newWords && (
          <div className="mt-6 rounded-xl border border-accent/30 bg-bg/70 p-5 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                Active 24-Word Recovery Phrase
              </span>
              <span className="text-[11px] text-mute">
                Save immediately; old codes are invalid
              </span>
            </div>

            <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
              {newWords.map((word, index) => (
                <li
                  key={`${index}-${word}`}
                  className="flex items-center gap-2 font-mono bg-panel/50 px-2.5 py-1.5 rounded-md border border-line/60"
                >
                  <span className="w-5 text-right text-mute/70 select-none text-[10px]">
                    {index + 1}
                  </span>
                  <span className="text-text font-medium">{word}</span>
                </li>
              ))}
            </ol>

            <div className="mt-5 flex flex-wrap gap-2.5">
              <button
                type="button"
                className={btnSecondary}
                onClick={copyWords}
              >
                {copiedPhrase ? "✓ Copied!" : "📋 Copy All"}
              </button>
              <button
                type="button"
                className={btnSecondary}
                onClick={downloadWords}
              >
                ⬇ Download .txt
              </button>
              <button
                type="button"
                className={btnSecondary}
                onClick={printWords}
              >
                🖨 Print / PDF
              </button>
            </div>
          </div>
        )}

        {/* Confirm generation modal */}
        {showPhraseConfirm && (
          <Modal
            title="Generate New Recovery Words?"
            onClose={() => setShowPhraseConfirm(false)}
          >
            <div className="p-6 space-y-4">
              <p className="text-sm text-text leading-relaxed">
                This mints a new vault key, re-encrypts everything under it, and
                wraps it for your new recovery words. Replacing the words alone
                would not be enough: anyone who has ever seen your old words could
                still decrypt, because the key they unlock would not have changed.
              </p>
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-3.5 text-xs text-warning leading-relaxed">
                ⚠️ <strong>Warning:</strong> Your previously saved backup words
                stop working immediately. Write the new ones down.
              </div>
              <PasswordField
                value={phrasePassword}
                onChange={(event) => setPhrasePassword(event.target.value)}
                placeholder="Current password"
                className={field}
                autoComplete="current-password"
              />
              {phraseBusy && phraseProgress.total > 0 && (
                <p className="text-xs text-muted">
                  Re-encrypting {phraseProgress.done} of {phraseProgress.total}…
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => {
                    setShowPhraseConfirm(false);
                    setPhrasePassword("");
                  }}
                  disabled={phraseBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={handleGeneratePhrase}
                  disabled={phraseBusy || !phrasePassword}
                >
                  {phraseBusy ? "Rotating…" : "Yes, Generate New Codes"}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </section>

      </>}

      {activeSection === "contacts" && (<>
        <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm">
          <h3 className="text-base font-semibold text-text">Contact detail</h3>
          <p className="mt-1 text-xs leading-relaxed text-mute">
            Detailed contacts turn the address book into a personal relationship manager:
            how you met, interests, food, music, pets, career and relationship history,
            life events, family and friends. Switching back to basic hides those sections
            without deleting anything.
          </p>

          <div
            role="radiogroup"
            aria-label="Contact detail level"
            className="mt-5 grid gap-3 sm:grid-cols-2"
          >
            {CONTACT_MODES.map((mode) => {
              const active = normalizeContactMode(accountSettings.contactMode) === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={contactModeBusy}
                  onClick={() => void handleContactMode(mode)}
                  className={`rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${active
                    ? "border-accent/40 bg-accent/10"
                    : "border-line/80 bg-bg/50 hover:border-line-light"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-text">
                      {CONTACT_MODE_LABELS[mode]}
                    </span>
                    {active ? (
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
                        Active
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-mute">
                    {mode === "basic"
                      ? "Names, channels, dates, socials, work, address and notes."
                      : "Everything in basic, plus ten relationship sections you add one at a time."}
                  </span>
                </button>
              );
            })}
          </div>

          {contactModeMsg ? (
            <p
              role="alert"
              className={`mt-4 rounded-lg border px-3 py-2 text-xs leading-relaxed ${contactModeMsg.type === "success"
                ? "border-line bg-bg text-mute"
                : "border-danger/30 bg-danger/10 text-danger"}`}
            >
              {contactModeMsg.text}
            </p>
          ) : null}
        </section>

        <ImportExportSection
          session={session}
          contacts={contacts}
          addressBooks={addressBooks}
          onRefresh={onRefresh}
          onCreateBook={onCreateBook}
        />
      </>)}

      {activeSection === "notes" && (
        <NotesImportExportSection
          session={session}
          notes={notes}
          notebooks={notebooks}
          onRefresh={onRefresh}
          onCreateNotebook={onCreateNotebook}
        />
      )}

      {activeSection === "account" && (
        <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-text">Sign out</h3>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-mute">
                Removes this device's keys from this browser. Your account and
                everything in it stays on the server.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSignOutConfirm(true)}
              className={`${btnSecondary} shrink-0 px-5`}
            >
              Sign out…
            </button>
          </div>

          <div className="mt-5 rounded-lg border border-danger/30 bg-danger/10 p-3.5 text-xs leading-relaxed text-danger">
            {onlyDevice
              ? `This is the only device signed in to ${session.state.username}. Your 24 recovery words are the only way back in, so make sure you have them before you sign out.`
              : "To get back in you will need another device that is still signed in, or your 24 recovery words."}
          </div>
        </section>
      )}

      {activeSection === "account" && <AccountExportSection session={session} />}

      {activeSection === "account" && <>
      <section className="rounded-2xl border border-danger/40 bg-danger/5 backdrop-blur-md p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-danger">Danger Zone</h3>
            <p className="mt-1 text-xs text-mute max-w-md leading-relaxed">
              Permanently purge your account, contacts, encrypted backups,
              paired devices, and active sessions from this server.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setDeleteConfirmText("");
              setDeletePassword("");
              setDeleteError(null);
              setShowDeleteModal(true);
            }}
            className={`${btnDanger} shrink-0 px-5`}
          >
            Delete Account…
          </button>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <Modal
            title="Delete Account"
            onClose={() => !deleteBusy && setShowDeleteModal(false)}
          >
            <div className="p-6 space-y-4">
              <p className="text-sm text-text leading-relaxed">
                This action is <strong className="text-danger">irreversible</strong>.
                All your encrypted contacts, calendar, notes, key wraps, sessions, and
                device enrollments will be purged from the server database immediately.
              </p>
              <div className="rounded-lg border border-danger/30 bg-danger/10 p-3.5 text-xs text-danger leading-relaxed">
                To confirm deletion, type your username{" "}
                <span className="font-mono font-bold">
                  {session.state.username}
                </span>{" "}
                below:
              </div>

              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={session.state.username}
                className={field}
                autoFocus
              />

              <PasswordField
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Current password"
                className={field}
                autoComplete="current-password"
              />

              {deleteError && (
                <p className="text-xs text-danger">{deleteError}</p>
              )}

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  disabled={deleteBusy}
                  className={btnSecondary}
                  onClick={() => setShowDeleteModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    deleteBusy ||
                    deleteConfirmText.trim() !== session.state.username ||
                    !deletePassword
                  }
                  className={`${btnDanger} px-5`}
                  onClick={handleDeleteAccount}
                >
                  {deleteBusy ? "Deleting…" : "Permanently Delete Account"}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </section>
      </>}
      {signOutConfirm ? (
        <ConfirmDialog
          title="Sign out"
          heading="Sign out of this device?"
          body={
            <span className="block space-y-3">
              <span className="block">
                This device's keys are removed from this browser. Nothing is
                deleted from your account.
              </span>
              <span className="block">
                {onlyDevice
                  ? "No other device is signed in, so your 24 recovery words are the only way back into this account. If you do not have them written down, cancel and keep this device signed in."
                  : "To get back in you will need to pair from another signed-in device, or use your 24 recovery words."}
              </span>
            </span>
          }
          confirmLabel="Sign out"
          onConfirm={() => {
            setSignOutConfirm(false);
            onSignOut();
          }}
          onClose={() => setSignOutConfirm(false)}
        />
      ) : null}
      {revokeTarget ? (
        <ConfirmDialog
          title="Revoke device"
          heading="Revoke this device?"
          tone="danger"
          body={
            <span className="block space-y-3">
              <span className="block">
                This device loses access immediately. Your vault key is rotated and
                every item re-encrypted, so any copy it kept cannot be read.
              </span>
              <span className="block">
                It also replaces your recovery phrase: the current one stops working
                and the new one is shown once, straight after.
              </span>
              <span className="block truncate font-mono text-[11px] text-mute">
                {revokeTarget.device_id}
              </span>
              <label className="block text-xs font-medium text-mute">
                Confirm your password
                <input
                  type="password"
                  autoFocus
                  value={revokePassword}
                  onChange={(event) => { setRevokePassword(event.target.value); setRevokeError(null); }}
                  disabled={revokeBusy}
                  className={field}
                  autoComplete="current-password"
                />
              </label>
            </span>
          }
          confirmLabel="Revoke device"
          busyLabel={revokeProgress.total > 0
            ? `Re-encrypting ${revokeProgress.done} of ${revokeProgress.total}...`
            : "Revoking..."}
          busy={revokeBusy}
          error={revokeError}
          onConfirm={() => void handleRevokeDevice()}
          onClose={() => { if (!revokeBusy) { setRevokeTarget(null); setRevokePassword(""); setRevokeError(null); } }}
        />
      ) : null}
      </div>
    </div>
  );
}
