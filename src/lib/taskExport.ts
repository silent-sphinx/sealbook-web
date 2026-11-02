import { draftFrom, listTo, taskTo } from "./task";
import type { Task, TaskDraft, TaskList } from "./types";
import { coreErrorOf, coreTaskExport, coreTaskImport } from "./wasm";

export type ImportedTask = {
  /** The id the file gave the task, which a subtask's `parentId` points at. */
  sourceId?: string;
  draft: TaskDraft;
};

export type TaskImportResult = {
  /** Every parent before its subtasks, so each parent's new id exists first. */
  tasks: ImportedTask[];
  skipped: number;
};

export function generateTaskExportData(
  tasks: Task[],
  lists: TaskList[],
): { filename: string; mime: string; data: string } {
  const now = new Date().toISOString();
  return {
    filename: `sealbook-tasks-${now.slice(0, 10)}.json`,
    mime: "application/json",
    data: coreTaskExport(tasks.map(taskTo), lists.map(listTo), now),
  };
}

/**
 * Reads a task export, or a bare JSON array of task-like objects, through core,
 * which holds each entry to the rules a stored task is held to.
 */
export function parseTaskImport(content: string): TaskImportResult {
  try {
    const read = coreTaskImport(content);
    return {
      tasks: read.tasks.map((task) => ({
        sourceId: task.source_id,
        draft: draftFrom(task.draft),
      })),
      skipped: read.skipped,
    };
  } catch (error) {
    const core = coreErrorOf(error);
    throw core?.kind === "Malformed" ? new Error(core.detail) : error;
  }
}
