import { putSealed } from "./client";
import type { Session } from "./client";
import {
  DEFAULT_TASK_LIST_ID,
  DEFAULT_TASK_LIST_NAME,
  serializeTask,
  serializeTaskList,
  sortTaskLists,
  TASK_CONTENT_TYPE,
  TASK_LIST_CONTENT_TYPE,
} from "./task";
import type { TaskDraft, TaskList } from "./types";
import { newUuid } from "./wasm";

export function newTaskId(): string {
  return newUuid();
}

export async function putTask(
  session: Session,
  draft: TaskDraft,
  existingId?: string,
): Promise<string> {
  const id = existingId ?? newUuid();
  await putSealed(session, id, TASK_CONTENT_TYPE, false, serializeTask(draft));
  return id;
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
): Promise<string> {
  const id = existingId ?? newUuid();
  await putSealed(
    session,
    id,
    TASK_LIST_CONTENT_TYPE,
    false,
    serializeTaskList(name, parentId, previousRaw, color),
  );
  return id;
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
  await putTaskList(session, DEFAULT_TASK_LIST_NAME, undefined, DEFAULT_TASK_LIST_ID);
  return sortTaskLists([
    {
      id: DEFAULT_TASK_LIST_ID,
      name: DEFAULT_TASK_LIST_NAME,
      raw: serializeTaskList(DEFAULT_TASK_LIST_NAME),
    },
    ...lists,
  ]);
}
