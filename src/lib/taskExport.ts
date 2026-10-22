import { parseTask, resolveTaskListId } from "./task";
import type { Task, TaskDraft, TaskList } from "./types";

const EXPORT_TYPE = "sealbook-task-export";

type TaskExportEntry = Omit<TaskDraft, "taskListId" | "raw" | "unknownPriority"> & {
  id: string;
  listName: string;
};

export type ImportedTask = {
  /** The id the file gave the task, which a subtask's `parentId` points at. */
  sourceId?: string;
  draft: TaskDraft;
};

export type TaskImportResult = {
  tasks: ImportedTask[];
  skipped: number;
};

export function generateTaskExportData(
  tasks: Task[],
  lists: TaskList[],
): { filename: string; mime: string; data: string } {
  const nameById = new Map(lists.map((list) => [list.id, list.name]));
  const entries: TaskExportEntry[] = tasks.map((task) => {
    const { raw: _raw, taskListId, ...fields } = task;
    return { ...stripEmpty(fields), listName: nameById.get(resolveTaskListId(taskListId)) ?? "Default Task List" };
  });
  const payload = {
    "@type": EXPORT_TYPE,
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: entries,
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      ...(list.parentId ? { parentId: list.parentId } : {}),
      ...(list.color ? { color: list.color } : {}),
    })),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    filename: `sealbook-tasks-${stamp}.json`,
    mime: "application/json",
    data: JSON.stringify(payload, null, 2),
  };
}

function stripEmpty<T extends object>(value: T): T {
  const kept: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || (Array.isArray(entry) && entry.length === 0)) continue;
    kept[key] = entry;
  }
  return kept as T;
}

/**
 * Reads a task export, or a bare JSON array of task-like objects. Every field
 * goes through `parseTask`, so an import is held to the same reading rules as a
 * task already in the vault.
 */
export function parseTaskImport(content: string): TaskImportResult {
  const parsed: unknown = JSON.parse(content);
  const entries = extractEntries(parsed);
  if (entries === null) {
    throw new Error(
      "Unrecognised format. Expected a Sealbook task export or a JSON array of tasks.",
    );
  }
  const tasks: ImportedTask[] = [];
  let skipped = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      skipped += 1;
      continue;
    }
    const fields = entry as Record<string, unknown>;
    if (typeof fields.title !== "string" || !fields.title.trim()) {
      skipped += 1;
      continue;
    }
    const task = parseTask("import", JSON.stringify({ ...fields, "@type": "Task" }));
    const { id: _id, raw: _raw, ...draft } = task;
    tasks.push({
      sourceId: typeof fields.id === "string" && fields.id ? fields.id : undefined,
      draft: stripEmpty(draft),
    });
  }
  return { tasks, skipped };
}

/**
 * The tasks with every parent before its subtasks, so the parent's new id
 * exists by the time a child is written. A parent the file does not hold, or
 * one that sits on a cycle, leaves the child at the top level.
 */
export function importOrder(tasks: ImportedTask[]): ImportedTask[] {
  const bySource = new Map<string, ImportedTask>();
  for (const task of tasks) {
    if (task.sourceId && !bySource.has(task.sourceId)) bySource.set(task.sourceId, task);
  }
  const placed = new Set<ImportedTask>();
  const ordered: ImportedTask[] = [];

  function place(task: ImportedTask, trail: Set<ImportedTask>): void {
    if (placed.has(task)) return;
    const parent = task.draft.parentId ? bySource.get(task.draft.parentId) : undefined;
    if (parent && parent !== task && !trail.has(parent)) {
      trail.add(task);
      place(parent, trail);
    } else if (task.draft.parentId) {
      task.draft = { ...task.draft, parentId: undefined };
    }
    placed.add(task);
    ordered.push(task);
  }

  for (const task of tasks) place(task, new Set());
  return ordered;
}

function extractEntries(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const body = parsed as Record<string, unknown>;
  return body["@type"] === EXPORT_TYPE && Array.isArray(body.tasks) ? body.tasks : null;
}
