import { useState, type FormEvent } from "react";
import type { Session } from "../lib/client";
import {
  changePassword,
  changeUsername,
  deleteAccount,
  rotatePhrase,
} from "../lib/client";
import { formatRecoveryWordsFile } from "../lib/phrase";
import { clearDevice, saveDevice } from "../lib/storage";
import {
  btnDanger,
  btnPrimary,
  btnSecondary,
  field,
} from "../lib/styles";
import type { AddressBook, Contact } from "../lib/types";
import { Modal } from "./Modal";
import { ImportExportSection } from "./ImportExportSection";

type Props = {
  session: Session;
  contacts: Contact[];
  addressBooks: AddressBook[];
  onSessionUpdate: (updated: Session) => void;
  onAccountDeleted: () => void;
  onRefresh: () => Promise<void>;
  onCreateBook?: (name: string) => Promise<string | undefined>;
};

export function SettingsView({
  session,
  contacts,
  addressBooks,
  onSessionUpdate,
  onAccountDeleted,
  onRefresh,
  onCreateBook,
}: Props) {
  // Username state
  const [newUsername, setNewUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Password state
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
  const [copiedPhrase, setCopiedPhrase] = useState(false);
  const [phraseMsg, setPhraseMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showPhraseConfirm, setShowPhraseConfirm] = useState(false);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
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
      saveDevice(updated.state);
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
      const updated = await changePassword(session, newPassword);
      saveDevice(updated.state);
      onSessionUpdate(updated);
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
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount(session);
      clearDevice();
      setShowDeleteModal(false);
      onAccountDeleted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDeleteError(`Failed to delete account: ${msg}`);
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-8 animate-fade-in-up">
      {/* Header Info */}
      <div className="border-b border-line pb-4">
        <h2 className="text-xl font-semibold tracking-tight text-text">
          Account Settings
        </h2>
        <p className="mt-1 text-sm text-mute">
          Manage your identity, cryptographic credentials, backup recovery
          phrase, and data.
        </p>
      </div>

      {/* Section 1: Username */}
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

      {/* Section 2: Password */}
      <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm">
        <div>
          <h3 className="text-base font-semibold text-text">Change Password</h3>
        </div>
        <form onSubmit={handleChangePassword} className="mt-6 space-y-4">
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
              disabled={passwordBusy || !newPassword || !confirmPassword}
              className={btnPrimary}
            >
              {passwordBusy ? "Updating…" : "Change Password"}
            </button>
          </div>
        </form>
      </section>

      {/* Section 3: Backup Recovery Codes */}
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

      {/* Section 4: Import & Export Contacts */}
      <ImportExportSection
        session={session}
        contacts={contacts}
        addressBooks={addressBooks}
        onRefresh={onRefresh}
        onCreateBook={onCreateBook}
      />

      {/* Section 5: Danger Zone - Delete Account */}
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
                    deleteConfirmText.trim() !== session.state.username
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
    </div>
  );
}
