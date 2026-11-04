import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import type { DeviceSummary, Session } from "../lib/client";
import { changePassword, changeUsername, deleteAccount, listDevices, revokeDevice, rotatePhrase } from "../lib/client";
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
  btnPrimary,
  btnSecondary,
  field,
  fieldLabel,
  focusRing,
  selectField,
  sidebarRowState,
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
import { PAGE_GROUPS, pageForSection, type SettingsPage, type SettingsSection } from "../lib/settingsModel";
import { CheckIcon, CopyIcon } from "./AppIcons";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { PasswordField } from "./PasswordField";
import { SidebarDrawer, SidebarHeader, SidebarSection, type Sidebar } from "./SidebarDrawer";
import { AccountExportSection } from "./AccountExportSection";
import { AccountImportSection } from "./AccountImportSection";
import { BookmarksImportExportSection } from "./BookmarksImportExportSection";
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
  type Notice,
} from "./SettingsKit";

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
  accountSettings: AccountSettings;
  /** Rejects when the write fails, so the toggle can report it and stay put. */
  onSaveAccountSettings: (settings: AccountSettings) => Promise<void>;
  /** Read once on mount; the view unmounts whenever the Settings tab is left. */
  initialSection?: SettingsSection;
  sidebar: Sidebar;
};

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
  accountSettings,
  onSaveAccountSettings,
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
  const [revokeTarget, setRevokeTarget] = useState<DeviceSummary | null>(null);
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
      // Rotating the key invalidates the old phrase; the card below the devices
      // message is the same one the recovery page renders.
      setNewWords(phrase.split(/\s+/u).filter(Boolean));
      setCopiedPhrase(false);
      setRevokeTarget(null);
      setRevokePassword("");
      setDevicesMsg({
        type: "success",
        text: "Device revoked and the vault key rotated. Save the new recovery phrase below; your previous one no longer works.",
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
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
          New recovery phrase
        </span>
        <span className="text-[11px] text-mute">Save it now. The previous phrase no longer works.</span>
      </div>
      <ol className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-4 text-xs sm:grid-cols-3">
        {newWords.map((word, index) => (
          <li key={`${index}-${word}`} className="flex items-center gap-2 font-mono">
            <span className="w-5 select-none text-right text-[10px] tabular-nums text-mute/70">{index + 1}</span>
            <span className="font-medium text-text">{word}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
        <button type="button" className={btnSecondary} onClick={copyWords}>
          {copiedPhrase ? <CheckIcon /> : <CopyIcon />}
          {copiedPhrase ? "Copied" : "Copy all"}
        </button>
        <button type="button" className={btnSecondary} onClick={downloadWords}>
          Download .txt
        </button>
        <button type="button" className={btnSecondary} onClick={printWords}>
          Print
        </button>
      </div>
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
          description="Use at least 8 characters. Other signed-in devices keep their own keys and are not signed out."
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
                placeholder="At least 8 characters"
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
          meta={devices ? `${devices.length} device${devices.length === 1 ? "" : "s"}` : undefined}
          description="Revoking a device rotates the vault key and re-encrypts your data, so the removed device keeps nothing it can still read."
        >
          {devices === null ? (
            <p className="text-xs text-mute">Loading devices…</p>
          ) : devices.length === 0 ? (
            <p className="text-xs text-mute">No devices found.</p>
          ) : (
            <SettingsList>
              {devices.map((device) => {
                const isCurrent = device.device_id === session.state.device_id;
                return (
                  <SettingsRow
                    key={device.device_id}
                    lead={
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-mute">
                        <SettingsMark name="devices" />
                      </span>
                    }
                    label={<span className="font-mono text-xs">{device.device_id}</span>}
                    description={isCurrent ? <span className="text-accent">This device</span> : "Signed in"}
                    control={
                      isCurrent ? null : (
                        <button
                          type="button"
                          onClick={() => {
                            setRevokeTarget(device);
                            setRevokePassword("");
                            setRevokeError(null);
                            setDevicesMsg(null);
                          }}
                          className={`${btnSecondary} px-3 py-1.5 text-xs`}
                        >
                          Revoke
                        </button>
                      )
                    }
                  />
                );
              })}
            </SettingsList>
          )}
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
          description="The accent tints buttons, links, selected rows and focus rings. Calendar colours are set per calendar and are left alone, as is the gold a note being edited is marked with."
        >
          <SettingsList role="radiogroup" label="Accent colour">
            {ACCENTS.map((accent) => {
              const active = normalizeAccent(accountSettings.accent) === accent;
              const { base, dim } = ACCENT_COLORS[accent];
              return (
                <SettingsOption
                  key={accent}
                  checked={active}
                  disabled={accentBusy !== null}
                  onSelect={() => void handleAccent(accent)}
                  // The one place the colour cannot come from the accent tokens:
                  // a swatch shows the accent it offers, not the one in use.
                  lead={
                    <span
                      aria-hidden="true"
                      style={{ backgroundColor: base, borderColor: dim }}
                      className="h-5 w-5 shrink-0 rounded-full border"
                    />
                  }
                  label={ACCENT_LABELS[accent]}
                  description={accentBusy === accent ? "Saving…" : active ? "Currently in use" : base}
                />
              );
            })}
          </SettingsList>
          <NoticeLine notice={accentMsg} />
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
            </SettingsList>
          </SettingsGroup>
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
    <main className="flex h-[calc(100dvh-var(--sb-header-h,74px))] flex-col overflow-hidden bg-bg pb-[env(safe-area-inset-bottom)] text-text lg:pb-0">
      <div className="sb-shell grid min-h-0 flex-1" style={sidebar.cols}>
        <SidebarDrawer title="Settings" sidebar={sidebar}>
          <SidebarHeader eyebrow={session.state.username} title="Settings" />
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
                          className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${
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
          <header className="flex items-center gap-2 border-b border-line px-4 py-3 sm:px-5 sm:py-3.5 lg:px-6">
            {sidebar.isDesktop ? null : (
              <button
                type="button"
                onClick={sidebar.toggle}
                aria-label="Show settings sections"
                title="Settings sections"
                className={`-ml-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
              >
                <SettingsMark name="menu" />
              </button>
            )}
            <div className="flex h-8 min-w-0 items-center">
              <h1
                className={`truncate text-base font-semibold tracking-tight ${page.danger ? "text-danger" : ""}`}
              >
                {page.label}
              </h1>
            </div>
          </header>

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
        <Modal title="Generate a new recovery phrase?" onClose={() => !phraseBusy && setShowPhraseConfirm(false)}>
          <div className="space-y-4 p-6">
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
            <div className={`${actionRow} pt-2`}>
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
            </div>
          </div>
        </Modal>
      ) : null}

      {showDeleteModal ? (
        <Modal title="Delete account" onClose={() => !deleteBusy && setShowDeleteModal(false)}>
          <div className="space-y-4 p-6">
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
            {deleteError ? <p className="text-xs text-danger">{deleteError}</p> : null}
            <div className={`${actionRow} pt-2`}>
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
            </div>
          </div>
        </Modal>
      ) : null}

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
    </main>
  );
}
