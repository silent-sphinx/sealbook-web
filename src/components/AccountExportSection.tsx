import { useState } from "react";

import { generateAccountExportData } from "../lib/accountExport";
import { exportVault, type Session } from "../lib/client";
import { friendlyError } from "../lib/errors";
import { triggerDownload } from "../lib/importExport";
import { btnSecondary } from "../lib/styles";
import { Callout, NoticeLine, SettingsGroup, actionRow, type Notice } from "./SettingsKit";

type Props = {
  session: Session;
};

export function AccountExportSection({ session }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice>(null);

  async function runExport() {
    setBusy(true);
    setMessage(null);
    try {
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
      <NoticeLine notice={message} />
      <div className={actionRow}>
        <button type="button" disabled={busy} onClick={() => void runExport()} className={btnSecondary}>
          {busy ? "Exporting…" : "Export…"}
        </button>
      </div>
    </SettingsGroup>
  );
}
