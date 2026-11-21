import { BulkBar } from "./PaneControls";
import type { ItemSelection } from "../lib/useItemSelection";
import type { Note, Notebook } from "../lib/types";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { Icon } from "./Icon";

type MenuProps = {
  notebooks: Notebook[];
  selection: ItemSelection<Note>;
  onOpen: (note: Note) => void;
  onRename: (note: Note) => void;
  onDelete: (note: Note) => void;
  onMoveNotes: (notes: Note[], notebookId: string) => void;
  onDeleteNotes: (notes: Note[]) => void;
};

/**
 * The right-click menu on a note in a notes pane. On a note inside a selection
 * of several it acts on the whole selection instead.
 */
export function useNoteMenu({ notebooks, selection, onOpen, onRename, onDelete, onMoveNotes, onDeleteNotes }: MenuProps) {
  const menu = useContextMenu();
  function itemsFor(note: Note): MenuItem[] {
    if (selection.isSelected(note.id) && selection.selected.size > 1) {
      const picked = selection.selectedItems;
      const count = `${picked.length} notes`;
      return [
        ...notebooks.map((notebook) => ({
          label: `Move ${count} to ${notebook.name}`,
          onSelect: () => {
            onMoveNotes(picked, notebook.id);
            selection.clear();
          },
        })),
        { label: `Delete ${count}`, danger: true, onSelect: () => onDeleteNotes(picked) },
      ];
    }
    return [
      { label: "Open note", onSelect: () => onOpen(note) },
      { label: "Rename note", onSelect: () => onRename(note) },
      { label: "Delete note", danger: true, onSelect: () => onDelete(note) },
    ];
  }
  return {
    element: <ContextMenu state={menu.menu} onClose={menu.close} />,
    onContextMenu: (event: React.MouseEvent, note: Note) => menu.open(event, itemsFor(note)),
  };
}

type Props = {
  selected: number;
  total: number;
  notebooks: Notebook[];
  onToggleAll: () => void;
  onClear: () => void;
  onMove: (notebookId: string) => void;
  onCreateNotebook: (name: string) => Promise<string | undefined>;
  onDelete: () => void;
};

/** The strip under a notes pane's header while notes are selected. */
export function NoteBulkBar({ selected, total, notebooks, onToggleAll, onClear, onMove, onCreateNotebook, onDelete }: Props) {
  return (
    <BulkBar
      label="Bulk edit notes"
      noun="notes"
      selected={selected}
      total={total}
      onToggleAll={onToggleAll}
      onClear={onClear}
      move={{ label: "Move selected notes to", noun: "notebook", icon: "book", options: notebooks, onCreate: onCreateNotebook, onMove }}
      onDelete={onDelete}
    />
  );
}

/** The round tick that selects one note, shown on hover or focus and always once selecting. */
export function NotePick({
  title,
  selecting,
  picked,
  onClick,
  className = "",
}: {
  title: string;
  selecting: boolean;
  picked: boolean;
  onClick: (event: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={picked}
      aria-label={`Select ${title}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-opacity focus-visible:opacity-100 pointer-coarse:opacity-100 ${
        picked
          ? "border-accent bg-accent text-bg"
          : `border-mute/60 bg-bg/80 text-transparent hover:border-accent ${selecting ? "" : "opacity-0 group-hover:opacity-100"}`
      } ${className}`}
    >
      <Icon name="check" className="h-2.5 w-2.5" />
    </button>
  );
}
