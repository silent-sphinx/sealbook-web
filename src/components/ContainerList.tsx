import { useEffect, useRef, useState, type ReactNode } from "react";
import { focusRing } from "../lib/styles";

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
  /** Leading mark for a row; the book icon when not given. */
  renderIcon?: (item: T) => ReactNode;
  /** False where the caller already offers the unfiltered row of its own. */
  showAll?: boolean;
  readOnly?: boolean;
  busy?: boolean;
};

function BookIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 2.75h7.5a1.75 1.75 0 0 1 1.75 1.75v8.75H4.75A1.75 1.75 0 0 1 3 11.5V2.75Z" />
      <path d="M3 11.5a1.75 1.75 0 0 1 1.75-1.75h7.5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m10.75 2.75 2.5 2.5M3 13l1.5-3.75 6.25-6.25a1.77 1.77 0 0 1 2.5 2.5L7 11.75 3 13Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.75 4.25h10.5M6.25 4.25V3a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25M4.25 4.25 4.75 13a.75.75 0 0 0 .75.7h5a.75.75 0 0 0 .75-.7l.5-8.75" />
    </svg>
  );
}

/**
 * Containers as a sidebar list, mirroring the calendar list: a quiet row at rest,
 * with rename and delete taking the trailing slot on hover or keyboard focus.
 * Selection is single, the "all" row plus one container, so rows read as a filter
 * rather than as checkboxes.
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
  renderIcon,
  showAll = true,
  readOnly = false,
  busy = false,
}: Props<T>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
    const name = draft.trim();
    if (!name) {
      cancel();
      return;
    }
    if (editingId) {
      await onRename(editingId, name);
    } else {
      await onCreate(name);
    }
    cancel();
  }

  function startRename(book: T) {
    onCreateHandled();
    setEditingId(book.id);
    setDraft(book.name);
  }

  const rowBase = `list-row group -mx-2 flex items-center rounded-lg pr-2 transition-colors`;

  return (
    <div className="mt-2.5 space-y-0.5">
      {showAll ? (
        <button
          type="button"
          onClick={() => onSelect(allId)}
          aria-current={selectedId === allId ? "true" : undefined}
          className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${focusRing} ${selectedId === allId ? "bg-surface text-text" : "text-mute hover:bg-surface/40 hover:text-text"}`}
        >
          <BookIcon />
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
                className="h-8 w-full rounded-lg border border-accent-dim bg-bg px-2 text-xs text-text outline-none ring-1 ring-accent-ring"
              />
            </form>
          );
        }
        return (
          <div key={book.id} className={`${rowBase} ${selected ? "bg-surface" : "hover:bg-surface/40"}`}>
            <button
              type="button"
              onClick={() => onSelect(book.id)}
              aria-current={selected ? "true" : undefined}
              className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${focusRing} ${selected ? "text-text" : "text-mute"}`}
            >
              {renderIcon ? renderIcon(book) : <BookIcon />}
              <span className="min-w-0 flex-1 truncate font-medium">{book.name}</span>
            </button>

            {readOnly ? null : (
              <span className="relative flex h-7 w-[50px] shrink-0 items-center justify-end">
                <span className="list-row-actions absolute inset-0 flex items-center justify-end gap-0.5">
                  <button
                    type="button"
                    onClick={() => startRename(book)}
                    title={`Rename ${kindLabel}`}
                    aria-label={`Rename ${book.name}`}
                    className={`flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated hover:text-text ${focusRing}`}
                  >
                    <PencilIcon />
                  </button>
                  {book.id === protectedId ? null : (
                    <button
                      type="button"
                      onClick={() => onDelete(book)}
                      title={`Delete ${kindLabel}`}
                      aria-label={`Delete ${book.name}`}
                      className={`flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated hover:text-danger ${focusRing}`}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </span>
              </span>
            )}
          </div>
        );
      })}

      {creating && !readOnly ? (
        <form onSubmit={(event) => { event.preventDefault(); void commit(); }} className="-mx-2 px-2 py-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => { if (event.key === "Escape") cancel(); }}
            placeholder={`${kindLabel} name`}
            disabled={busy}
            aria-label={`New ${kindLabel} name`}
            className="h-8 w-full rounded-lg border border-accent-dim bg-bg px-2 text-xs text-text outline-none ring-1 ring-accent-ring placeholder:text-mute/60"
          />
        </form>
      ) : null}
    </div>
  );
}
