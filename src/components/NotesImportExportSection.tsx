import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { putNote } from "../lib/client";
import type { Session } from "../lib/client";
import { friendlyError } from "../lib/errors";
import { triggerDownload } from "../lib/importExport";
import {
  ALL_NOTEBOOKS,
  DEFAULT_NOTEBOOK_ID,
  notebookNameById,
  resolveNotebookId,
  sortNotes,
} from "../lib/note";
import {
  generateNoteExportData,
  parseNoteImport,
  type NoteExportFormat,
  type NoteImportResult,
} from "../lib/noteExport";
import { btnPrimary, btnSecondary, field, focusRing, selectField } from "../lib/styles";
import type { Note, NoteDraft, Notebook } from "../lib/types";

const MAX_IMPORT_FILE_BYTES = 128 * 1024 * 1024;

type Props = {
  session: Session;
  notes: Note[];
  notebooks: Notebook[];
  onRefresh: () => Promise<void>;
  onCreateNotebook?: (name: string) => Promise<string | undefined>;
};

type Message = { type: "success" | "error"; text: string } | null;

export function NotesImportExportSection({
  session,
  notes,
  notebooks,
  onRefresh,
  onCreateNotebook,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importFile, setImportFile] = useState<{ name: string; size: number } | null>(null);
  const [parsed, setParsed] = useState<NoteImportResult | null>(null);
  const [targetNotebookId, setTargetNotebookId] = useState<string>(
    notebooks[0]?.id ?? DEFAULT_NOTEBOOK_ID,
  );
  // Prefix for the ids that tie this section's labels to their controls.
  const ids = useId();
  const [isCreatingNotebook, setIsCreatingNotebook] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [importMsg, setImportMsg] = useState<Message>(null);

  const [exportNotebookFilter, setExportNotebookFilter] = useState<string>(ALL_NOTEBOOKS);
  const [exportFormat, setExportFormat] = useState<NoteExportFormat>("md");
  const [exportMsg, setExportMsg] = useState<Message>(null);

  const exportNotes = sortNotes(
    exportNotebookFilter === ALL_NOTEBOOKS
      ? notes
      : notes.filter((note) => resolveNotebookId(note.notebookId) === exportNotebookFilter),
  );

  function handleFileRead(file: File) {
    setImportMsg(null);
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setImportMsg({ type: "error", text: "Import files must be 128 MB or smaller." });
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content !== "string" || !content.trim()) {
        setImportMsg({ type: "error", text: `File "${file.name}" is empty.` });
        return;
      }
      try {
        const result = parseNoteImport(file.name, content, targetNotebookId);
        if (result.notes.length === 0) {
          setImportMsg({
            type: "error",
            text: result.skipped.length
              ? `Every note in "${file.name}" was too large to store.`
              : `No notes could be read from "${file.name}". Expected a Markdown or JSON file.`,
          });
          return;
        }
        setImportFile({ name: file.name, size: file.size });
        setParsed(result);
      } catch (err) {
        setImportMsg({ type: "error", text: `Failed to read file: ${friendlyError(err)}` });
      }
    };
    reader.onerror = () => setImportMsg({ type: "error", text: "Failed to read file from disk." });
    reader.readAsText(file);
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) handleFileRead(file);
    event.target.value = "";
  }

  function handleDrag(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(event.type === "dragenter" || event.type === "dragover");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFileRead(file);
  }

  function resetImport() {
    setImportFile(null);
    setParsed(null);
    setProgress(null);
    setIsCreatingNotebook(false);
    setNewNotebookName("");
  }

  async function runImport() {
    if (!parsed || parsed.notes.length === 0) return;
    setImporting(true);
    setImportMsg(null);
    setProgress({ current: 0, total: parsed.notes.length });
    try {
      let notebookId = targetNotebookId;
      if (isCreatingNotebook && newNotebookName.trim() && onCreateNotebook) {
        const created = await onCreateNotebook(newNotebookName.trim());
        if (created) notebookId = created;
      }

      for (let index = 0; index < parsed.notes.length; index += 1) {
        const draft: NoteDraft = { ...parsed.notes[index], notebookId };
        await putNote(session, draft);
        setProgress({ current: index + 1, total: parsed.notes.length });
      }
      await onRefresh();

      const count = parsed.notes.length;
      const skipped = parsed.skipped.length;
      setImportMsg({
        type: "success",
        text: `Imported ${count} note${count === 1 ? "" : "s"} into "${notebookNameById(notebooks, notebookId)}".${
          skipped ? ` ${skipped} too large to store and skipped.` : ""
        }`,
      });
      resetImport();
    } catch (err) {
      // The loop writes one note at a time, so a failure part way through leaves
      // the earlier ones stored. Say so rather than implying nothing happened.
      setImportMsg({
        type: "error",
        text: `Import stopped after ${progress?.current ?? 0} of ${parsed.notes.length}: ${friendlyError(err)}`,
      });
      await onRefresh();
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  function runExport() {
    if (exportNotes.length === 0) {
      setExportMsg({ type: "error", text: "No notes to export in the selected notebook." });
      return;
    }
    setExportMsg(null);
    try {
      const { filename, mime, data } = generateNoteExportData(exportFormat, exportNotes, notebooks);
      triggerDownload(filename, mime, data);
      setExportMsg({
        type: "success",
        text: `Exported ${exportNotes.length} note${exportNotes.length === 1 ? "" : "s"} as "${filename}".`,
      });
    } catch (err) {
      setExportMsg({ type: "error", text: `Export failed: ${friendlyError(err)}` });
    }
  }

  const banner = (message: Message) =>
    message ? (
      <div
        className={`rounded-lg px-3 py-2 text-xs font-medium ${
          message.type === "success"
            ? "bg-accent/10 text-accent border border-accent/20"
            : "bg-danger/10 text-danger border border-danger/20"
        }`}
      >
        {message.text}
      </div>
    ) : null;

  return (
    <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-4 shadow-sm sm:p-6 space-y-8">
      <div>
        <h3 className="text-base font-semibold text-text">Import &amp; Export Notes</h3>
        <p className="mt-1 text-xs text-mute leading-relaxed">
          Move notes in and out as plain Markdown, which any editor can read, or as
          a JSON backup that keeps notebooks, pins and timestamps.
        </p>
      </div>

      <div className="rounded-xl border border-line/80 bg-bg/50 p-4 space-y-5 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
              ↓
            </span>
            <h4 className="text-sm font-semibold text-text">Import Notes</h4>
          </div>
          <span className="text-[11px] text-mute font-mono">.md, .markdown, .txt, .json</span>
        </div>

        {!importFile || !parsed ? (
          // The file input below is `display: none`, so it is not in the
          // accessibility tree and cannot be tabbed to. This zone is the only
          // way to pick a file, so it carries the button semantics and the
          // keyboard activation itself.
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a notes file to import, or drop one here"
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
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center sm:p-7 transition-all cursor-pointer ${focusRing} ${
              dragActive
                ? "border-accent bg-accent/10 scale-[0.99]"
                : "border-line/80 hover:border-line-light hover:bg-surface/30"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json"
              onChange={onFileInputChange}
              className="hidden"
            />
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface border border-line text-accent mb-2">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.56l2.22 2.22a.75.75 0 1 0 1.06-1.06l-3.5-3.5a.75.75 0 0 0-1.06 0l-3.5 3.5a.75.75 0 0 0 1.06 1.06l2.22-2.22v8.69ZM3.5 14.25a.75.75 0 0 1 .75.75v1.5c0 .414.336.75.75.75h10a.75.75 0 0 0 .75-.75V15a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 15 18.75H5A2.25 2.25 0 0 1 2.75 16.5V15a.75.75 0 0 1 .75-.75Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-xs font-medium text-text">Click to select a file or drag it here</p>
            <p className="mt-1 text-[11px] text-mute">
              A Sealbook export, or any single Markdown file, which becomes one note
            </p>
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-accent/30 bg-surface/40 p-4 animate-fade-in">
            <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-text">
                  {importFile.name}
                </p>
                <p className="text-[11px] text-accent font-medium mt-0.5">
                  Detected {parsed.format} · {parsed.notes.length} note
                  {parsed.notes.length === 1 ? "" : "s"} found
                  {parsed.skipped.length
                    ? ` · ${parsed.skipped.length} too large to store`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={importing}
                onClick={resetImport}
                className="shrink-0 text-xs text-mute hover:text-text cursor-pointer"
              >
                Change file
              </button>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`${ids}-target-notebook`} className="text-xs font-medium text-text">
                  Target notebook
                </label>
                {onCreateNotebook ? (
                  <button
                    type="button"
                    disabled={importing}
                    onClick={() => setIsCreatingNotebook(!isCreatingNotebook)}
                    className="text-[11px] text-accent hover:underline cursor-pointer"
                  >
                    {isCreatingNotebook ? "Select existing notebook" : "+ Create new notebook"}
                  </button>
                ) : null}
              </div>
              {isCreatingNotebook || notebooks.length === 0 ? (
                <input
                  id={`${ids}-target-notebook`}
                  type="text"
                  value={newNotebookName}
                  onChange={(event) => setNewNotebookName(event.target.value)}
                  placeholder="e.g. Imported, Work, Journal"
                  className={field}
                  disabled={importing}
                  autoFocus
                />
              ) : (
                <select
                  id={`${ids}-target-notebook`}
                  value={targetNotebookId}
                  onChange={(event) => setTargetNotebookId(event.target.value)}
                  disabled={importing}
                  className={selectField}
                >
                  {notebooks.map((notebook) => (
                    <option key={notebook.id} value={notebook.id}>
                      {notebook.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="rounded-lg border border-line/70 bg-bg/70 p-3">
              <p className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                Preview (first {Math.min(parsed.notes.length, 3)} of {parsed.notes.length})
              </p>
              <div className="space-y-1.5 text-xs">
                {parsed.notes.slice(0, 3).map((draft, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between gap-3 py-1 border-b border-line/40 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-text">
                      {draft.title}
                    </span>
                    <span className="min-w-0 truncate font-mono text-[11px] text-mute">
                      {draft.body.length.toLocaleString()} chars
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {importing && progress ? (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] text-mute">
                  <span>Encrypting &amp; uploading notes…</span>
                  <span className="font-mono font-medium text-accent">
                    {progress.current} / {progress.total}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface border border-line">
                  <div
                    className="h-full bg-accent transition-all duration-150"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2.5 pt-2">
              <button type="button" disabled={importing} onClick={resetImport} className={btnSecondary}>
                Cancel
              </button>
              <button
                type="button"
                disabled={importing || (isCreatingNotebook && !newNotebookName.trim())}
                onClick={() => void runImport()}
                className={btnPrimary}
              >
                {importing
                  ? `Importing (${progress?.current ?? 0}/${parsed.notes.length})…`
                  : `Import ${parsed.notes.length} note${parsed.notes.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}

        {banner(importMsg)}
      </div>

      <div className="rounded-xl border border-line/80 bg-bg/50 p-4 space-y-5 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
              ↑
            </span>
            <h4 className="text-sm font-semibold text-text">Export Notes</h4>
          </div>
          <span className="text-[11px] text-mute font-mono">
            {exportNotes.length} note{exportNotes.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor={`${ids}-source-notebook`} className="block text-xs font-medium text-text mb-1">
              Source notebook
            </label>
            <select
              id={`${ids}-source-notebook`}
              value={exportNotebookFilter}
              onChange={(event) => setExportNotebookFilter(event.target.value)}
              className={selectField}
            >
              <option value={ALL_NOTEBOOKS}>All notebooks ({notes.length})</option>
              {notebooks.map((notebook) => {
                const count = notes.filter(
                  (note) => resolveNotebookId(note.notebookId) === notebook.id,
                ).length;
                return (
                  <option key={notebook.id} value={notebook.id}>
                    {notebook.name} ({count})
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label htmlFor={`${ids}-note-export-format`} className="block text-xs font-medium text-text mb-1">
              Export format
            </label>
            <select
              id={`${ids}-note-export-format`}
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value as NoteExportFormat)}
              className={selectField}
            >
              <option value="md">Markdown (.md) · readable anywhere</option>
              <option value="json">JSON (.json) · lossless full backup</option>
            </select>
          </div>
        </div>

        {banner(exportMsg)}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            disabled={exportNotes.length === 0}
            onClick={runExport}
            className={btnPrimary}
          >
            Export {exportNotes.length} note{exportNotes.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </section>
  );
}
