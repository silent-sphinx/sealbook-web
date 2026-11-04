import { useId, useState } from "react";

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
import { btnPrimary, btnSecondary, fieldLabel, selectField } from "../lib/styles";
import {
  FileDrop,
  ImportPreview,
  ImportProgress,
  ImportReview,
  NoticeLine,
  SettingsGroup,
  TargetPicker,
  actionRow,
  type Notice,
} from "./SettingsKit";
import type { Note, NoteDraft, Notebook } from "../lib/types";

const MAX_IMPORT_FILE_BYTES = 128 * 1024 * 1024;

type Props = {
  session: Session;
  notes: Note[];
  notebooks: Notebook[];
  onRefresh: () => Promise<void>;
  onCreateNotebook?: (name: string) => Promise<string | undefined>;
};

export function NotesImportExportSection({
  session,
  notes,
  notebooks,
  onRefresh,
  onCreateNotebook,
}: Props) {
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
  const [importMsg, setImportMsg] = useState<Notice>(null);

  const [exportNotebookFilter, setExportNotebookFilter] = useState<string>(ALL_NOTEBOOKS);
  const [exportFormat, setExportFormat] = useState<NoteExportFormat>("md");
  const [exportMsg, setExportMsg] = useState<Notice>(null);

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


  const noteCount = (count: number) => `${count} note${count === 1 ? "" : "s"}`;
  const creating = isCreatingNotebook || notebooks.length === 0;

  return (
    <>
      <SettingsGroup
        title="Import notes"
        meta=".md, .txt, .json"
        description="Bring in plain Markdown, which becomes one note per file, or restore a Sealbook export with its notebooks, pins and timestamps."
      >
        {!importFile || !parsed ? (
          <FileDrop
            label="Choose a notes file to import, or drop one here"
            accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json"
            formats=".md .txt .json"
            hint="A Sealbook export, or any single Markdown file, which becomes one note"
            onFile={handleFileRead}
          />
        ) : (
          <ImportReview
            fileName={importFile.name}
            summary={`Detected ${parsed.format} · ${noteCount(parsed.notes.length)} found${
              parsed.skipped.length ? ` · ${parsed.skipped.length} too large to store` : ""
            }`}
            busy={importing}
            onChangeFile={resetImport}
          >
            <TargetPicker
              id={`${ids}-target-notebook`}
              label="Target notebook"
              noun="notebook"
              creating={creating}
              canCreate={Boolean(onCreateNotebook)}
              onToggle={() => setIsCreatingNotebook(!isCreatingNotebook)}
              disabled={importing}
              name={newNotebookName}
              onName={setNewNotebookName}
              placeholder="e.g. Imported, Work, Journal"
              value={targetNotebookId}
              onValue={setTargetNotebookId}
              options={notebooks}
            />
            <ImportPreview
              rows={parsed.notes.slice(0, 3).map((draft) => ({
                primary: draft.title,
                secondary: `${draft.body.length.toLocaleString()} chars`,
              }))}
              total={parsed.notes.length}
            />
            {importing ? <ImportProgress label="Encrypting and uploading notes…" progress={progress} /> : null}
            <div className={actionRow}>
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
                  : `Import ${noteCount(parsed.notes.length)}`}
              </button>
            </div>
          </ImportReview>
        )}
        <NoticeLine notice={importMsg} />
      </SettingsGroup>

      <SettingsGroup
        title="Export notes"
        meta={noteCount(exportNotes.length)}
        description="Markdown opens in any editor. JSON keeps notebooks, pins and timestamps, for a backup you can restore here."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${ids}-source-notebook`} className={fieldLabel}>
              Source notebook
            </label>
            <select
              id={`${ids}-source-notebook`}
              value={exportNotebookFilter}
              onChange={(event) => setExportNotebookFilter(event.target.value)}
              className={`${selectField} mt-1.5`}
            >
              <option value={ALL_NOTEBOOKS}>All notebooks ({notes.length})</option>
              {notebooks.map((notebook) => (
                <option key={notebook.id} value={notebook.id}>
                  {notebook.name} ({notes.filter((note) => resolveNotebookId(note.notebookId) === notebook.id).length})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${ids}-note-export-format`} className={fieldLabel}>
              Export format
            </label>
            <select
              id={`${ids}-note-export-format`}
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value as NoteExportFormat)}
              className={`${selectField} mt-1.5`}
            >
              <option value="md">Markdown (.md) · readable anywhere</option>
              <option value="json">JSON (.json) · lossless full backup</option>
            </select>
          </div>
        </div>
        <NoticeLine notice={exportMsg} />
        <div className={actionRow}>
          <button type="button" disabled={exportNotes.length === 0} onClick={runExport} className={btnPrimary}>
            Export {noteCount(exportNotes.length)}
          </button>
        </div>
      </SettingsGroup>
    </>
  );
}
