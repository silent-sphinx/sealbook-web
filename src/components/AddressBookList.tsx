import { ALL_ADDRESS_BOOKS, DEFAULT_ADDRESS_BOOK_ID } from "../lib/addressBook";
import { ContainerList } from "./ContainerList";
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
  onDelete: (book: AddressBook) => void;
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
      {...rest}
    />
  );
}
