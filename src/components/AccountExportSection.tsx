import { useId, useState, type FormEvent } from "react";

import { generateAccountExportData } from "../lib/accountExport";
import { exportVault, type Session } from "../lib/client";
import { friendlyError } from "../lib/errors";
import { triggerDownload } from "../lib/importExport";
import { loadDevice } from "../lib/storage";
import { btnSecondary, field, fieldLabel } from "../lib/styles";
import { PasswordField } from "./PasswordField";
import { Callout, NoticeLine, SettingsGroup, actionRow, type Notice } from "./SettingsKit";

type Props = {
  session: Session;
};

export function AccountExportSection({ session }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice>(null);
  const [password, setPassword] = useState("");
  const passwordId = useId();

  async function runExport(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setMessage({ type: "error", text: "Enter your password to confirm." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      // The same step revoking a device or changing the password asks for: a
      // whole-vault file in the clear should not take one click on a session
      // someone else is sitting at. Checked against this device's own record,
      // so it needs no round trip.
      if ((await loadDevice(password)) === null) {
        setMessage({ type: "error", text: "Wrong password." });
        return;
      }
      setPassword("");
      // Read from the server rather than from what the views hold: those drop
      // the content types this build does not parse, and a backup has to carry
      // them.
      const vault = await exportVault(session);
      const { filename, mime, data } = generateAccountExportData(session.state, vault);
      triggerDownload(filename, mime, data);
      setMessage(
        vault.unreadable > 0
          ? {
              type: "warning",
              text: `Exported ${vault.objects.length} items as "${filename}". ${vault.unreadable} could not be opened on this device and are not in the file.`,
            }
          : {
              type: "success",
              text: `Exported ${vault.objects.length} item${vault.objects.length === 1 ? "" : "s"} as "${filename}".`,
            },
      );
    } catch (err) {
      setMessage({ type: "error", text: `Export failed: ${friendlyError(err)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsGroup
      title="Export account data"
      description="One JSON file holding everything in your vault: contacts and address books, calendars and events, notes and notebooks, bookmarks, tasks and your account preferences. The same file the Sealbook CLI writes."
    >
      <Callout tone="danger">
        The file is decrypted. Anyone who opens it can read your whole vault, so
        keep it somewhere encrypted and delete it when you are done with it.
      </Callout>
      <form onSubmit={(event) => void runExport(event)}>
        <label htmlFor={passwordId} className={fieldLabel}>
          Password
        </label>
        <PasswordField
          id={passwordId}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
          autoComplete="current-password"
          placeholder="Confirm with your password"
        />
        <NoticeLine notice={message} />
        <div className={actionRow}>
          <button type="submit" disabled={busy || !password} className={btnSecondary}>
            {busy ? "Exporting…" : "Export…"}
          </button>
        </div>
      </form>
    </SettingsGroup>
  );
}
