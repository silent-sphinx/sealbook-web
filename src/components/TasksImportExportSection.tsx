import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import type { Session } from "../lib/client";
import { friendlyError } from "../lib/errors";
import { triggerDownload } from "../lib/importExport";
import {
  ALL_TASK_LISTS,
  DEFAULT_TASK_LIST_ID,
  resolveTaskListId,
  sortTasks,
  taskListNameById,
} from "../lib/task";
import { newTaskId, putTask, putTaskList } from "../lib/taskApi";
import {
  generateTaskExportData,
  importOrder,
  parseTaskImport,
  type TaskImportResult,
} from "../lib/taskExport";
import { btnPrimary, btnSecondary, field, focusRing, selectField } from "../lib/styles";
import type { Task, TaskList } from "../lib/types";

const MAX_IMPORT_FILE_BYTES = 32 * 1024 * 1024;

type Props = {
  session: Session;
  tasks: Task[];
  taskLists: TaskList[];
  onRefresh: () => Promise<void>;
};

type Message = { type: "success" | "error"; text: string } | null;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function readError(err: unknown): string {
  if (err instanceof SyntaxError) return "That file is not valid JSON.";
  return err instanceof Error ? err.message : friendlyError(err);
}

function Banner({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <div
      role={message.type === "error" ? "alert" : "status"}
      className={`rounded-lg px-3 py-2 text-xs font-medium ${
        message.type === "success"
          ? "border border-accent/20 bg-accent/10 text-accent"
          : "border border-danger/20 bg-danger/10 text-danger"
      }`}
    >
      {message.text}
    </div>
  );
}

export function TasksImportExportSection({ session, tasks, taskLists, onRefresh }: Props) {
  const ids = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importFile, setImportFile] = useState<{ name: string } | null>(null);
  const [parsed, setParsed] = useState<TaskImportResult | null>(null);
  const [targetListId, setTargetListId] = useState<string>(taskLists[0]?.id ?? DEFAULT_TASK_LIST_ID);
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [importMsg, setImportMsg] = useState<Message>(null);
  const [exportListFilter, setExportListFilter] = useState<string>(ALL_TASK_LISTS);
  const [exportMsg, setExportMsg] = useState<Message>(null);

  const exportTasks = sortTasks(
    exportListFilter === ALL_TASK_LISTS
      ? tasks
      : tasks.filter((task) => resolveTaskListId(task.taskListId) === exportListFilter),
  );

  function handleFileRead(file: File) {
    setImportMsg(null);
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setImportMsg({ type: "error", text: "Import files must be 32 MB or smaller." });
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
        const result = parseTaskImport(content);
        if (result.tasks.length === 0) {
          setImportMsg({
            type: "error",
            text:
              result.skipped > 0
                ? `Every entry in "${file.name}" was missing a title.`
                : `No tasks could be read from "${file.name}".`,
          });
          return;
        }
        setImportFile({ name: file.name });
        setParsed(result);
      } catch (err) {
        setImportMsg({ type: "error", text: readError(err) });
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
    setCreatingList(false);
    setNewListName("");
  }

  async function runImport() {
    if (!parsed || parsed.tasks.length === 0) return;
    const ordered = importOrder(parsed.tasks);
    setImporting(true);
    setImportMsg(null);
    setProgress({ current: 0, total: ordered.length });
    let written = 0;
    try {
      let listId = targetListId;
      if (creatingList && newListName.trim()) {
        listId = (await putTaskList(session, newListName.trim())).id;
      }
      const newIds = new Map<string, string>();
      for (const entry of ordered) {
        const id = newTaskId();
        if (entry.sourceId) newIds.set(entry.sourceId, id);
        const parentId = entry.draft.parentId ? newIds.get(entry.draft.parentId) : undefined;
        await putTask(session, { ...entry.draft, taskListId: listId, parentId }, id);
        written += 1;
        setProgress({ current: written, total: ordered.length });
      }
      await onRefresh();
      const skipped = parsed.skipped;
      setImportMsg({
        type: "success",
        text: `Imported ${plural(written, "task")} into "${
          creatingList && newListName.trim() ? newListName.trim() : taskListNameById(taskLists, listId)
        }".${skipped ? ` ${plural(skipped, "entry")} had no title and ${skipped === 1 ? "was" : "were"} skipped.` : ""}`,
      });
      resetImport();
    } catch (err) {
      setImportMsg({
        type: "error",
        text: `Import stopped after ${written} of ${ordered.length}: ${friendlyError(err)}`,
      });
      await onRefresh();
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  function runExport() {
    if (exportTasks.length === 0) {
      setExportMsg({ type: "error", text: "No tasks to export in the selected list." });
      return;
    }
    setExportMsg(null);
    try {
      const { filename, mime, data } = generateTaskExportData(exportTasks, taskLists);
      triggerDownload(filename, mime, data);
      setExportMsg({
        type: "success",
        text: `Exported ${plural(exportTasks.length, "task")} as "${filename}".`,
      });
    } catch (err) {
      setExportMsg({ type: "error", text: `Export failed: ${friendlyError(err)}` });
    }
  }

  return (
    <section className="space-y-8 rounded-2xl border border-line bg-panel/75 p-4 shadow-sm backdrop-blur-md sm:p-6">
      <div>
        <h3 className="text-base font-semibold text-text">Import &amp; Export Tasks</h3>
        <p className="mt-1 text-xs leading-relaxed text-mute">
          Move tasks in and out of Sealbook as a JSON backup that keeps due dates, repeats,
          priorities, tags and subtasks intact.
        </p>
      </div>

      <div className="space-y-5 rounded-xl border border-line/80 bg-bg/50 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-text">Import Tasks</h4>
          <span className="font-mono text-[11px] text-mute">.json</span>
        </div>

        {!importFile || !parsed ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a tasks file to import, or drop one here"
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
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center sm:p-7 transition-all ${focusRing} ${
              dragActive
                ? "scale-[0.99] border-accent bg-accent/10"
                : "border-line/80 hover:border-line-light hover:bg-surface/30"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              aria-label="Tasks file"
              onChange={onFileInputChange}
              className="hidden"
            />
            <p className="text-xs font-medium text-text">Click to select a file or drag it here</p>
            <p className="mt-1 text-[11px] text-mute">
              A Sealbook task export (.json), or any JSON array of objects with a title
            </p>
          </div>
        ) : (
          <div className="animate-fade-in space-y-4 rounded-xl border border-accent/30 bg-surface/40 p-4">
            <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-text">
                  {importFile.name}
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-accent">
                  {plural(parsed.tasks.length, "task")} found
                  {parsed.skipped > 0 ? ` · ${parsed.skipped} skipped` : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={importing}
                onClick={resetImport}
                className="cursor-pointer text-xs text-mute hover:text-text"
              >
                Change file
              </button>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={`${ids}-target`} className="text-xs font-medium text-text">
                  Target list
                </label>
                <button
                  type="button"
                  disabled={importing}
                  onClick={() => setCreatingList(!creatingList)}
                  className="cursor-pointer text-[11px] text-accent hover:underline"
                >
                  {creatingList ? "Select existing list" : "+ Create new list"}
                </button>
              </div>
              {creatingList || taskLists.length === 0 ? (
                <input
                  id={`${ids}-target`}
                  type="text"
                  value={newListName}
                  onChange={(event) => setNewListName(event.target.value)}
                  placeholder="e.g. Imported, Work, Groceries"
                  className={field}
                  disabled={importing}
                  autoFocus
                />
              ) : (
                <select
                  id={`${ids}-target`}
                  value={targetListId}
                  onChange={(event) => setTargetListId(event.target.value)}
                  disabled={importing}
                  className={selectField}
                >
                  {taskLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="rounded-lg border border-line/70 bg-bg/70 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-mute">
                Preview (first {Math.min(parsed.tasks.length, 3)} of {parsed.tasks.length})
              </p>
              <div className="space-y-1.5 text-xs">
                {parsed.tasks.slice(0, 3).map((entry, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between gap-3 border-b border-line/40 py-1 last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-text">
                      {entry.draft.title}
                    </span>
                    <span className="font-mono text-[11px] text-mute">
                      {entry.draft.dueDate ? entry.draft.dueDate.slice(0, 10) : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {importing && progress ? (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] text-mute">
                  <span>Encrypting &amp; uploading tasks…</span>
                  <span className="font-mono font-medium text-accent">
                    {progress.current} / {progress.total}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full border border-line bg-surface">
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
                disabled={importing || (creatingList && !newListName.trim())}
                onClick={() => void runImport()}
                className={btnPrimary}
              >
                {importing
                  ? `Importing (${progress?.current ?? 0}/${parsed.tasks.length})…`
                  : `Import ${plural(parsed.tasks.length, "task")}`}
              </button>
            </div>
          </div>
        )}

        <Banner message={importMsg} />
      </div>

      <div className="space-y-5 rounded-xl border border-line/80 bg-bg/50 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-text">Export Tasks</h4>
          <span className="font-mono text-[11px] text-mute">{plural(exportTasks.length, "task")}</span>
        </div>

        <div>
          <label htmlFor={`${ids}-source`} className="mb-1 block text-xs font-medium text-text">
            Source list
          </label>
          <select
            id={`${ids}-source`}
            value={exportListFilter}
            onChange={(event) => setExportListFilter(event.target.value)}
            className={selectField}
          >
            <option value={ALL_TASK_LISTS}>All lists ({tasks.length})</option>
            {taskLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({tasks.filter((task) => resolveTaskListId(task.taskListId) === list.id).length})
              </option>
            ))}
          </select>
        </div>

        <Banner message={exportMsg} />

        <div className="flex justify-end pt-1">
          <button type="button" disabled={exportTasks.length === 0} onClick={runExport} className={btnPrimary}>
            Export {plural(exportTasks.length, "task")}
          </button>
        </div>
      </div>
    </section>
  );
}
