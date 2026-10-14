/**
 * The notebook's note tree.
 *
 * A note points at its parent, so the shape lives in the notes rather than in a
 * stored tree. The pointer walking, including the cycle and missing-parent
 * defences, is `lib/tree`, which the bookmark collection tree shares; this
 * module is the note-shaped view of it.
 */

import { resolveNotebookId, sortNotes } from "./note";
import { ancestorsOf as treeAncestors, buildTree, canReparent as treeCanReparent, subtree } from "./tree";
import type { TreeNode } from "./tree";
import type { Note } from "./types";

export type NoteTreeNode = {
  note: Note;
  depth: number;
  children: NoteTreeNode[];
};

function asNoteNode(node: TreeNode<Note>): NoteTreeNode {
  return { note: node.item, depth: node.depth, children: node.children.map(asNoteNode) };
}

/**
 * The tree for one notebook. A note whose parent is in another notebook sits at
 * this notebook's top level, so moving a parent never hides its children.
 */
export function buildNoteTree(notes: Note[], notebookId: string): NoteTreeNode[] {
  const scoped = notes.filter((note) => resolveNotebookId(note.notebookId) === notebookId);
  return buildTree(scoped, sortNotes).map(asNoteNode);
}

/** The note and everything under it, the note itself first. */
export function noteSubtree(notes: Note[], id: string): string[] {
  return subtree(notes, id);
}

/** Whether `id` may be dropped under `parentId` without the tree eating itself. */
export function canReparent(notes: Note[], id: string, parentId: string | null): boolean {
  return treeCanReparent(notes, id, parentId);
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
  return treeAncestors(notes, id);
}
