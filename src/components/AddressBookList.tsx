import { useState } from "react";
import { addressBookTone, ALL_ADDRESS_BOOKS, DEFAULT_ADDRESS_BOOK_ID } from "../lib/addressBook";
import { ContainerList, VisibilityBox } from "./ContainerList";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { focusRing, sidebarCount, sidebarMark, sidebarRowState, sidebarSubgroup, sidebarRow } from "../lib/styles";
import type { AddressBook } from "../lib/types";

type Props = {
  books: AddressBook[];
  /** Unused in visibility mode, where no row is a filter. */
  selectedId?: string;
  /** Set once the sidebar's own "+" is pressed; cleared through `onCreateHandled`. */
  creating: boolean;
  onCreateHandled: () => void;
  onSelect?: (id: string) => void;
  onCreate: (name: string) => Promise<unknown> | void;
  onRename: (id: string, name: string) => Promise<unknown> | void;
  onRecolor?: (book: AddressBook, color: string) => Promise<unknown> | void;
  onDelete: (book: AddressBook) => void;
  onArchive?: (book: AddressBook) => void;
  /** Given together with `onToggleVisible`, rows tick visibility on and off. */
  isVisible?: (book: AddressBook) => boolean;
  onToggleVisible?: (id: string) => void;
  onShowAll?: () => void;
  readOnly?: boolean;
  busy?: boolean;
};

/** The shared container list, labelled for contacts. Notebooks use the same one. */
export function AddressBookList({ books, selectedId, onSelect, ...rest }: Props) {
  return (
    <ContainerList
      items={books}
      selectedId={selectedId ?? ALL_ADDRESS_BOOKS}
      onSelect={onSelect ?? (() => undefined)}
      allId={ALL_ADDRESS_BOOKS}
      allLabel="All contacts"
      protectedId={DEFAULT_ADDRESS_BOOK_ID}
      kindLabel="address book"
      tone={addressBookTone}
      {...rest}
    />
  );
}

type ArchivedProps = {
  books: AddressBook[];
  isVisible: (book: AddressBook) => boolean;
  onToggleVisible: (id: string) => void;
  onRestore: (book: AddressBook) => void;
  onDelete: (book: AddressBook) => void;
  readOnly?: boolean;
};

/** Archived books, collapsed under the live ones as the calendar list has them. */
export function ArchivedAddressBooks({ books, isVisible, onToggleVisible, onRestore, onDelete, readOnly = false }: ArchivedProps) {
  const [open, setOpen] = useState(false);
  const menu = useContextMenu();
  if (books.length === 0) return null;
  return (
    <div className={sidebarSubgroup}>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`${sidebarRow} ${sidebarRowState(false)} ${focusRing}`}
      >
        <span className={sidebarMark}><Icon name="chevron" className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} /></span>
        <span className="min-w-0 flex-1 truncate font-medium">Archived address books</span>
        <span className={`shrink-0 ${sidebarCount}`}>{books.length}</span>
      </button>
      {open ? (
        <div className="mt-0.5 space-y-0.5">
          {books.map((book) => {
            const shown = isVisible(book);
            return (
              <div
                key={book.id}
                className="group -mx-2 flex items-center rounded-lg pr-2 transition-colors hover:bg-surface/40"
                onContextMenu={(event) => menu.open(event, readOnly ? [] : [
                  { label: "Restore address book", onSelect: () => onRestore(book) },
                  { label: "Delete address book", danger: true, onSelect: () => onDelete(book) },
                ])}
              >
                <button
                  type="button"
                  onClick={() => onToggleVisible(book.id)}
                  aria-pressed={shown}
                  title={`${shown ? "Hide" : "Show"} ${book.name}`}
                  className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${focusRing}`}
                >
                  <span className={sidebarMark}><VisibilityBox shown={shown} tone={addressBookTone(book)} /></span>
                  <span className={`min-w-0 flex-1 truncate font-medium ${shown ? "text-text" : "text-mute"}`}>{book.name}</span>
                </button>
                {readOnly ? null : (
                  <button
                    type="button"
                    onClick={() => onRestore(book)}
                    title="Restore address book"
                    aria-label={`Restore ${book.name} address book`}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-accent transition-colors hover:bg-elevated ${focusRing}`}
                  >
                    <Icon name="unarchive" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
