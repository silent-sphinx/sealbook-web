import { useState } from "react";

import type { NoteTreeNode } from "../lib/noteTree";
import { focusRing, sidebarGutter } from "../lib/styles";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import type { Note } from "../lib/types";

type Props = {
  tree: NoteTreeNode[];
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (note: Note) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (note: Note) => void;
  /**
   * The ids `id` may not be dropped onto, read once when the drag starts rather
   * than per row per frame. `onMove` is still the last word on a drop, since
   * the tree can change under a drag in flight.
   */
  blockedDropIds: (id: string) => Set<string>;
  onMove: (id: string, parentId: string | null) => void;
};

const DRAG_TYPE = "application/x-sealbook-note";

const NO_BLOCKED: ReadonlySet<string> = new Set();

export function NoteTreeList({
  tree,
  selectedId,
  expanded,
  onToggle,
  onSelect,
  onAddChild,
  onDelete,
  blockedDropIds,
  onMove,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(NO_BLOCKED);
  const menu = useContextMenu();

  function endDrag() {
    setDragging(null);
    setOver(null);
    setBlocked(NO_BLOCKED);
  }

  /** The same actions the row's own buttons carry, for the context menu. */
  function itemsFor(note: Note): MenuItem[] {
    return [
      { label: "Add a note inside", onSelect: () => onAddChild(note.id) },
      { label: "Delete note", danger: true, onSelect: () => onDelete(note) },
    ];
  }

  function rows(nodes: NoteTreeNode[]): React.ReactNode {
    return nodes.map((node) => {
      const { note } = node;
      const open = expanded.has(note.id);
      const hasChildren = node.children.length > 0;
      const active = selectedId === note.id;
      const droppable = dragging !== null && !blocked.has(note.id);

      /**
       * One slot, at the column the notebook list puts its icon in: a chevron
       * where the note has children, the page mark where it does not. A reserved
       * chevron column of its own would push every row out of line with the
       * notebooks above, and a chevron that only appears on hover cannot be
       * reached by touch at all.
       */
      const mark = hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(note.id)}
          aria-label={open ? `Collapse ${note.title}` : `Expand ${note.title}`}
          aria-expanded={open}
          className={`${sidebarGutter} text-mute transition-colors hover:text-text ${focusRing}`}
        >
          <svg
            viewBox="0 0 16 16"
            className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
      ) : (
        <span aria-hidden="true" className={sidebarGutter}>
          <svg
            viewBox="0 0 16 16"
            className={`h-3.5 w-3.5 ${active ? "text-note" : "text-mute/70"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4.25 2.75h4.5l3 3v7.5a.75.75 0 0 1-.75.75h-6.75a.75.75 0 0 1-.75-.75V3.5a.75.75 0 0 1 .75-.75Z" />
            <path d="M8.5 2.9v3h3" />
          </svg>
        </span>
      );

      return (
        <li key={note.id}>
          <div
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_TYPE, note.id);
              event.dataTransfer.effectAllowed = "move";
              setDragging(note.id);
              setBlocked(blockedDropIds(note.id));
            }}
            onDragEnd={endDrag}
            onDragOver={(event) => {
              if (!droppable) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (over !== note.id) setOver(note.id);
            }}
            onDragLeave={() => setOver((current) => (current === note.id ? null : current))}
            onDrop={(event) => {
              if (!droppable) return;
              event.preventDefault();
              const id = event.dataTransfer.getData(DRAG_TYPE);
              endDrag();
              if (id) onMove(id, note.id);
            }}
            onContextMenu={(event) => menu.open(event, itemsFor(note))}
            style={{ paddingLeft: `calc(0.5rem + ${node.depth * 0.75}rem)` }}
            className={`list-row tree-row group -mx-2 flex items-center rounded-lg pr-2 transition-colors ${
              active ? "bg-surface" : "hover:bg-surface/40"
            } ${over === note.id ? "ring-1 ring-accent-ring" : ""}`}
          >
            {mark}

            <button
              type="button"
              onClick={() => onSelect(note)}
              aria-current={active ? "true" : undefined}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-2 pl-2.5 text-left text-xs transition-colors ${
                active ? "font-medium text-text" : "text-mute"
              } ${focusRing}`}
            >
              <span className="min-w-0 truncate">{note.title.trim() || "Untitled note"}</span>
            </button>

            <span className="list-row-slot relative flex h-7 shrink-0 items-center justify-end">
              <span className="list-row-actions absolute inset-0 flex items-center justify-end gap-0.5">
                <button
                  type="button"
                  onClick={() => onAddChild(note.id)}
                  title="Add a note inside"
                  aria-label={`Add a note inside ${note.title}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated hover:text-text ${focusRing}`}
                >
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M8 3.5v9M3.5 8h9" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(note)}
                  title="Delete note"
                  aria-label={`Delete ${note.title}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated hover:text-danger ${focusRing}`}
                >
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 4.5h10M6.5 4.5V3.2h3V4.5M4.5 4.5 5 13h6l.5-8.5" />
                  </svg>
                </button>
              </span>
            </span>
          </div>
          {hasChildren && open ? <ul>{rows(node.children)}</ul> : null}
        </li>
      );
    });
  }

  const rootDroppable = dragging !== null;

  return (
    // No scroller of its own: the tree sits inside the notebook list now, and
    // the sidebar is what scrolls.
    <div>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      <ul>{rows(tree)}</ul>
      {/* Dropping below the tree is how a nested note gets back to the top level.
          Rendered only while dragging, or it reserves a band of empty space. */}
      {rootDroppable ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (over !== "__root__") setOver("__root__");
          }}
          onDragLeave={() => setOver((current) => (current === "__root__" ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData(DRAG_TYPE);
            endDrag();
            if (id) onMove(id, null);
          }}
          className={`mt-1 rounded-lg border border-dashed px-3 py-1.5 text-center text-[10px] transition-colors ${
            over === "__root__" ? "border-accent-dim text-text" : "border-line text-mute"
          }`}
        >
          Move to top level
        </div>
      ) : null}
    </div>
  );
}
