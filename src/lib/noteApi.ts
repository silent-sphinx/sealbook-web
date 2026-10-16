import {
  DEFAULT_NOTEBOOK_ID,
  DEFAULT_NOTEBOOK_NAME,
  NOTEBOOK_CONTENT_TYPE,
  NOTE_CONTENT_TYPE,
  serializeNote,
  serializeNotebook,
  sortNotebooks,
} from "./note";
import { putSealed } from "./client";
import type { NoteDraft, Notebook } from "./types";
import type { Session } from "./client";
import { newUuid } from "./wasm";

/**
 * The id a new note will be stored under, issued before its first write so that
 * autosave's repeated writes are updates rather than a race to create.
 */
export function newNoteId(): string {
  return newUuid();
}

export async function putNote(
  session: Session,
  draft: NoteDraft,
  existingId?: string,
): Promise<string> {
  const id = existingId ?? newUuid();
  await putSealed(session, id, NOTE_CONTENT_TYPE, false, serializeNote(draft));
  return id;
}

export async function deleteNote(session: Session, id: string): Promise<void> {
  await putSealed(session, id, NOTE_CONTENT_TYPE, true, "");
}

export async function putNotebook(
  session: Session,
  name: string,
  existingId?: string,
  previousRaw?: string,
): Promise<string> {
  const id = existingId ?? newUuid();
  await putSealed(
    session,
    id,
    NOTEBOOK_CONTENT_TYPE,
    false,
    serializeNotebook(name, previousRaw),
  );
  return id;
}

export async function deleteNotebook(session: Session, id: string): Promise<void> {
  await putSealed(session, id, NOTEBOOK_CONTENT_TYPE, true, "");
}

/**
 * Returns the notebook list with the default one present, creating it if needed.
 *
 * Unlike `ensureDefaultAddressBook` this is called when the Notes tab is first
 * opened rather than on every vault refresh. A write here can fail (quota, rate
 * limit, an older server), and on the refresh path that failure would stop the
 * whole vault loading, contacts included.
 */
export async function ensureDefaultNotebook(
  session: Session,
  notebooks: Notebook[],
): Promise<Notebook[]> {
  if (notebooks.some((notebook) => notebook.id === DEFAULT_NOTEBOOK_ID)) {
    return sortNotebooks(notebooks);
  }
  await putNotebook(session, DEFAULT_NOTEBOOK_NAME, DEFAULT_NOTEBOOK_ID);
  return sortNotebooks([
    {
      id: DEFAULT_NOTEBOOK_ID,
      name: DEFAULT_NOTEBOOK_NAME,
      raw: serializeNotebook(DEFAULT_NOTEBOOK_NAME),
    },
    ...notebooks,
  ]);
}