import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { focusRing, sidebarMark, sidebarNameInput, sidebarRowAction, sidebarRowState, sidebarRow } from "../lib/styles";
import { ColourPalette, type PaletteState } from "./ColourPalette";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { Icon } from "./Icon";

/** Anything with a name that groups other objects: an address book, a notebook. */
export type Container = { id: string; name: string };

type Props<T extends Container> = {
  items: T[];
  selectedId: string;
  /** Id standing for "no filter", e.g. `ALL_ADDRESS_BOOKS`. */
  allId: string;
  allLabel: string;
  /** The reserved default, which has no delete action. */
  protectedId: string;
  /** Lower case, for titles and labels: "address book", "notebook". */
  kindLabel: string;
  /** Set once the sidebar's own "+" is pressed; cleared through `onCreateHandled`. */
  creating: boolean;
  onCreateHandled: () => void;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<unknown> | void;
  onRename: (id: string, name: string) => Promise<unknown> | void;
  onDelete: (item: T) => void;
  /** Adds an archive action to every row but the protected one. */
  onArchive?: (item: T) => void;
  /** A row's colour, which tints its visibility tick. */
  tone?: (item: T) => string;
  /** Adds a colour choice to every row's context menu. */
  onRecolor?: (item: T, color: string) => Promise<unknown> | void;
  /** Leading mark for a row; the book icon when not given. */
  renderIcon?: (item: T) => ReactNode;
  /**
   * Drawn in the row's trailing slot at rest, giving way to the actions on
   * hover. A note count here is what tells a reader a container has contents.
   */
  renderMeta?: (item: T) => ReactNode;
  /**
   * Drawn directly beneath a row, inside the list. Lets a caller nest a
   * container's own contents under it, so the two read as one thing rather than
   * as two lists that happen to sit near each other.
   */
  renderUnder?: (item: T) => ReactNode;
  /** False where the caller already offers the unfiltered row of its own. */
  showAll?: boolean;
  /**
   * Given together with `onToggleVisible`, rows become visibility checkboxes
   * rather than a single-selection filter, mirroring the calendar list. The
   * "all" row then has nothing to select, so it gives way to "Show all".
   */
  isVisible?: (item: T) => boolean;
  onToggleVisible?: (id: string) => void;
  onShowAll?: () => void;
  readOnly?: boolean;
  busy?: boolean;
};

/**
 * The visibility tick: filled in the accent when the container is showing, a
 * hollow square when it is hidden. Takes the leading slot the icon holds in
 * selection mode, so a row carries one mark rather than two.
 */
export function VisibilityBox({ shown, tone }: { shown: boolean; tone?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md border-2 transition-colors duration-150 ${shown ? "border-accent bg-accent" : "border-line-light"}`}
      style={tone ? (shown ? { borderColor: tone, backgroundColor: tone } : { borderColor: tone }) : undefined}
    >
      {shown ? (
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke="var(--color-bg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m1.5 5.2 2.2 2.2L8.5 2.6" />
        </svg>
      ) : null}
    </span>
  );
}

/**
 * Containers as a sidebar list, mirroring the calendar list: a quiet row at rest,
 * with rename and delete taking the trailing slot on hover or keyboard focus.
 *
 * Rows are single selection by default, the "all" row plus one container, so they
 * read as a filter. Given `isVisible` and `onToggleVisible` they become
 * visibility checkboxes instead, as the calendar list has them.
 */
export function ContainerList<T extends Container>({
  items,
  selectedId,
  allId,
  allLabel,
  protectedId,
  kindLabel,
  creating,
  onCreateHandled,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onArchive,
  tone,
  onRecolor,
  renderIcon,
  renderMeta,
  renderUnder,
  showAll = true,
  isVisible,
  onToggleVisible,
  onShowAll,
  readOnly = false,
  busy = false,
}: Props<T>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const committing = useRef(false);

  useEffect(() => {
    if (creating) setDraft("");
  }, [creating]);

  useEffect(() => {
    if (creating || editingId) inputRef.current?.focus();
  }, [creating, editingId]);

  function cancel() {
    setEditingId(null);
    setDraft("");
    onCreateHandled();
  }

  async function commit() {
    if (committing.current) return;
    const name = draft.trim();
    if (!name) {
      cancel();
      return;
    }
    committing.current = true;
    try {
      if (editingId) {
        await onRename(editingId, name);
      } else {
        await onCreate(name);
      }
      cancel();
    } finally {
      committing.current = false;
    }
  }

  function startRename(book: T) {
    onCreateHandled();
    setEditingId(book.id);
    setDraft(book.name);
  }

  const menu = useContextMenu();
  const [palette, setPalette] = useState<PaletteState>(null);
  const recoloring = useRef<T | null>(null);
  const menuAt = useRef({ x: 0, y: 0 });
  const closePalette = useCallback(() => setPalette(null), []);

  /** The same actions the row's own buttons carry, for the context menu. */
  function itemsFor(book: T): MenuItem[] {
    if (readOnly) return [];
    const actions: MenuItem[] = [
      { label: `Rename ${kindLabel}`, onSelect: () => startRename(book) },
    ];
    if (onRecolor && tone) {
      actions.push({
        label: "Change colour",
        onSelect: () => {
          recoloring.current = book;
          setPalette({ ...menuAt.current, current: tone(book) });
        },
      });
    }
    if (book.id !== protectedId && onArchive) {
      actions.push({
        label: `Archive ${kindLabel}`,
        onSelect: () => onArchive(book),
      });
    }
    if (book.id !== protectedId) {
      actions.push({
        label: `Delete ${kindLabel}`,
        danger: true,
        onSelect: () => onDelete(book),
      });
    }
    return actions;
  }

  const rowBase = `list-row group -mx-2 flex items-center rounded-lg pr-2 transition-colors`;
  // Both callbacks are needed for a row to work as a checkbox, so one without
  // the other leaves the list in selection mode rather than half in each.
  const toggling = Boolean(isVisible && onToggleVisible);
  const anyHidden = toggling && items.some((item) => !isVisible!(item));

  return (
    <div className="mt-2.5 space-y-0.5">
      <ContextMenu state={menu.menu} onClose={menu.close} />
      {onRecolor && tone && !readOnly ? (
        <ColourPalette
          state={palette}
          label={`${kindLabel.charAt(0).toUpperCase()}${kindLabel.slice(1)} colour`}
          onPick={(hex) => {
            const target = recoloring.current;
            if (target) void onRecolor(target, hex);
          }}
          onClose={closePalette}
        />
      ) : null}
      {showAll && !toggling ? (
        <button
          type="button"
          onClick={() => onSelect(allId)}
          aria-current={selectedId === allId ? "true" : undefined}
          className={`${sidebarRow} ${focusRing} ${sidebarRowState(selectedId === allId)}`}
        >
          <span className={sidebarMark}><Icon name="book" /></span>
          <span className="min-w-0 flex-1 truncate font-medium">{allLabel}</span>
        </button>
      ) : null}

      {items.map((book) => {
        const selected = selectedId === book.id;
        if (editingId === book.id) {
          return (
            <form
              key={book.id}
              onSubmit={(event) => { event.preventDefault(); void commit(); }}
              autoComplete="off"
              className="-mx-2 px-2 py-1"
            >
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => void commit()}
                onKeyDown={(event) => { if (event.key === "Escape") cancel(); }}
                disabled={busy}
                aria-label={`Rename ${book.name}`}
                className={sidebarNameInput}
              />
            </form>
          );
        }
        const under = renderUnder?.(book);
        const shown = toggling ? isVisible!(book) : true;
        return (
          <div key={book.id}>
          <div
            className={`${rowBase} ${selected && !toggling ? "bg-accent-soft" : "hover:bg-hover"}`}
            onContextMenu={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              menuAt.current =
                event.clientX === 0 && event.clientY === 0
                  ? { x: box.left, y: box.bottom }
                  : { x: event.clientX, y: event.clientY };
              menu.open(event, itemsFor(book));
            }}
          >
            <button
              type="button"
              onClick={() => (toggling ? onToggleVisible!(book.id) : onSelect(book.id))}
              aria-pressed={toggling ? shown : undefined}
              aria-current={!toggling && selected ? "true" : undefined}
              title={toggling ? `${shown ? "Hide" : "Show"} ${book.name}` : undefined}
              className={`flex min-w-0 flex-1 items-center gap-2.5 h-8 rounded-lg px-2 text-left text-sm font-medium transition-colors ${focusRing} ${(toggling ? shown : selected) ? "text-text" : "text-mute hover:text-text"}`}
            >
              <span className={sidebarMark}>
                {toggling ? <VisibilityBox shown={shown} tone={tone?.(book)} /> : renderIcon ? renderIcon(book) : <Icon name="book" />}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{book.name}</span>
            </button>

            {readOnly && !renderMeta ? null : (
              <span className={`relative flex h-7 shrink-0 items-center justify-end ${readOnly ? "w-4" : "list-row-slot"}`}>
                {renderMeta ? (
                  <span className="list-row-rest absolute inset-0 flex items-center justify-end pr-1 text-2xs tabular-nums text-mute/70">
                    {renderMeta(book)}
                  </span>
                ) : null}
                {readOnly ? null : (
                <span className="list-row-actions absolute inset-0 flex items-center justify-end gap-0.5">
                  <button
                    type="button"
                    onClick={() => startRename(book)}
                    title={`Rename ${kindLabel}`}
                    aria-label={`Rename ${book.name}`}
                    className={`${sidebarRowAction} hover:text-text`}
                  >
                    <Icon name="pencil" />
                  </button>
                  {book.id === protectedId || !onArchive ? null : (
                    <button
                      type="button"
                      onClick={() => onArchive(book)}
                      title={`Archive ${kindLabel}`}
                      aria-label={`Archive ${book.name}`}
                      className={`${sidebarRowAction} hover:text-text`}
                    >
                      <Icon name="archive" />
                    </button>
                  )}
                  {book.id === protectedId ? null : (
                    <button
                      type="button"
                      onClick={() => onDelete(book)}
                      title={`Delete ${kindLabel}`}
                      aria-label={`Delete ${book.name}`}
                      className={`${sidebarRowAction} hover:text-danger`}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </span>
                )}
              </span>
            )}
          </div>
          {under}
          </div>
        );
      })}

      {creating && !readOnly ? (
        <form onSubmit={(event) => { event.preventDefault(); void commit(); }} autoComplete="off" className="-mx-2 px-2 py-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => { if (event.key === "Escape") cancel(); }}
            placeholder={`${kindLabel} name`}
            disabled={busy}
            aria-label={`New ${kindLabel} name`}
            className={sidebarNameInput}
          />
        </form>
      ) : null}

      {anyHidden ? (
        <button
          type="button"
          onClick={onShowAll}
          className={`-ml-2 mt-2.5 rounded-md px-2 py-1 text-2xs text-mute transition-colors hover:text-accent ${focusRing}`}
        >
          Show all {kindLabel}s
        </button>
      ) : null}
    </div>
  );
}
