import { useState } from "react";

import { parseAccountExport, type AccountImport } from "../lib/accountExport";
import { importVault, type Session } from "../lib/client";
import { friendlyError } from "../lib/errors";
import { btnSecondary } from "../lib/styles";
import { Callout, FileDrop, ImportReview, NoticeLine, SettingsGroup, actionRow, type Notice } from "./SettingsKit";

type Props = {
  session: Session;
  onRefresh: () => Promise<void>;
};

type Picked = {
  name: string;
  parsed: AccountImport;
};

export function AccountImportSection({ session, onRefresh }: Props) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Notice>(null);

  function reset() {
    setPicked(null);
    setOverwrite(false);
  }

  // Parsed on pick rather than on import, so a file that cannot be restored says
  // so before anything is written.
  async function choose(file: File) {
    setMessage(null);
    try {
      setPicked({ name: file.name, parsed: parseAccountExport(await file.text()) });
    } catch (err) {
      reset();
      setMessage({ type: "error", text: `That file cannot be imported: ${friendlyError(err)}` });
    }
  }

  async function runImport() {
    if (!picked) return;
    setBusy(true);
    setMessage(null);
    try {
      const { imported, skipped } = await importVault(session, picked.parsed.objects, {
        overwrite,
      });
      await onRefresh();
      reset();
      setMessage({
        type: skipped > 0 ? "warning" : "success",
        text:
          `Imported ${imported} item${imported === 1 ? "" : "s"}.` +
          (skipped > 0
            ? ` ${skipped} already in this vault ${skipped === 1 ? "was" : "were"} left alone; ` +
              `tick "Replace" to restore them too.`
            : ""),
      });
    } catch (err) {
      setMessage({ type: "error", text: `Import failed: ${friendlyError(err)}` });
    } finally {
      setBusy(false);
    }
  }

  const foreign =
    picked !== null &&
    !picked.parsed.source.startsWith(`${session.state.username} at `);

  const itemCount = (count: number) => `${count} item${count === 1 ? "" : "s"}`;

  return (
    <SettingsGroup
      title="Import account data"
      meta=".json"
      description="Restore from a Sealbook account export, or move another account onto this one. Items keep the identities they had in the file, so restoring a backup rebuilds the vault rather than duplicating it."
    >
      {!picked ? (
        <FileDrop
          label="Choose an account export file to import, or drop one here"
          accept=".json,application/json"
          formats=".json"
          hint="The JSON file written by Export account data, here or in the Sealbook CLI"
          onFile={(file) => void choose(file)}
        />
      ) : (
        <ImportReview
          fileName={picked.name}
          summary={`${itemCount(picked.parsed.objects.length)} from ${picked.parsed.source}`}
          busy={busy}
          onChangeFile={reset}
        >
          {picked.parsed.unreadable > 0 ? (
            <Callout tone="danger">
              This file is incomplete: {itemCount(picked.parsed.unreadable)} could not be opened by
              the device that exported it, so {picked.parsed.unreadable === 1 ? "it is" : "they are"}{" "}
              not in the file and importing it will not bring {picked.parsed.unreadable === 1 ? "it" : "them"} back.
            </Callout>
          ) : null}

          {foreign ? (
            <Callout tone="warning">
              This file was exported from a different account. Importing it adds
              its contents to {session.state.username}.
            </Callout>
          ) : null}

          <label className="flex items-start gap-2.5 text-xs leading-relaxed text-text">
            <input
              type="checkbox"
              checked={overwrite}
              disabled={busy}
              onChange={(event) => setOverwrite(event.target.checked)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span>
              Replace items this vault already holds
              <span className="mt-0.5 block text-[11px] text-mute">
                Off by default: an item already here is the current one, and the
                file's copy may be older. Tick this to restore the file's version
                over it.
              </span>
            </span>
          </label>

          <div className={actionRow}>
            <button type="button" disabled={busy} onClick={() => void runImport()} className={btnSecondary}>
              {busy ? "Importing…" : `Import ${itemCount(picked.parsed.objects.length)}`}
            </button>
          </div>
        </ImportReview>
      )}
      <NoticeLine notice={message} />
    </SettingsGroup>
  );
}
