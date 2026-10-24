import { useState } from "react";

import { generateAccountExportData } from "../lib/accountExport";
import { exportVault, type Session } from "../lib/client";
import { friendlyError } from "../lib/errors";
import { triggerDownload } from "../lib/importExport";
import { btnSecondary } from "../lib/styles";

type Props = {
  session: Session;
};

type Message = { type: "success" | "error" | "warning"; text: string } | null;

export function AccountExportSection({ session }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);

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
    <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-4 shadow-sm sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-text">Export account data</h3>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-mute">
            One JSON file holding everything in your vault: contacts and address
            books, calendars and events, notes and notebooks, and your account
            preferences. The same file the Sealbook CLI writes.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void runExport()}
          className={`${btnSecondary} shrink-0 px-5`}
        >
          {busy ? "Exporting…" : "Export…"}
        </button>
      </div>

      <div className="mt-5 rounded-lg border border-danger/30 bg-danger/10 p-3.5 text-xs leading-relaxed text-danger">
        The file is decrypted. Anyone who opens it can read your whole vault, so
        keep it somewhere encrypted and delete it when you are done with it.
      </div>

      {message ? (
        <p
          role="alert"
          className={`mt-4 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            message.type === "success"
              ? "border-line bg-bg text-mute"
              : message.type === "warning"
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-danger/30 bg-danger/10 text-danger"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
