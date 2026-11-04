import type { NoteTreeNode } from "../lib/noteTree";
import type { TreeNode } from "../lib/tree";
import type { Note } from "../lib/types";
import { PlusMark, SidebarTree, TrashMark } from "./SidebarTree";

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

function asTreeNode(node: NoteTreeNode): TreeNode<Note> {
  return { item: node.note, depth: node.depth, children: node.children.map(asTreeNode) };
}

export function PageMark({ active }: { active: boolean }) {
  return (
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
  );
}

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
  return (
    <SidebarTree
      nodes={tree.map(asTreeNode)}
      label={(note) => note.title.trim() || "Untitled note"}
      selectedId={selectedId}
      expanded={expanded}
      onToggle={onToggle}
      onSelect={onSelect}
      mark={(_, active) => <PageMark active={active} />}
      actions={(note) => [
        {
          label: "Add a note inside",
          ariaLabel: `Add a note inside ${note.title}`,
          icon: <PlusMark />,
          onSelect: () => onAddChild(note.id),
        },
        {
          label: "Delete note",
          ariaLabel: `Delete ${note.title}`,
          icon: <TrashMark />,
          danger: true,
          onSelect: () => onDelete(note),
        },
      ]}
      blockedDropIds={blockedDropIds}
      onMove={onMove}
      dragType="application/x-sealbook-note"
    />
  );
}
