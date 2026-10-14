import { useRef, useState } from "react";

import { parseAccountExport, type AccountImport } from "../lib/accountExport";
import { importVault, type Session } from "../lib/client";
import { friendlyError } from "../lib/errors";
import { btnSecondary, focusRing } from "../lib/styles";

type Props = {
  session: Session;
  onRefresh: () => Promise<void>;
};

type Message = { type: "success" | "error" | "warning"; text: string } | null;

type Picked = {
  name: string;
  parsed: AccountImport;
};

export function AccountImportSection({ session, onRefresh }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  function reset() {
    setPicked(null);
    setOverwrite(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
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

  function handleDrag(event: React.DragEvent) {
    event.preventDefault();
    setDragActive(event.type === "dragenter" || event.type === "dragover");
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) void choose(file);
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

  return (
    <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm">
      <div>
        <h3 className="text-base font-semibold text-text">Import account data</h3>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-mute">
          Restore from a Sealbook account export, or move an account onto this
          one. Items keep the identities they had in the file, so restoring a
          backup rebuilds the vault rather than duplicating it.
        </p>
      </div>

      {!picked ? (
        // The file input below is `display: none`, so it is not in the
        // accessibility tree and cannot be tabbed to. This zone is the only way
        // to pick a file, so it carries the button semantics and the keyboard
        // activation itself.
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose an account export file to import, or drop one here"
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            fileInputRef.current?.click();
          }}
          className={`mt-5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-7 text-center transition-all cursor-pointer ${focusRing} ${
            dragActive
              ? "border-accent bg-accent/10 scale-[0.99]"
              : "border-line/80 hover:border-line-light hover:bg-surface/30"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void choose(file);
            }}
            className="hidden"
          />
          <p className="text-xs font-medium text-text">
            Click to select file or drag &amp; drop here
          </p>
          <p className="mt-1 text-[11px] text-mute">
            The JSON file written by Export account data, here or in the Sealbook CLI
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-4 rounded-xl border border-accent/30 bg-surface/40 p-4">
          <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-text">{picked.name}</p>
              <p className="mt-0.5 text-[11px] font-medium text-accent">
                {picked.parsed.objects.length} item
                {picked.parsed.objects.length === 1 ? "" : "s"} from {picked.parsed.source}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={reset}
              className="cursor-pointer text-xs text-mute hover:text-text"
            >
              Change file
            </button>
          </div>

          {picked.parsed.unreadable > 0 ? (
            <p className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-[11px] leading-relaxed text-danger">
              This file is incomplete: {picked.parsed.unreadable} item
              {picked.parsed.unreadable === 1 ? "" : "s"} could not be opened by
              the device that exported it, so {picked.parsed.unreadable === 1 ? "it is" : "they are"}{" "}
              not in the file and importing it will not bring {picked.parsed.unreadable === 1 ? "it" : "them"} back.
            </p>
          ) : null}

          {foreign ? (
            <p className="rounded-lg border border-accent/30 bg-accent/10 p-3 text-[11px] leading-relaxed text-accent">
              This file was exported from a different account. Importing it adds
              its contents to {session.state.username}.
            </p>
          ) : null}

          <label className="flex items-start gap-2.5 text-xs leading-relaxed text-text">
            <input
              type="checkbox"
              checked={overwrite}
              disabled={busy}
              onChange={(event) => setOverwrite(event.target.checked)}
              className="mt-0.5"
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

          <button
            type="button"
            disabled={busy}
            onClick={() => void runImport()}
            className={`${btnSecondary} px-5`}
          >
            {busy ? "Importing…" : `Import ${picked.parsed.objects.length} item${picked.parsed.objects.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

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
