import type { NoteTreeNode } from "../lib/noteTree";
import type { TreeNode } from "../lib/tree";
import type { Note } from "../lib/types";
import { SidebarTree } from "./SidebarTree";
import { Icon } from "./Icon";

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
  return <Icon name="page" className={`h-3.5 w-3.5 ${active ? "text-accent" : "text-faint"}`} />;
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
          icon: "plus",
          onSelect: () => onAddChild(note.id),
        },
        {
          label: "Delete note",
          ariaLabel: `Delete ${note.title}`,
          icon: "trash",
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
