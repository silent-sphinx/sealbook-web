import { useRef, useState, type FormEvent } from "react";
import type { Session } from "../lib/client";
import {
  changePassword,
  changeUsername,
  deleteAccount,
  putCalendar,
  putCalendarEvent,
  rotatePhrase,
} from "../lib/client";
import { parseIcs } from "../lib/ics";
import { formatRecoveryWordsFile } from "../lib/phrase";
import { clearDevice } from "../lib/storage";
import {
  btnDanger,
  btnPrimary,
  btnSecondary,
  field,
} from "../lib/styles";
import type { AddressBook, Calendar, Contact } from "../lib/types";
import { allTimezones, utcOffsetLabel } from "../lib/timezone";
import { Modal } from "./Modal";
import { ImportExportSection } from "./ImportExportSection";

type Props = {
  session: Session;
  contacts: Contact[];
  addressBooks: AddressBook[];
  calendars: Calendar[];
  onSessionUpdate: (updated: Session) => void;
  onPersistSession: (updated: Session, password: string) => Promise<void>;
  onAccountDeleted: () => void;
  onRefresh: () => Promise<void>;
  onCreateBook?: (name: string) => Promise<string | undefined>;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
};

type SettingsSection = "account" | "contacts" | "calendar";

export function SettingsView({
  session,
  contacts,
  addressBooks,
  calendars,
  onSessionUpdate,
  onPersistSession,
  onAccountDeleted,
  onRefresh,
  onCreateBook,
  timezone,
  onTimezoneChange,
}: Props) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("account");
  const icsInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingIcsFile, setPendingIcsFile] = useState<File | null>(null);
  const [icsCalendarId, setIcsCalendarId] = useState("");
  const [importingIcs, setImportingIcs] = useState(false);
  const [icsProgress, setIcsProgress] = useState({ current: 0, total: 0 });
  const [icsMessage, setIcsMessage] = useState<string | null>(null);

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
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Recovery phrase state
  const [phraseBusy, setPhraseBusy] = useState(false);
  const [newWords, setNewWords] = useState<string[] | null>(null);
  const [copiedPhrase, setCopiedPhrase] = useState(false);
  const [phraseMsg, setPhraseMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showPhraseConfirm, setShowPhraseConfirm] = useState(false);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Handlers
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
      const msg = err instanceof Error ? err.message : String(err);
      setUsernameMsg({
        type: "error",
        text: msg.includes("taken")
          ? "That username is already taken."
          : msg.includes("invalid credentials")
            ? "Incorrect password."
            : `Failed to update username: ${msg}`,
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
      const msg = err instanceof Error ? err.message : String(err);
      setPasswordMsg({
        type: "error",
        text: `Failed to change password: ${msg}`,
      });
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleGeneratePhrase() {
    setPhraseBusy(true);
    setPhraseMsg(null);
    setShowPhraseConfirm(false);
    try {
      const phraseStr = await rotatePhrase(session);
      const words = phraseStr.split(/\s+/u).filter(Boolean);
      setNewWords(words);
      setCopiedPhrase(false);
      setPhraseMsg({
        type: "success",
        text: "New recovery phrase generated. Previous recovery words have been invalidated on the server.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPhraseMsg({
        type: "error",
        text: `Failed to rotate recovery phrase: ${msg}`,
      });
    } finally {
      setPhraseBusy(false);
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
    const lines = newWords.map(
      (w, i) =>
        `<tr><td style="text-align:right;padding-right:12px;color:#888;font-variant-numeric:tabular-nums">${i + 1}</td><td style="font-family:monospace">${w}</td></tr>`,
    );
    const html = `
      <html>
        <head><title>Sealbook Recovery Words</title></head>
        <body style="font-family:system-ui,sans-serif;padding:40px;max-width:480px;margin:0 auto">
          <h2 style="margin:0 0 4px">Sealbook Recovery Words</h2>
          <p style="color:#666;margin:0 0 24px;font-size:14px">Keep this document safe and secret. Replaces all previous phrases.</p>
          <table style="border-collapse:collapse;font-size:15px">${lines.join("")}</table>
        </body>
      </html>`;
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    }
  }

  function copyWords() {
    if (!newWords) return;
    navigator.clipboard.writeText(newWords.join(" ")).then(() => {
      setCopiedPhrase(true);
      setTimeout(() => setCopiedPhrase(false), 2500);
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
      const msg = err instanceof Error ? err.message : String(err);
      setDeleteError(`Failed to delete account: ${msg}`);
      setDeleteBusy(false);
    }
  }

  async function importIcs(file: File) {
    setImportingIcs(true);
    setIcsProgress({ current: 0, total: 0 });
    setIcsMessage(null);
    try {
      const imported = parseIcs(await file.text(), timezone, icsCalendarId);
      if (imported.length === 0) throw new Error("No VEVENT entries were found in that file.");
      setIcsProgress({ current: 0, total: imported.length });
      for (let index = 0; index < imported.length; index += 1) {
        await putCalendarEvent(session, imported[index]);
        setIcsProgress({ current: index + 1, total: imported.length });
      }
      await onRefresh();
      setIcsMessage(`Imported ${imported.length} event${imported.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setIcsMessage(`ICS import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportingIcs(false);
      setIcsProgress({ current: 0, total: 0 });
    }
  }

  function chooseIcsFile(file: File) {
    setIcsCalendarId(calendars[0]?.id ?? "");
    setPendingIcsFile(file);
  }

  function closeIcsChooser() {
    setPendingIcsFile(null);
    setIcsCalendarId("");
  }

  async function createIcsCalendar(name: string): Promise<string> {
    const id = await putCalendar(session, { name, color: "#7aa2f7" });
    await onRefresh();
    setIcsCalendarId(id);
    return id;
  }

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
          {([
            ["account", "Account settings", "Identity, security, and recovery"],
            ["contacts", "Contacts settings", "Import and export contacts"],
            ["calendar", "Calendar settings", "Timezone and event display"],
          ] as const).map(([id, label, description]) => (
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
            {activeSection === "account"
              ? "Account settings"
              : activeSection === "contacts"
                ? "Contacts settings"
                : "Calendar settings"}
          </h2>
          <p className="mt-1 text-sm text-mute">
            {activeSection === "account"
              ? "Manage your identity, cryptographic credentials, recovery phrase, and account data."
              : activeSection === "contacts"
                ? "Move contact data in and out of Sealbook while keeping your address books organized."
                : "Choose how dates and times are displayed throughout your calendar."}
          </p>
        </div>

      {activeSection === "calendar" && (
        <section className="rounded-2xl border border-line bg-panel/75 p-6 shadow-sm">
          <h3 className="text-base font-semibold text-text">Calendar timezone</h3>
          <select value={timezone} onChange={(event) => onTimezoneChange(event.target.value)} className={`${field} mt-5`}>
            {[...new Set([timezone, ...allTimezones])].map((zone) => <option key={zone} value={zone}>{zone} [{utcOffsetLabel(zone)}]</option>)}
          </select>
          <div className="mt-8 border-t border-line pt-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-text">Import calendar</h3>
                <p className="mt-1 text-xs leading-relaxed text-mute">Import events from an ICS file into one of your calendars.</p>
              </div>
              <input ref={icsInputRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) chooseIcsFile(file); }} />
              <button type="button" onClick={() => icsInputRef.current?.click()} disabled={importingIcs || calendars.length === 0} className={btnSecondary}>
                {importingIcs ? "Importing..." : "Choose ICS file"}
              </button>
            </div>
            {calendars.length === 0 ? <p className="mt-3 text-xs text-mute">Create a calendar before importing events.</p> : null}
            {icsMessage ? <p className="mt-4 rounded-lg border border-line bg-bg px-3 py-2 text-xs text-mute">{icsMessage}</p> : null}
          </div>
        </section>
      )}

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
            <label className="block text-xs font-medium text-text">
              New Username
            </label>
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="Enter new username"
              className={field}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text">
              Current Password (to confirm)
            </label>
            <input
              type="password"
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
            <label className="block text-xs font-medium text-text">
              Current Password
            </label>
            <input
              type="password"
              value={passwordCurrent}
              onChange={(e) => setPasswordCurrent(e.target.value)}
              placeholder="Current password"
              className={field}
              autoComplete="current-password"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={field}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text">
              Confirm New Password
            </label>
            <input
              type="password"
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
                Generating a new recovery phrase will re-wrap your collection key
                and upload a new phrase verifier.
              </p>
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-3.5 text-xs text-warning leading-relaxed">
                ⚠️ <strong>Warning:</strong> Any previously saved backup words
                will be permanently overwritten on the server and will no longer
                work to recover your contacts.
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => setShowPhraseConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={handleGeneratePhrase}
                >
                  Yes, Generate New Codes
                </button>
              </div>
            </div>
          </Modal>
        )}
      </section>

      </>}

      {activeSection === "contacts" && (
        <ImportExportSection
          session={session}
          contacts={contacts}
          addressBooks={addressBooks}
          onRefresh={onRefresh}
          onCreateBook={onCreateBook}
        />
      )}

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
                All your encrypted contacts, key wraps, sessions, and device
                enrollments will be purged from the server database immediately.
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

              <input
                type="password"
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
      {importingIcs ? <ImportProgressModal current={icsProgress.current} total={icsProgress.total} /> : null}
      {pendingIcsFile ? <IcsCalendarChooser file={pendingIcsFile} calendarId={icsCalendarId} calendars={calendars} onCalendarChange={setIcsCalendarId} onCreateCalendar={createIcsCalendar} onCancel={closeIcsChooser} onImport={() => { const file = pendingIcsFile; closeIcsChooser(); void importIcs(file); }} /> : null}
      </div>
    </div>
  );
}

function ImportProgressModal({ current, total }: { current: number; total: number }) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <Modal title="Importing calendar" onClose={() => undefined}>
      <div className="p-6">
        <p className="text-xs text-mute">Encrypting and saving events. Keep this window open.</p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-right text-[11px] tabular-nums text-mute">
          {total ? `${current} of ${total}` : "Preparing..."}
        </p>
      </div>
    </Modal>
  );
}

function IcsCalendarChooser({ file, calendarId, calendars, onCalendarChange, onCreateCalendar, onCancel, onImport }: { file: File; calendarId: string; calendars: Calendar[]; onCalendarChange: (value: string) => void; onCreateCalendar: (name: string) => Promise<string>; onCancel: () => void; onImport: () => void }) {
  const [creatingCalendar, setCreatingCalendar] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  async function createCalendar() {
    const name = newCalendarName.trim();
    if (!name) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await onCreateCalendar(name);
      setNewCalendarName("");
      setCreatingCalendar(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <Modal title="Choose destination" onClose={onCancel}>
      <div className="space-y-4 p-6">
        <p className="truncate rounded-lg border border-line bg-bg px-3 py-2 text-xs text-mute" title={file.name}>
          {file.name}
        </p>
        <label className="block text-xs font-medium text-mute">
          Add events to
          <select autoFocus value={calendarId} onChange={(event) => onCalendarChange(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-text outline-none focus:border-accent">
            {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
          </select>
        </label>
        {creatingCalendar ? (
          <div className="rounded-lg border border-line bg-surface/50 p-3">
            <label className="block text-xs font-medium text-mute">
              New calendar name
              <input
                autoFocus
                value={newCalendarName}
                onChange={(event) => setNewCalendarName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createCalendar();
                }}
                placeholder="Personal"
                className={field}
              />
            </label>
            {createError ? <p className="mt-2 text-xs text-danger">{createError}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setCreatingCalendar(false)} className={btnSecondary} disabled={createBusy}>Cancel</button>
              <button type="button" onClick={() => void createCalendar()} className={btnPrimary} disabled={createBusy || !newCalendarName.trim()}>{createBusy ? "Creating..." : "Create calendar"}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setCreatingCalendar(true)} className="text-left text-xs font-medium text-accent transition-colors hover:text-text">
            + Create a new calendar
          </button>
        )}
        <div className="flex justify-end gap-2.5 pt-2">
          <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
          <button type="button" onClick={onImport} disabled={!calendarId} className={btnPrimary}>Import events</button>
        </div>
      </div>
    </Modal>
  );
}
