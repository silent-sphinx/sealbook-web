import { putSealed } from "./client";
import type { Session } from "./client";
import {
  DEFAULT_TASK_LIST_ID,
  DEFAULT_TASK_LIST_NAME,
  parseTask,
  parseTaskList,
  serializeTask,
  serializeTaskList,
  sortTaskLists,
  TASK_CONTENT_TYPE,
  TASK_LIST_CONTENT_TYPE,
} from "./task";
import type { Task, TaskDraft, TaskList } from "./types";
import { newUuid } from "./wasm";

export function newTaskId(): string {
  return newUuid();
}

/**
 * Returns the object as it was stored, so a caller can fold it into the list it
 * is showing rather than re-reading the whole vault to see one write.
 */
export async function putTask(
  session: Session,
  draft: TaskDraft,
  existingId?: string,
): Promise<Task> {
  const id = existingId ?? newUuid();
  const payload = serializeTask(draft);
  await putSealed(session, id, TASK_CONTENT_TYPE, false, payload);
  return parseTask(id, payload);
}

export async function deleteTask(session: Session, id: string): Promise<void> {
  await putSealed(session, id, TASK_CONTENT_TYPE, true, "");
}

export async function putTaskList(
  session: Session,
  name: string,
  parentId?: string,
  existingId?: string,
  previousRaw?: string,
  color?: string,
  archived?: boolean,
): Promise<TaskList> {
  const id = existingId ?? newUuid();
  const payload = serializeTaskList(name, parentId, previousRaw, color, archived);
  await putSealed(session, id, TASK_LIST_CONTENT_TYPE, false, payload);
  return parseTaskList(id, payload);
}

export async function deleteTaskList(session: Session, id: string): Promise<void> {
  await putSealed(session, id, TASK_LIST_CONTENT_TYPE, true, "");
}

/**
 * Called when the Tasks tab is first opened, never from the vault refresh: a
 * failed write on that path would stop the whole vault loading. The id is
 * reserved, so a second device adopts the list already there.
 */
export async function ensureDefaultTaskList(
  session: Session,
  lists: TaskList[],
): Promise<TaskList[]> {
  if (lists.some((list) => list.id === DEFAULT_TASK_LIST_ID)) return sortTaskLists(lists);
  const created = await putTaskList(
    session,
    DEFAULT_TASK_LIST_NAME,
    undefined,
    DEFAULT_TASK_LIST_ID,
  );
  return sortTaskLists([created, ...lists]);
}
