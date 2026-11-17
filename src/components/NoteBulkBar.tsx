import { btnHeader, checkbox } from "../lib/styles";
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
  onMove: (notebookId: string) => void;
  onDelete: () => void;
};

/** The strip under a notes pane's header while notes are selected. */
export function NoteBulkBar({ selected, total, notebooks, onToggleAll, onMove, onDelete }: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk edit notes"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-panel/60 px-4 py-2 lg:px-6"
    >
      <input
        type="checkbox"
        ref={(node) => {
          if (node) node.indeterminate = selected > 0 && selected < total;
        }}
        checked={total > 0 && selected === total}
        onChange={onToggleAll}
        aria-label="Select all notes"
        className={checkbox}
      />
      <span className="min-w-0 flex-1 text-xs text-mute" aria-live="polite">
        {selected} selected
      </span>
      <select
        aria-label="Move selected notes to"
        value=""
        onChange={(event) => {
          if (event.target.value) onMove(event.target.value);
        }}
        className="box-border h-8 shrink-0 cursor-pointer rounded-lg border border-line bg-surface py-0 pl-3 pr-8 text-xs font-medium leading-none text-mute outline-none focus:border-accent-dim"
      >
        <option value="">Move to…</option>
        {notebooks.map((notebook) => (
          <option key={notebook.id} value={notebook.id}>
            {notebook.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={onDelete} className={`${btnHeader} box-border hover:text-danger`}>
        <Icon name="trash" className="h-3.5 w-3.5" />
        Delete
      </button>
    </div>
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
