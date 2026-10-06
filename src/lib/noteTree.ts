/**
 * The notebook's note tree.
 *
 * A note points at its parent, so the shape lives in the notes rather than in a
 * stored tree. Nothing validates those pointers: two devices editing offline can
 * each make the other's note the parent, and a note whose parent was deleted
 * keeps pointing at an id that is gone. Both are read here as "no parent" rather
 * than being allowed to hide a note or spin a walk forever.
 */

import { resolveNotebookId, sortNotes } from "./note";
import type { Note } from "./types";

export type NoteTreeNode = {
  note: Note;
  depth: number;
  children: NoteTreeNode[];
};

/**
 * The parent to actually use for a note: its own, unless that is missing, is
 * itself, or sits on a chain that leads back to it.
 */
function resolveParent(id: string, byId: Map<string, Note>): string | null {
  const parentId = byId.get(id)?.parentId;
  if (!parentId || parentId === id || !byId.has(parentId)) return null;
  const seen = new Set<string>([id]);
  let cursor: string | undefined = parentId;
  while (cursor !== undefined) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const next: string | undefined = byId.get(cursor)?.parentId;
    cursor = next !== undefined && byId.has(next) ? next : undefined;
  }
  return parentId;
}

/**
 * The tree for one notebook. A note whose parent is in another notebook sits at
 * this notebook's top level, so moving a parent never hides its children.
 */
export function buildNoteTree(notes: Note[], notebookId: string): NoteTreeNode[] {
  const scoped = notes.filter((note) => resolveNotebookId(note.notebookId) === notebookId);
  const byId = new Map(scoped.map((note) => [note.id, note]));
  const children = new Map<string | null, Note[]>();
  for (const note of scoped) {
    const parent = resolveParent(note.id, byId);
    children.set(parent, [...(children.get(parent) ?? []), note]);
  }
  const build = (parent: string | null, depth: number): NoteTreeNode[] =>
    sortNotes(children.get(parent) ?? []).map((note) => ({
      note,
      depth,
      children: build(note.id, depth + 1),
    }));
  return build(null, 0);
}

/** The note and everything under it, the note itself first. */
export function noteSubtree(notes: Note[], id: string): string[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const childrenOf = new Map<string, string[]>();
  for (const note of notes) {
    const parent = resolveParent(note.id, byId);
    if (parent !== null) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), note.id]);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    out.push(current);
    stack.push(...(childrenOf.get(current) ?? []));
  }
  return out;
}

/** Whether `id` may be dropped under `parentId` without the tree eating itself. */
export function canReparent(notes: Note[], id: string, parentId: string | null): boolean {
  if (parentId === null) return true;
  if (parentId === id) return false;
  if (!notes.some((note) => note.id === parentId)) return false;
  return !noteSubtree(notes, id).includes(parentId);
}

/** Depth-first order, which is the order the sidebar draws rows in. */
export function flattenTree(nodes: NoteTreeNode[]): NoteTreeNode[] {
  const out: NoteTreeNode[] = [];
  const walk = (list: NoteTreeNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** The ancestors of a note, nearest first, so the sidebar can reveal it. */
export function ancestorsOf(notes: Note[], id: string): string[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cursor = resolveParent(id, byId);
  while (cursor !== null && !seen.has(cursor)) {
    out.push(cursor);
    seen.add(cursor);
    cursor = resolveParent(cursor, byId);
  }
  return out;
}
