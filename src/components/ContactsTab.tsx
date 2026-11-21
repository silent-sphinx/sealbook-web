import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { SidebarDrawer, SidebarHeader, SidebarSection, useSidebar } from "./SidebarDrawer";
import { SplitHandle, useSplitPane } from "./SplitPane";
import { AddressBookList, ArchivedAddressBooks } from "./AddressBookList";
import { ContactCard, ContactListSkeleton } from "./ContactCard";
import { ContactDetailModal } from "./ContactDetailModal";
import { ContactNetworkMap } from "./ContactNetworkMap";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import {
  ARCHIVE_VIEW_NAME,
  activeAddressBooks,
  archivedAddressBooks,
  bookNameById,
  bookToneById,
  isAddressBookVisible,
  resolveAddressBookId,
} from "../lib/addressBook";
import {
  btnPrimarySm,
  btnPrimary,
  focusRing,
  ghost,
  searchClear,
  searchField,
  searchIcon,
  sidebarCount,
  sidebarMark,
  sidebarRowState,
  sidebarSectionAction,
  sidebarSubgroup,
  viewMain,
  viewGrid,
  sidebarRow,
} from "../lib/styles";
import type { Session } from "../lib/client";
import type { LinkableSection } from "../lib/contactProfile";
import type { ContactBulkChange } from "../lib/contactBulk";
import { useItemSelection } from "../lib/useItemSelection";
import type { AddressBook, Contact, ContactDraft } from "../lib/types";
import { Icon } from "./Icon";
import { PaneHeader, BulkBar } from "./PaneControls";
import { Banner } from "./Banner";
import { TrashPanel, TrashRow, trashRootsFor } from "./Trash";
import type { TrashListing } from "../lib/trash";
import { EmptyState } from "./EmptyState";

interface ContactsTabProps {
  session: Session;
  isOffline: boolean;
  sidebar: ReturnType<typeof useSidebar>;
  contactsSplit: ReturnType<typeof useSplitPane>;
  contacts: Contact[];
  filtered: Contact[];
  addressBooks: AddressBook[];
  hiddenBooks: Set<string>;
  shownArchivedBooks: Set<string>;
  archivedContacts: Contact[];
  viewingContact: Contact | null;
  editingDetail: boolean;
  creatingBook: boolean;
  loadingVault: boolean;
  error: string | null;
  busy: boolean;
  search: string;
  soleShownBook: AddressBook | null;
  listTitle: string;
  viewingArchive: boolean;
  trash: TrashListing;
  viewingTrash: boolean;
  onSetViewingTrash: (value: boolean) => void;
  onTrashChanged: () => Promise<unknown>;
  detailedContacts: boolean;
  composing: boolean;
  deletingContact: Contact | null;
  deletingAddressBook: AddressBook | null;
  onSetCreatingBook: (value: boolean) => void;
  onGoHome: () => void;
  onOpenComposer: () => void;
  onGuardEditing: (action: () => void) => void;
  onToggleBookVisibility: (id: string) => void;
  onShowAllBooks: () => void;
  onCreateBook: (name: string) => Promise<string | undefined>;
  onRenameBook: (id: string, name: string) => Promise<void>;
  onRecolorBook: (book: AddressBook, color: string) => Promise<void>;
  onDeleteBook: (book: AddressBook) => void;
  onToggleBookArchived: (book: AddressBook) => Promise<void>;
  onSetSearch: (value: string) => void;
  onSetViewingContact: (contact: Contact | null) => void;
  onSetError: (error: string | null) => void;
  onSetViewingArchive: (value: boolean) => void;
  onSetEditingDetail: (value: boolean) => void;
  onPromptDelete: (contact: Contact) => void;
  onPromptBulkDelete: (contacts: Contact[]) => void;
  deletingContacts: Contact[] | null;
  onToggleArchive: (contact: Contact) => Promise<void>;
  onBulkEdit: (contacts: Contact[], change: ContactBulkChange) => Promise<void>;
  onSaveViewedContact: (draft: ContactDraft) => Promise<boolean>;
  onLinkInSection?: (section: LinkableSection, targetId: string) => Promise<void>;
  onUnlinkFromSection?: (section: LinkableSection, contactId: string) => Promise<void>;
  onNavigateToContact?: (contact: Contact) => void;
}

export function ContactsTab({
  session,
  isOffline,
  sidebar,
  contactsSplit,
  contacts,
  filtered,
  addressBooks,
  hiddenBooks,
  shownArchivedBooks,
  archivedContacts,
  viewingContact,
  editingDetail,
  creatingBook,
  loadingVault,
  error,
  busy,
  search,
  soleShownBook,
  listTitle,
  viewingArchive,
  trash,
  viewingTrash,
  onSetViewingTrash,
  onTrashChanged,
  detailedContacts,
  composing,
  deletingContact,
  deletingAddressBook,
  onSetCreatingBook,
  onGoHome,
  onOpenComposer,
  onGuardEditing,
  onToggleBookVisibility,
  onShowAllBooks,
  onCreateBook,
  onRenameBook,
  onRecolorBook,
  onDeleteBook,
  onToggleBookArchived,
  onSetSearch,
  onSetViewingContact,
  onSetError,
  onSetViewingArchive,
  onSetEditingDetail,
  onPromptDelete,
  onPromptBulkDelete,
  deletingContacts,
  onToggleArchive,
  onBulkEdit,
  onSaveViewedContact,
  onLinkInSection,
  onUnlinkFromSection,
  onNavigateToContact,
}: ContactsTabProps) {
  // The map mirrors the list's book filter, so hiding a book also drops its
  // contacts and their links from the network.
  const networkContacts = useMemo(
    () =>
      contacts.filter(
        (contact) => !hiddenBooks.has(resolveAddressBookId(contact.addressBookId)),
      ),
    [contacts, hiddenBooks],
  );

  const menu = useContextMenu();
  const trashCount = useMemo(() => trashRootsFor(trash, "contacts").length, [trash]);

  const selection = useItemSelection(filtered);
  const { selected: checkedIds, selectedItems: checkedContacts, selecting, clear: endSelecting } = selection;
  const movableBooks = useMemo(() => activeAddressBooks(addressBooks), [addressBooks]);

  async function runBulk(change: ContactBulkChange) {
    const targets = checkedContacts;
    endSelecting();
    await onBulkEdit(targets, change);
  }

  /** The actions on the whole selection. Moving has its own dropdown in the bar. */
  /** What the selection offers beyond Move and Delete, which the bar draws as their own controls. */
  function bulkMoreItems(): MenuItem[] {
    const count = `${checkedIds.size} contact${checkedIds.size === 1 ? "" : "s"}`;
    return [
      {
        label: viewingArchive ? `Restore ${count} from archive` : `Archive ${count}`,
        onSelect: () =>
          onGuardEditing(() => void runBulk({ kind: viewingArchive ? "restore" : "archive" })),
      },
    ];
  }

  function bulkDelete() {
    onGuardEditing(() => {
      const targets = checkedContacts;
      endSelecting();
      onPromptBulkDelete(targets);
    });
  }

  function bulkItems(): MenuItem[] {
    const count = `${checkedIds.size} contact${checkedIds.size === 1 ? "" : "s"}`;
    return [...bulkMoreItems(), { label: `Delete ${count}`, danger: true, onSelect: bulkDelete }];
  }

  /** The detail pane's own actions, reachable from the row itself. */
  function itemsFor(contact: Contact): MenuItem[] {
    return [
      {
        label: "Edit contact",
        onSelect: () =>
          onGuardEditing(() => {
            onSetError(null);
            onSetViewingContact(contact);
            onSetEditingDetail(true);
          }),
      },
      {
        label: contact.archived ? "Restore from archive" : "Archive contact",
        onSelect: () => onGuardEditing(() => void onToggleArchive(contact)),
      },
      {
        label: "Delete contact",
        danger: true,
        onSelect: () => onGuardEditing(() => onPromptDelete(contact)),
      },
    ];
  }

  function openRowMenu(event: ReactMouseEvent, contact: Contact) {
    menu.open(
      event,
      checkedIds.has(contact.id) && checkedIds.size > 1 ? bulkItems() : itemsFor(contact),
    );
  }

  return (
    <main className={viewMain}>
      <div className={viewGrid} style={sidebar.cols}>
        <SidebarDrawer title="Contacts and address books" sidebar={sidebar}>
          <SidebarHeader
            title="Contacts"
            onTitleClick={() => {
              sidebar.close();
              onGoHome();
            }}
          />

          <SidebarSection
            label="Address books"
            action={
              <button
                type="button"
                onClick={() => onSetCreatingBook(true)}
                aria-label="Add address book"
                className={sidebarSectionAction}
              >
                <Icon name="plus" className="h-4 w-4" />
              </button>
            }
          >
            <AddressBookList
              books={activeAddressBooks(addressBooks)}
              creating={creatingBook}
              onCreateHandled={() => onSetCreatingBook(false)}
              isVisible={(book) => isAddressBookVisible(book, hiddenBooks)}
              onToggleVisible={(id) => onGuardEditing(() => onToggleBookVisibility(id))}
              onShowAll={() => onGuardEditing(onShowAllBooks)}
              onCreate={onCreateBook}
              onRename={onRenameBook}
              onRecolor={onRecolorBook}
              onDelete={onDeleteBook}
              onArchive={(book) => onGuardEditing(() => void onToggleBookArchived(book))}
              busy={busy}
            />
            <ArchivedAddressBooks
              books={archivedAddressBooks(addressBooks)}
              isVisible={(book) => shownArchivedBooks.has(book.id)}
              onToggleVisible={(id) => onGuardEditing(() => onToggleBookVisibility(id))}
              onRestore={(book) => onGuardEditing(() => void onToggleBookArchived(book))}
              onDelete={onDeleteBook}
            />
            <div className={sidebarSubgroup}>
              <button
                type="button"
                onClick={() => onGuardEditing(() => onSetViewingArchive(!viewingArchive))}
                aria-current={viewingArchive ? "true" : undefined}
                title={viewingArchive ? "Back to the address books" : "Show archived contacts"}
                className={`${sidebarRow} ${focusRing} ${sidebarRowState(viewingArchive)}`}
              >
                <span className={sidebarMark}><Icon name="archive" /></span>
                <span className="min-w-0 flex-1 truncate font-medium">{ARCHIVE_VIEW_NAME}</span>
                <span className={`shrink-0 ${sidebarCount}`}>{archivedContacts.length || ""}</span>
              </button>
            </div>
            <TrashRow
              count={trashCount}
              active={viewingTrash}
              onToggle={() => onGuardEditing(() => onSetViewingTrash(!viewingTrash))}
            />
          </SidebarSection>
        </SidebarDrawer>

        {viewingTrash ? (
          <TrashPanel
            session={session}
            trash={trash}
            tab="contacts"
            sidebar={sidebar}
            liveContacts={contacts}
            onChanged={async () => {
              await onTrashChanged();
            }}
          />
        ) : (
        <section className="order-1 flex min-w-0 flex-col overflow-hidden lg:order-none lg:min-h-0">
          <PaneHeader
            title={listTitle}
            count={filtered.length}
            countLabel={`${filtered.length} contact${filtered.length === 1 ? "" : "s"} shown`}
            compactTitle
            sidebar={sidebar}
          >
              <button
                type="button"
                onClick={onOpenComposer}
                className={btnPrimarySm}
              >
                <Icon name="plus" />
                New contact
              </button>
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Icon name="search" className={searchIcon} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => onSetSearch(e.target.value)}
                  placeholder="Search contacts"
                  aria-label="Search contacts"
                  className={`${searchField} sm:w-52 sm:focus:w-72`}
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => onSetSearch("")}
                    className={searchClear}
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    <Icon name="close" className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
</PaneHeader>

          {selecting ? (
            <BulkBar
              label="Bulk edit contacts"
              noun="contacts"
              selected={checkedIds.size}
              total={filtered.length}
              onToggleAll={selection.toggleAll}
              onClear={endSelecting}
              disabled={busy}
              move={
                viewingArchive
                  ? undefined
                  : {
                      label: "Move selected contacts to",
                      noun: "address book",
                      icon: "book",
                      options: movableBooks,
                      onCreate: onCreateBook,
                      onMove: (addressBookId) =>
                        onGuardEditing(() => void runBulk({ kind: "move", addressBookId })),
                    }
              }
              onDelete={bulkDelete}
              more={bulkMoreItems()}
            />
          ) : null}

          <div
            ref={contactsSplit.containerRef}
            style={contactsSplit.cols}
            className="sb-split grid min-h-0 flex-1"
          >
            <div className={`min-w-0 overflow-y-auto ${viewingContact ? "hidden lg:block" : ""}`}>
              {error && !composing && !deletingContact && !deletingContacts && !deletingAddressBook ? (
                <Banner tone="danger" role="alert">{error}</Banner>
              ) : null}

              {loadingVault && contacts.length === 0 ? (
                <ContactListSkeleton />
              ) : filtered.length === 0 && search.trim() ? (
                <EmptyState
                  title={`No contacts matching "${search}"`}
                  action={
                    <button type="button" className={ghost} onClick={() => onSetSearch("")}>
                      Clear search
                    </button>
                  }
                />
              ) : viewingArchive && filtered.length === 0 ? (
                <EmptyState
                  title="The Archive is empty"
                  body="Archiving a contact takes it out of its address book and puts it here, without deleting anything."
                  action={
                    <button type="button" className={ghost} onClick={() => onSetViewingArchive(false)}>
                      Back to contacts
                    </button>
                  }
                />
              ) : contacts.length === 0 ? (
                <EmptyState
                  title="No contacts yet"
                  body="Everything you add here is encrypted on this device before it reaches the server."
                  action={
                    <button type="button" className={btnPrimary} onClick={onOpenComposer}>
                      <Icon name="plus" />
                      Add your first contact
                    </button>
                  }
                />
              ) : filtered.length === 0 ? (
                <EmptyState
                  title={
                    soleShownBook
                      ? `${soleShownBook.name} has no contacts yet.`
                      : "No contacts in the address books you are showing."
                  }
                  action={
                    <button type="button" className={ghost} onClick={onShowAllBooks}>
                      Show all address books
                    </button>
                  }
                />
              ) : (
                <ul className="min-w-0">
                  {filtered.map((card) => (
                    <ContactCard
                      key={card.id}
                      contact={card}
                      selected={viewingContact?.id === card.id}
                      checked={checkedIds.has(card.id)}
                      onToggleChecked={selection.toggle}
                      bookName={
                        soleShownBook && !viewingArchive
                          ? undefined
                          : bookNameById(addressBooks, card.addressBookId)
                      }
                      bookTone={bookToneById(addressBooks, card.addressBookId)}
                      onSelect={(contact, event) =>
                        selecting || event.ctrlKey || event.metaKey
                          ? selection.toggle(contact, event.shiftKey)
                          : onGuardEditing(() => {
                              onSetError(null);
                              onSetViewingContact(contact);
                            })
                      }
                      onContextMenu={openRowMenu}
                    />
                  ))}
                </ul>
              )}
            </div>

            <SplitHandle split={contactsSplit} label="Resize the contact list" />

            <div className={`min-w-0 flex-col overflow-hidden lg:flex ${viewingContact ? "flex" : "hidden"}`}>
              {viewingContact ? (
                <ContactDetailModal
                  key={viewingContact.id}
                  session={session}
                  contact={viewingContact}
                  bookName={bookNameById(addressBooks, viewingContact.addressBookId)}
                  bookTone={bookToneById(addressBooks, viewingContact.addressBookId)}
                  onDelete={() => onPromptDelete(viewingContact)}
                  onArchive={() => void onToggleArchive(viewingContact)}
                  onClose={() => onGuardEditing(() => onSetViewingContact(null))}
                  editing={editingDetail}
                  onEditingChange={onSetEditingDetail}
                  addressBooks={addressBooks}
                  busy={busy}
                  error={error}
                  onSave={onSaveViewedContact}
                  attachmentsReadOnly={isOffline}
                  detailed={detailedContacts}
                  contacts={contacts}
                  onLinkInSection={onLinkInSection}
                  onUnlinkFromSection={onUnlinkFromSection}
                  onNavigateToContact={onNavigateToContact}
                />
              ) : detailedContacts ? (
                <ContactNetworkMap
                  contacts={networkContacts}
                  onSelectContact={(contact) =>
                    onGuardEditing(() => {
                      onSetError(null);
                      onSetViewingContact(contact);
                    })
                  }
                />
              ) : (
                <div className="hidden min-h-56 flex-1 items-center justify-center px-6 text-center lg:flex">
                  <p className="max-w-xs text-sm leading-relaxed text-mute">
                    Select a contact to view their details.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
        )}
      </div>

      <ContextMenu state={menu.menu} onClose={menu.close} />
    </main>
  );
}
