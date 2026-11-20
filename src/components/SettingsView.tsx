import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { DeviceEntry, DeviceLabel, DeviceSummary, Session } from "../lib/client";
import { usePhraseConfirm } from "../lib/usePhraseConfirm";
import {
  changePassword,
  changeUsername,
  deleteAccount,
  deviceEntries,
  listDevices,
  MAX_DEVICE_NAME_CHARS,
  removeStaleDeviceLabels,
  renameDevice,
  revokeDevices,
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
import { formatRecoveryWordsFile } from "../lib/phrase";
import { clearDevice } from "../lib/storage";
import { friendlyError } from "../lib/errors";
import {
  btnDanger,
  btnDangerGhostSm,
  btnPrimary,
  btnPrimarySm,
  btnSecondary,
  field,
  fieldLabel,
  focusRing,
  selectField,
  sidebarRowState,
  viewMain,
  viewGrid,
  sidebarRow,
} from "../lib/styles";
import type {
  AccentKey,
  AccountSettings,
  AddressBook,
  Bookmark,
  BookmarkCollection,
  Task,
  TaskList,
  Calendar,
  CalendarEvent,
  Contact,
  ContactMode,
  FeatureKey,
  Note,
  Notebook,
} from "../lib/types";
import { allTimezones, utcOffsetLabel } from "../lib/timezone";
import type { WeekStart } from "../lib/calendarModel";
import { AUTO_LOCK_OPTIONS, autoLockLabel, MIN_PASSWORD_LENGTH, type AutoLockMinutes } from "../lib/appState";
import { newPasswordProblem } from "../lib/strength";
import { PAGE_GROUPS, pageForSection, type SettingsPage, type SettingsSection } from "../lib/settingsModel";
import { Icon } from "./Icon";
import { PaneHeader } from "./PaneControls";
import { clearClipboard } from "../lib/clipboard";
import { printRecoveryWords } from "../lib/printPhrase";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal, ModalBody, ModalFooter } from "./Modal";
import { PasswordField } from "./PasswordField";
import { SidebarDrawer, SidebarHeader, SidebarSection, type Sidebar } from "./SidebarDrawer";
import { AccountExportSection } from "./AccountExportSection";
import { AccountImportSection } from "./AccountImportSection";
import { BookmarksImportExportSection } from "./BookmarksImportExportSection";
import { CalendarBulkEditSection } from "./CalendarBulkEditSection";
import { CalendarImportExportSection } from "./CalendarImportExportSection";
import { ImportExportSection } from "./ImportExportSection";
import { NotesImportExportSection } from "./NotesImportExportSection";
import { TasksImportExportSection } from "./TasksImportExportSection";
import {
  Callout,
  NoticeLine,
  SettingsGroup,
  SettingsList,
  SettingsMark,
  SettingsOption,
  SettingsRow,
  Switch,
  actionRow,
  type DeviceMark,
  type Notice,
} from "./SettingsKit";
import { ErrorMessage } from "./ErrorMessage";

export type { SettingsSection } from "../lib/settingsModel";

type Props = {
  session: Session;
  contacts: Contact[];
  addressBooks: AddressBook[];
  calendars: Calendar[];
  calendarEvents: CalendarEvent[];
  notes: Note[];
  notebooks: Notebook[];
  bookmarks: Bookmark[];
  bookmarkCollections: BookmarkCollection[];
  tasks: Task[];
  taskLists: TaskList[];
  onSessionUpdate: (updated: Session) => void;
  onPersistSession: (updated: Session, password: string) => Promise<void>;
  onAccountDeleted: () => void;
  onSignOut: () => void;
  /** Writes queued on this device, which a sign-out would lose. */
  pendingChanges?: number;
  /** Hides what needs the server: devices, account changes, imports. */
  offline?: boolean;
  onRefresh: () => Promise<void>;
  onCreateBook?: (name: string) => Promise<string | undefined>;
  onCreateNotebook?: (name: string) => Promise<string | undefined>;
  onCreateBookmarkCollection?: (name: string) => Promise<string | undefined>;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  weekStart: WeekStart;
  onWeekStartChange: (weekStart: WeekStart) => void;
  autoLockMinutes: AutoLockMinutes;
  onAutoLockMinutesChange: (minutes: AutoLockMinutes) => void;
  accountSettings: AccountSettings;
  /** Every device label in the vault, joined onto the roster for display. */
  deviceLabels?: DeviceLabel[];
  /** Folds a label this view just wrote into the app's listing. */
  onDeviceLabelSaved?: (label: DeviceLabel) => void;
  /** Rejects when the write fails, so the toggle can report it and stay put. */
  onSaveAccountSettings: (settings: AccountSettings) => Promise<void>;
  /**
   * Shows an accent across the app without saving it, and `null` takes it back.
   * Optional so the pages that never offer a choice need not pass one.
   */
  onPreviewAccent?: (accent: AccentKey | null) => void;
  /** Read once on mount; the view unmounts whenever the Settings tab is left. */
  initialSection?: SettingsSection;
  sidebar: Sidebar;
};

const NO_LABELS: DeviceLabel[] = [];

function deviceMark(device: DeviceEntry): DeviceMark | "devices" {
  return device.kind === "unknown" ? "devices" : `device-${device.kind}`;
}

/** Narrow enough that a label and its field read as one line of sight. */
const formColumn = "max-w-sm space-y-4";

export function SettingsView({
  session,
  contacts,
  addressBooks,
  calendars,
  calendarEvents,
  notes,
  notebooks,
  bookmarks,
  bookmarkCollections,
  tasks,
  taskLists,
  onSessionUpdate,
  onPersistSession,
  onAccountDeleted,
  onSignOut,
  pendingChanges = 0,
  offline = false,
  onRefresh,
  onCreateBook,
  onCreateNotebook,
  onCreateBookmarkCollection,
  timezone,
  onTimezoneChange,
  weekStart,
  onWeekStartChange,
  autoLockMinutes,
  onAutoLockMinutesChange,
  accountSettings,
  deviceLabels = NO_LABELS,
  onDeviceLabelSaved,
  onSaveAccountSettings,
  onPreviewAccent,
  initialSection,
  sidebar,
}: Props) {
  const [pageState, setPage] = useState<SettingsPage>(pageForSection(initialSection ?? "account"));
  // Prefix for the ids that tie this view's labels to their controls.
  const ids = useId();

  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState<Notice>(null);

  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<Notice>(null);

  const [phraseBusy, setPhraseBusy] = useState(false);
  const [newWords, setNewWords] = useState<string[] | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [devicesMsg, setDevicesMsg] = useState<Notice>(null);
  const [revokeTargets, setRevokeTargets] = useState<DeviceEntry[]>([]);
  const { confirm: confirmPhrase, dialog: phraseDialog } = usePhraseConfirm();
  const [renaming, setRenaming] = useState<{ deviceId: string; name: string } | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const entries = useMemo(
    () => (devices === null ? null : deviceEntries(session, devices, deviceLabels)),
    [session, devices, deviceLabels],
  );
  const [revokePassword, setRevokePassword] = useState("");
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeProgress, setRevokeProgress] = useState({ done: 0, total: 0 });
  const [copiedPhrase, setCopiedPhrase] = useState(false);
  const [phraseMsg, setPhraseMsg] = useState<Notice>(null);
  const [showPhraseConfirm, setShowPhraseConfirm] = useState(false);
  // Rotating the phrase rotates the vault key, which needs the password to
  // re-wrap it, so this is no longer a one-click action.
  const [phrasePassword, setPhrasePassword] = useState("");
  const [phraseProgress, setPhraseProgress] = useState({ done: 0, total: 0 });

  const [featureBusy, setFeatureBusy] = useState<FeatureKey | null>(null);
  const [featureMsg, setFeatureMsg] = useState<Notice>(null);

  const [accentBusy, setAccentBusy] = useState<AccentKey | null>(null);
  // A preview left running would outlive the page that started it, so leaving
  // the page, however it happens, hands the saved accent back.
  const previewAccent = useRef(onPreviewAccent);
  previewAccent.current = onPreviewAccent;
  useEffect(() => () => previewAccent.current?.(null), []);
  const [accentMsg, setAccentMsg] = useState<Notice>(null);

  const [contactModeBusy, setContactModeBusy] = useState(false);
  const [contactModeMsg, setContactModeMsg] = useState<Notice>(null);

  const [signOutConfirm, setSignOutConfirm] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    const weak = await newPasswordProblem(newPassword, session.state.username);
    if (weak) {
      setPasswordMsg({ type: "error", text: weak });
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
        text: "Password updated. Your other devices sign in with the new one.",
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

  async function handleRenameDevice() {
    if (!renaming) return;
    setRenameBusy(true);
    setDevicesMsg(null);
    try {
      onDeviceLabelSaved?.(await renameDevice(session, deviceLabels, renaming.deviceId, renaming.name));
      setRenaming(null);
    } catch (err) {
      setDevicesMsg({ type: "error", text: friendlyError(err) });
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleRevokeDevice() {
    if (revokeTargets.length === 0) return;
    if (!revokePassword) {
      setRevokeError("Enter your password to confirm.");
      return;
    }
    setRevokeBusy(true);
    setRevokeError(null);
    setDevicesMsg(null);
    setRevokeProgress({ done: 0, total: 0 });
    try {
      const { session: updated, phrase } = await revokeDevices(
        session,
        revokeTargets.map((device) => device.device_id),
        revokePassword,
        confirmPhrase,
        (done, total) => setRevokeProgress({ done, total }),
      );
      await onPersistSession(updated, revokePassword);
      onSessionUpdate(updated);
      // Rotating the key invalidates the old phrase; the card below the devices
      // message is the same one the recovery page renders.
      setNewWords(phrase.split(/\s+/u).filter(Boolean));
      setCopiedPhrase(false);
      setRevokeTargets([]);
      setRevokePassword("");
      setDevicesMsg({
        type: "success",
        text: "Device revoked and the vault key rotated. Save the new recovery phrase below; your previous one no longer works.",
      });
      await removeStaleDeviceLabels(updated, deviceLabels).catch(() => 0);
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
        confirmPhrase,
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
    printRecoveryWords(newWords, "Keep this document safe and secret. Replaces all previous phrases.");
  }

  function copyWords() {
    if (!newWords) return;
    navigator.clipboard.writeText(newWords.join(" ")).then(() => {
      setCopiedPhrase(true);
      setTimeout(() => {
        setCopiedPhrase(false);
        clearClipboard();
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
      await clearDevice();
      setShowDeleteModal(false);
      onAccountDeleted();
    } catch (err) {
      setDeleteError(friendlyError(err));
      setDeleteBusy(false);
    }
  }

  // A disabled feature keeps no settings page: its import, export, and display
  // options are for a tab that is not there. Derived rather than corrected in an
  // effect, so the page being read cannot be one that has just gone away.
  const groups = PAGE_GROUPS.map((group) => ({
    ...group,
    pages: group.pages.filter((meta) => !meta.feature || isFeatureEnabled(accountSettings, meta.feature)),
  })).filter((group) => group.pages.length > 0);
  const pages = groups.flatMap((group) => group.pages);
  const page = pages.find((meta) => meta.id === pageState) ?? pages[0];
  // Until the list loads, the milder warning is still true, so it is the default.
  const onlyDevice =
    devices !== null &&
    !devices.some((device) => device.device_id !== session.state.device_id);
  const serverOnly = offline && !page.local;

  function open(id: SettingsPage) {
    setPage(id);
    sidebar.close();
  }

  const recoveryPhraseCard = newWords ? (
    <div className="animate-fade-in overflow-hidden rounded-xl border border-accent/30 bg-panel/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <span className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent">
          New recovery phrase
        </span>
        <span className="text-2xs text-mute">Save it now. The previous phrase no longer works.</span>
      </div>
      <ol className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-4 text-xs sm:grid-cols-3">
        {newWords.map((word, index) => (
          <li key={`${index}-${word}`} className="flex items-center gap-2 font-mono">
            <span className="w-5 select-none text-right text-2xs tabular-nums text-mute/70">{index + 1}</span>
            <span className="font-medium text-text">{word}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
        <button type="button" className={btnSecondary} onClick={copyWords}>
          <Icon name={copiedPhrase ? "check" : "copy"} />
          {copiedPhrase ? "Copied" : "Copy all"}
        </button>
        <button type="button" className={btnSecondary} onClick={downloadWords}>
          Download .txt
        </button>
        <button type="button" className={btnSecondary} onClick={printWords}>
          Print
        </button>
      </div>
      <p className="border-t border-line px-4 py-2.5 text-2xs leading-relaxed text-mute">
        Copying leaves the words in any clipboard history, and the download is a plain text file
        in your Downloads folder, which may be synced. Printing keeps them off the device.
      </p>
    </div>
  ) : null;

  let content: ReactNode = null;
  switch (page.id) {
    case "username":
      content = (
        <SettingsGroup
          title="Change username"
          description={
            <>
              You sign in as <span className="font-mono text-text">{session.state.username}</span>.
            </>
          }
        >
          <form onSubmit={handleChangeUsername} className={formColumn}>
            <div>
              <label htmlFor={`${ids}-new-username`} className={fieldLabel}>
                New username
              </label>
              <input
                id={`${ids}-new-username`}
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="3 to 64 characters"
                className={field}
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor={`${ids}-username-password`} className={fieldLabel}>
                Current password
              </label>
              <PasswordField
                id={`${ids}-username-password`}
                value={usernamePassword}
                onChange={(e) => setUsernamePassword(e.target.value)}
                placeholder="To confirm it is you"
                className={field}
                autoComplete="current-password"
              />
            </div>
            <NoticeLine notice={usernameMsg} />
            <div className={actionRow}>
              <button
                type="submit"
                disabled={usernameBusy || !newUsername || !usernamePassword}
                className={btnPrimary}
              >
                {usernameBusy ? "Updating…" : "Update username"}
              </button>
            </div>
          </form>
        </SettingsGroup>
      );
      break;

    case "password":
      content = (
        <SettingsGroup
          title="Change password"
          description={`Use at least ${MIN_PASSWORD_LENGTH} characters. Other signed-in devices keep their own keys and are not signed out.`}
        >
          <form onSubmit={handleChangePassword} className={formColumn}>
            <div>
              <label htmlFor={`${ids}-current-password`} className={fieldLabel}>
                Current password
              </label>
              <PasswordField
                id={`${ids}-current-password`}
                value={passwordCurrent}
                onChange={(e) => setPasswordCurrent(e.target.value)}
                className={field}
                autoComplete="current-password"
              />
            </div>
            <div>
              <label htmlFor={`${ids}-new-password`} className={fieldLabel}>
                New password
              </label>
              <PasswordField
                id={`${ids}-new-password`}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                className={field}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label htmlFor={`${ids}-confirm-password`} className={fieldLabel}>
                Confirm new password
              </label>
              <PasswordField
                id={`${ids}-confirm-password`}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={field}
                autoComplete="new-password"
              />
            </div>
            <NoticeLine notice={passwordMsg} />
            <div className={actionRow}>
              <button
                type="submit"
                disabled={passwordBusy || !passwordCurrent || !newPassword || !confirmPassword}
                className={btnPrimary}
              >
                {passwordBusy ? "Updating…" : "Change password"}
              </button>
            </div>
          </form>
        </SettingsGroup>
      );
      break;

    case "devices":
      content = (
        <SettingsGroup
          title="Paired devices"
          meta={entries ? `${entries.length} device${entries.length === 1 ? "" : "s"}` : undefined}
          description="Each device names itself and reports what it is. Revoking a device rotates the vault key and re-encrypts your data, so the removed device keeps nothing it can still read."
        >
          {entries === null ? (
            <div role="status">
              <SettingsList>
                {[0, 1].map((row) => (
                  <div key={row} className="flex items-center gap-3 px-4 py-3" aria-hidden="true">
                    <span className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-surface" />
                    <span className="min-w-0 flex-1 space-y-2">
                      <span className="block h-3 w-1/3 animate-pulse rounded-md bg-surface" />
                      <span className="block h-2.5 w-1/2 animate-pulse rounded-md bg-surface/70" />
                    </span>
                  </div>
                ))}
              </SettingsList>
              <span className="sr-only">Loading devices…</span>
            </div>
          ) : entries.length === 0 ? (
            <p className="text-xs text-mute">No devices found.</p>
          ) : (
            <SettingsList>
              {entries.map((device) => {
                const editing = renaming?.deviceId === device.device_id;
                return (
                  <SettingsRow
                    key={device.device_id}
                    lead={
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-mute">
                        <SettingsMark name={deviceMark(device)} />
                      </span>
                    }
                    label={
                      editing ? (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleRenameDevice();
                          }}
                        >
                          <input
                            aria-label="Device name"
                            autoFocus
                            value={renaming.name}
                            maxLength={MAX_DEVICE_NAME_CHARS}
                            placeholder="Leave empty for a generated name"
                            disabled={renameBusy}
                            onChange={(event) => setRenaming({ deviceId: device.device_id, name: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setRenaming(null);
                            }}
                            className={`${field} mt-0 py-1 text-sm`}
                          />
                        </form>
                      ) : (
                        <span title={device.device_id}>{device.name}</span>
                      )
                    }
                    description={
                      <>
                        {device.is_current ? <span className="text-accent">This device</span> : null}
                        {device.is_current && device.detail ? " · " : null}
                        {device.detail}
                      </>
                    }
                    control={
                      editing ? (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            disabled={renameBusy}
                            onClick={() => void handleRenameDevice()}
                            className={`${btnSecondary} px-3 py-1.5 text-xs`}
                          >
                            {renameBusy ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            disabled={renameBusy}
                            onClick={() => setRenaming(null)}
                            className={`${btnSecondary} px-3 py-1.5 text-xs`}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setRenaming({ deviceId: device.device_id, name: device.label ? device.name : "" });
                              setDevicesMsg(null);
                            }}
                            className={`${btnSecondary} px-3 py-1.5 text-xs`}
                          >
                            Rename
                          </button>
                          {device.is_current ? null : (
                            <button
                              type="button"
                              onClick={() => {
                                setRevokeTargets([device]);
                                setRevokePassword("");
                                setRevokeError(null);
                                setDevicesMsg(null);
                              }}
                              className={`${btnSecondary} px-3 py-1.5 text-xs`}
                            >
                              Revoke
                            </button>
                          )}
                        </span>
                      )
                    }
                  />
                );
              })}
            </SettingsList>
          )}
          {entries && entries.filter((device) => !device.is_current).length > 1 ? (
            <div className="pt-2">
              <button
                type="button"
                className={btnSecondary}
                onClick={() => {
                  setRevokeTargets(entries.filter((device) => !device.is_current));
                  setRevokePassword("");
                  setRevokeError(null);
                  setDevicesMsg(null);
                }}
              >
                Revoke all other devices
              </button>
            </div>
          ) : null}
          <NoticeLine notice={devicesMsg} />
          {recoveryPhraseCard}
        </SettingsGroup>
      );
      break;

    case "recovery":
      content = (
        <SettingsGroup
          title="Generate a new recovery phrase"
          description="This mints a new vault key and re-encrypts everything under it, so anyone who has seen the old words can no longer read your vault."
        >
          <Callout tone="warning">
            Your previously saved words stop working as soon as the new ones are made. Have
            somewhere ready to write them down.
          </Callout>
          <NoticeLine notice={phraseMsg} />
          {recoveryPhraseCard}
          <div className={actionRow}>
            <button
              type="button"
              disabled={phraseBusy}
              onClick={() => setShowPhraseConfirm(true)}
              className={btnSecondary}
            >
              {phraseBusy ? "Generating…" : "Generate new phrase…"}
            </button>
          </div>
        </SettingsGroup>
      );
      break;

    case "data":
      content = (
        <>
          <AccountExportSection session={session} />
          <AccountImportSection session={session} onRefresh={onRefresh} />
        </>
      );
      break;

    case "signout":
      content = (
        <SettingsGroup
          title="Sign out of this device"
          description="Removes this device's keys from this browser. Your account and everything in it stays on the server."
        >
          <Callout tone="danger">
            {onlyDevice
              ? `This is the only device signed in to ${session.state.username}. Your 24 recovery words are the only way back in, so make sure you have them before you sign out.`
              : "To get back in you will need another device that is still signed in, or your 24 recovery words."}
          </Callout>
          <div className={actionRow}>
            <button type="button" onClick={() => setSignOutConfirm(true)} className={btnSecondary}>
              Sign out…
            </button>
          </div>
        </SettingsGroup>
      );
      break;

    case "delete":
      content = (
        <SettingsGroup
          title="Delete account"
          tone="danger"
          description="Permanently erases your account, everything in your vault, your paired devices and your sessions from this server. This cannot be undone."
        >
          <div className={actionRow}>
            <button
              type="button"
              onClick={() => {
                setDeleteConfirmText("");
                setDeletePassword("");
                setDeleteError(null);
                setShowDeleteModal(true);
              }}
              className={btnDanger}
            >
              Delete account…
            </button>
          </div>
        </SettingsGroup>
      );
      break;

    case "features":
      content = (
        <SettingsGroup
          title="Enabled features"
          description="Turning one off hides its tab and its settings on every device signed in to this account. Nothing is deleted: the entries stay in your vault and come back when you turn the feature on again."
        >
          <SettingsList>
            {FEATURES.map((feature) => {
              const enabled = isFeatureEnabled(accountSettings, feature);
              // The last one on cannot be turned off, so its switch is disabled
              // rather than left to fail on click.
              const isLastEnabled = enabled && !canDisableFeature(accountSettings, feature);
              const label = FEATURE_LABELS[feature];
              return (
                <SettingsRow
                  key={feature}
                  lead={<SettingsMark name={feature} className="h-4 w-4 shrink-0 text-mute" />}
                  label={label}
                  description={
                    isLastEnabled
                      ? "Your only enabled feature, so it has to stay on."
                      : enabled
                        ? "Available on every device on this account."
                        : "Hidden on every device on this account."
                  }
                  control={
                    <Switch
                      checked={enabled}
                      label={`${label} enabled`}
                      disabled={isLastEnabled || featureBusy !== null}
                      onChange={(next) => void handleToggleFeature(feature, next)}
                    />
                  }
                />
              );
            })}
          </SettingsList>
          <NoticeLine notice={featureMsg} />
        </SettingsGroup>
      );
      break;

    case "appearance":
      content = (
        <SettingsGroup
          title="Accent colour"
          description="The accent tints buttons, links, selected rows and focus rings. Calendar colours are set per calendar and are left alone. Point at a colour to try it before you choose."
        >
          <div role="radiogroup" aria-label="Accent colour" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
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
                  onPointerEnter={() => onPreviewAccent?.(accent)}
                  onPointerLeave={() => onPreviewAccent?.(null)}
                  onFocus={() => onPreviewAccent?.(accent)}
                  onBlur={() => onPreviewAccent?.(null)}
                  className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border px-2 py-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${
                    active
                      ? "border-accent-line bg-accent-soft text-text"
                      : "border-line bg-panel/40 text-mute hover:border-line-light hover:text-text"
                  }`}
                >
                  {/* The one place the colour cannot come from the accent tokens:
                      a swatch shows the accent it offers, not the one in use. */}
                  <span
                    aria-hidden="true"
                    style={{ backgroundImage: `linear-gradient(135deg, ${base}, ${dim})` }}
                    className="flex size-8 items-center justify-center rounded-full"
                  >
                    {active ? <Icon name="check" className="size-4 text-bg" strokeWidth={2.25} /> : null}
                  </span>
                  {ACCENT_LABELS[accent]}
                  {accentBusy === accent ? <span className="sr-only">Saving…</span> : null}
                </button>
              );
            })}
          </div>
          {/* Stand-ins, not controls: the same classes the real ones wear, so a
              preview shows what the accent does to each kind of thing, and so
              that a danger action can be seen to stay apart from it. */}
          <div
            aria-hidden="true"
            className="pointer-events-none mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-line bg-panel/40 p-3"
          >
            <span className={btnPrimarySm}>Primary action</span>
            <span className="flex h-7 items-center rounded-lg bg-accent-soft px-2.5 text-xs font-medium text-text">
              Selected row
            </span>
            <span className="flex h-5 w-9 items-center justify-end rounded-full bg-accent px-0.5">
              <span className="size-3.5 rounded-full bg-on-accent" />
            </span>
            <span className="text-xs font-medium text-accent underline underline-offset-2">A link</span>
            <span className={btnDangerGhostSm}>
              <Icon name="trash" className="size-3.5" />
              Move to trash
            </span>
          </div>
          <NoticeLine notice={accentMsg} />
        </SettingsGroup>
      );
      break;

    case "lock":
      content = (
        <SettingsGroup
          title="Lock after inactivity"
          description="A warning shows shortly before the lock, and any click, key press or scroll starts the timer again. Locking ends the session; unlocking takes your password."
        >
          <SettingsList role="radiogroup" label="Lock after inactivity">
            {AUTO_LOCK_OPTIONS.map((minutes) => (
              <SettingsOption
                key={minutes}
                checked={autoLockMinutes === minutes}
                onSelect={() => onAutoLockMinutesChange(minutes)}
                label={autoLockLabel(minutes)}
                description={
                  minutes === 0
                    ? "The vault stays open until you lock it, reload or close the tab."
                    : undefined
                }
              />
            ))}
          </SettingsList>
        </SettingsGroup>
      );
      break;

    case "contacts":
      content = (
        <>
          <SettingsGroup
            title="Contact detail"
            description="Detailed contacts turn the address book into a personal relationship manager: how you met, interests, food, music, pets, workplace dates, relationship history, life events, family and friends. Switching back to basic hides those sections without deleting anything."
          >
            <SettingsList role="radiogroup" label="Contact detail level">
              {CONTACT_MODES.map((mode) => (
                <SettingsOption
                  key={mode}
                  checked={normalizeContactMode(accountSettings.contactMode) === mode}
                  disabled={contactModeBusy}
                  onSelect={() => void handleContactMode(mode)}
                  label={CONTACT_MODE_LABELS[mode]}
                  description={
                    mode === "basic"
                      ? "Names, channels, dates, socials, work, address and notes."
                      : "Everything in basic, plus ten relationship sections you add one at a time."
                  }
                />
              ))}
            </SettingsList>
            <NoticeLine notice={contactModeMsg} />
          </SettingsGroup>
          <ImportExportSection
            session={session}
            contacts={contacts}
            addressBooks={addressBooks}
            onRefresh={onRefresh}
            onCreateBook={onCreateBook}
          />
        </>
      );
      break;

    case "calendar":
      content = (
        <>
          <SettingsGroup title="Display">
            <SettingsList>
              <SettingsRow
                label={<label htmlFor={`${ids}-timezone`}>Calendar timezone</label>}
                description="Event times are shown in this zone."
                control={
                  <select
                    id={`${ids}-timezone`}
                    value={timezone}
                    onChange={(event) => onTimezoneChange(event.target.value)}
                    className={`${selectField} w-44 sm:w-64`}
                  >
                    {[...new Set([timezone, ...allTimezones])].map((zone) => (
                      <option key={zone} value={zone}>
                        {zone} [{utcOffsetLabel(zone)}]
                      </option>
                    ))}
                  </select>
                }
              />
              <SettingsRow
                label={<label htmlFor={`${ids}-week-start`}>First day of the week</label>}
                description="The day the month, week and year views open each week on."
                control={
                  <select
                    id={`${ids}-week-start`}
                    value={weekStart}
                    onChange={(event) => onWeekStartChange(event.target.value === "1" ? 1 : 0)}
                    className={`${selectField} w-44 sm:w-64`}
                  >
                    <option value={1}>Monday</option>
                    <option value={0}>Sunday</option>
                  </select>
                }
              />
            </SettingsList>
          </SettingsGroup>
          <CalendarBulkEditSection
            session={session}
            calendars={calendars}
            calendarEvents={calendarEvents}
            timezone={timezone}
            onRefresh={onRefresh}
          />
          <CalendarImportExportSection
            session={session}
            calendars={calendars}
            calendarEvents={calendarEvents}
            timezone={timezone}
            onRefresh={onRefresh}
          />
        </>
      );
      break;

    case "notes":
      content = (
        <NotesImportExportSection
          session={session}
          notes={notes}
          notebooks={notebooks}
          onRefresh={onRefresh}
          onCreateNotebook={onCreateNotebook}
        />
      );
      break;

    case "bookmarks":
      content = (
        <BookmarksImportExportSection
          session={session}
          bookmarks={bookmarks}
          bookmarkCollections={bookmarkCollections}
          onRefresh={onRefresh}
          onCreateCollection={onCreateBookmarkCollection}
        />
      );
      break;

    case "tasks":
      content = (
        <TasksImportExportSection session={session} tasks={tasks} taskLists={taskLists} onRefresh={onRefresh} />
      );
      break;
  }

  return (
    <main className={viewMain}>
      <div className={viewGrid} style={sidebar.cols}>
        <SidebarDrawer title="Settings" sidebar={sidebar}>
          <SidebarHeader title="Settings" />
          <nav aria-label="Settings sections">
            {groups.map((group) => (
              <SidebarSection key={group.label} label={group.label}>
                <ul className="mt-2.5 space-y-0.5">
                  {group.pages.map((meta) => {
                    const active = meta.id === page.id;
                    return (
                      <li key={meta.id}>
                        <button
                          type="button"
                          onClick={() => open(meta.id)}
                          aria-current={active ? "page" : undefined}
                          className={`${sidebarRow} ${
                            meta.danger
                              ? active
                                ? "bg-surface text-danger"
                                : "text-danger/80 hover:bg-surface/40 hover:text-danger"
                              : sidebarRowState(active)
                          } ${focusRing}`}
                        >
                          <SettingsMark name={meta.id} className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 flex-1 truncate font-medium">{meta.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </SidebarSection>
            ))}
          </nav>
        </SidebarDrawer>

        <section className="flex min-w-0 flex-col overflow-hidden lg:min-h-0">
          <PaneHeader title={page.label} titleClassName={page.danger ? "text-danger" : ""} sidebar={sidebar} />

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div key={page.id} className="max-w-2xl animate-fade-in px-4 py-6 sm:px-5 lg:px-8 lg:py-8">
              <p className="mb-8 max-w-xl text-sm leading-relaxed text-mute">{page.blurb}</p>
              {serverOnly ? (
                <Callout tone="warning">
                  This needs a connection to the server. It will be available again once you are back online.
                </Callout>
              ) : (
                <div>{content}</div>
              )}
            </div>
          </div>
        </section>
      </div>

      {showPhraseConfirm ? (
        <Modal title="Generate a new recovery phrase?" size="sm" onClose={() => !phraseBusy && setShowPhraseConfirm(false)}>
          <ModalBody className="space-y-4">
            <p className="text-sm leading-relaxed text-text">
              This mints a new vault key, re-encrypts everything under it, and wraps it for your new
              recovery words. Replacing the words alone would not be enough: anyone who has ever seen
              your old words could still decrypt, because the key they unlock would not have changed.
            </p>
            <Callout tone="warning">
              Your previously saved words stop working immediately. Write the new ones down.
            </Callout>
            <PasswordField
              value={phrasePassword}
              onChange={(event) => setPhrasePassword(event.target.value)}
              placeholder="Current password"
              className={field}
              autoComplete="current-password"
            />
            {phraseBusy && phraseProgress.total > 0 ? (
              <p className="text-xs text-mute">
                Re-encrypting {phraseProgress.done} of {phraseProgress.total}…
              </p>
            ) : null}
          </ModalBody>
          <ModalFooter>
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
                onClick={() => void handleGeneratePhrase()}
                disabled={phraseBusy || !phrasePassword}
              >
                {phraseBusy ? "Rotating…" : "Generate new phrase"}
              </button>
          </ModalFooter>
        </Modal>
      ) : null}

      {showDeleteModal ? (
        <Modal title="Delete account" size="sm" onClose={() => !deleteBusy && setShowDeleteModal(false)}>
          <ModalBody className="space-y-4">
            <p className="text-sm leading-relaxed text-text">
              This is <strong className="text-danger">irreversible</strong>. Your encrypted contacts,
              calendar, notes, bookmarks, tasks, key wraps, sessions and device enrolments are purged
              from the server immediately.
            </p>
            <Callout tone="danger">
              To confirm, type your username{" "}
              <span className="font-mono font-semibold">{session.state.username}</span> below.
            </Callout>
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
            {deleteError ? <ErrorMessage size="xs">{deleteError}</ErrorMessage> : null}
          </ModalBody>
          <ModalFooter>
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
                disabled={deleteBusy || deleteConfirmText.trim() !== session.state.username || !deletePassword}
                className={btnDanger}
                onClick={() => void handleDeleteAccount()}
              >
                {deleteBusy ? "Deleting…" : "Delete account permanently"}
              </button>
          </ModalFooter>
        </Modal>
      ) : null}

      {signOutConfirm ? (
        <ConfirmDialog
          title="Sign out"
          tone="default"
          heading="Sign out of this device?"
          body={
            <span className="block space-y-3">
              <span className="block">
                This device's keys are removed from this browser. Nothing is
                deleted from your account.
              </span>
              {pendingChanges > 0 ? (
                <span className="block font-medium text-danger">
                  {pendingChanges} change{pendingChanges === 1 ? "" : "s"} made on this device
                  {pendingChanges === 1 ? " has" : " have"} not synced yet and will be lost.
                  Cancel and wait for them to sync, or export them from the sync banner first.
                </span>
              ) : null}
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
      {phraseDialog}
      {revokeTargets.length > 0 ? (
        <ConfirmDialog
          title="Revoke devices"
          heading={revokeTargets.length === 1 ? "Revoke this device?" : `Revoke these ${revokeTargets.length} devices?`}
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
              {revokeTargets.map((target) => (
                <span key={target.device_id} className="block">
                  <span className="block font-medium text-text">{target.name}</span>
                  <span className="block text-xs text-mute">{target.detail}</span>
                  <span className="block truncate font-mono text-2xs text-mute">
                    {target.device_id}
                  </span>
                </span>
              ))}
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
          confirmLabel={revokeTargets.length === 1 ? "Revoke device" : "Revoke devices"}
          busyLabel={revokeProgress.total > 0
            ? `Re-encrypting ${revokeProgress.done} of ${revokeProgress.total}...`
            : "Revoking..."}
          busy={revokeBusy}
          error={revokeError}
          onConfirm={() => void handleRevokeDevice()}
          onClose={() => { if (!revokeBusy) { setRevokeTargets([]); setRevokePassword(""); setRevokeError(null); } }}
        />
      ) : null}
    </main>
  );
}
