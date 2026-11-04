import { useId, useState } from "react";

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
import { generateTaskExportData, parseTaskImport, type TaskImportResult } from "../lib/taskExport";
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
import type { Task, TaskList } from "../lib/types";

const MAX_IMPORT_FILE_BYTES = 32 * 1024 * 1024;

type Props = {
  session: Session;
  tasks: Task[];
  taskLists: TaskList[];
  onRefresh: () => Promise<void>;
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function readError(err: unknown): string {
  return err instanceof Error ? err.message : friendlyError(err);
}


export function TasksImportExportSection({ session, tasks, taskLists, onRefresh }: Props) {
  const ids = useId();
  const [importFile, setImportFile] = useState<{ name: string } | null>(null);
  const [parsed, setParsed] = useState<TaskImportResult | null>(null);
  const [targetListId, setTargetListId] = useState<string>(taskLists[0]?.id ?? DEFAULT_TASK_LIST_ID);
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [importMsg, setImportMsg] = useState<Notice>(null);
  const [exportListFilter, setExportListFilter] = useState<string>(ALL_TASK_LISTS);
  const [exportMsg, setExportMsg] = useState<Notice>(null);

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

  function resetImport() {
    setImportFile(null);
    setParsed(null);
    setProgress(null);
    setCreatingList(false);
    setNewListName("");
  }

  async function runImport() {
    if (!parsed || parsed.tasks.length === 0) return;
    const ordered = parsed.tasks;
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

  const creating = creatingList || taskLists.length === 0;

  return (
    <>
      <SettingsGroup
        title="Import tasks"
        meta=".json"
        description="Restore a Sealbook task export with its due dates, repeats, priorities, tags and subtasks, or bring in any JSON list of tasks."
      >
        {!importFile || !parsed ? (
          <FileDrop
            label="Choose a tasks file to import, or drop one here"
            accept=".json,application/json"
            formats=".json"
            hint="A Sealbook task export, or any JSON array of objects with a title"
            inputLabel="Tasks file"
            onFile={handleFileRead}
          />
        ) : (
          <ImportReview
            fileName={importFile.name}
            summary={`${plural(parsed.tasks.length, "task")} found${parsed.skipped > 0 ? ` · ${parsed.skipped} skipped` : ""}`}
            busy={importing}
            onChangeFile={resetImport}
          >
            <TargetPicker
              id={`${ids}-target`}
              label="Target list"
              noun="list"
              creating={creating}
              canCreate
              onToggle={() => setCreatingList(!creatingList)}
              disabled={importing}
              name={newListName}
              onName={setNewListName}
              placeholder="e.g. Imported, Work, Groceries"
              value={targetListId}
              onValue={setTargetListId}
              options={taskLists}
            />
            <ImportPreview
              rows={parsed.tasks.slice(0, 3).map((entry) => ({
                primary: entry.draft.title,
                secondary: entry.draft.dueDate ? entry.draft.dueDate.slice(0, 10) : undefined,
              }))}
              total={parsed.tasks.length}
            />
            {importing ? <ImportProgress label="Encrypting and uploading tasks…" progress={progress} /> : null}
            <div className={actionRow}>
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
          </ImportReview>
        )}
        <NoticeLine notice={importMsg} />
      </SettingsGroup>

      <SettingsGroup
        title="Export tasks"
        meta={plural(exportTasks.length, "task")}
        description="A JSON backup that keeps due dates, repeats, priorities, tags and subtasks, which you can restore here."
      >
        <div>
          <label htmlFor={`${ids}-source`} className={fieldLabel}>
            Source list
          </label>
          <select
            id={`${ids}-source`}
            value={exportListFilter}
            onChange={(event) => setExportListFilter(event.target.value)}
            className={`${selectField} mt-1.5`}
          >
            <option value={ALL_TASK_LISTS}>All lists ({tasks.length})</option>
            {taskLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name} ({tasks.filter((task) => resolveTaskListId(task.taskListId) === list.id).length})
              </option>
            ))}
          </select>
        </div>
        <NoticeLine notice={exportMsg} />
        <div className={actionRow}>
          <button type="button" disabled={exportTasks.length === 0} onClick={runExport} className={btnPrimary}>
            Export {plural(exportTasks.length, "task")}
          </button>
        </div>
      </SettingsGroup>
    </>
  );
}
