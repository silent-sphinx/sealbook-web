import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { SidebarDrawer, SidebarHeader, SidebarSection, useSidebar } from "./SidebarDrawer";
import { SplitHandle, useSplitPane } from "./SplitPane";
import { AddressBookList, ArchivedAddressBooks } from "./AddressBookList";
import { ContactCard, ContactListSkeleton } from "./ContactCard";
import { ContactDetailModal } from "./ContactDetailModal";
import { ContactNetworkMap } from "./ContactNetworkMap";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { ArchiveIcon, PlusIcon, SearchIcon, ClearIcon } from "./AppIcons";
import {
  ARCHIVE_VIEW_NAME,
  activeAddressBooks,
  archivedAddressBooks,
  bookNameById,
  isAddressBookVisible,
  resolveAddressBookId,
} from "../lib/addressBook";
import {
  btnPrimary,
  focusRing,
  ghost,
  sidebarCount,
  sidebarHeaderAction,
  sidebarMark,
  sidebarRowState,
  sidebarSectionAction,
  sidebarSubgroup,
} from "../lib/styles";
import type { Session } from "../lib/client";
import type { LinkableSection } from "../lib/contactProfile";
import type { AddressBook, Contact, ContactDraft } from "../lib/types";

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
  detailedContacts: boolean;
  composing: boolean;
  deletingContact: Contact | null;
  deletingAddressBook: AddressBook | null;
  onSetCreatingBook: (value: boolean) => void;
  onOpenComposer: () => void;
  onGuardEditing: (action: () => void) => void;
  onToggleBookVisibility: (id: string) => void;
  onShowAllBooks: () => void;
  onCreateBook: (name: string) => Promise<string | undefined>;
  onRenameBook: (id: string, name: string) => Promise<void>;
  onDeleteBook: (book: AddressBook) => void;
  onToggleBookArchived: (book: AddressBook) => Promise<void>;
  onSetSearch: (value: string) => void;
  onSetViewingContact: (contact: Contact | null) => void;
  onSetError: (error: string | null) => void;
  onSetViewingArchive: (value: boolean) => void;
  onSetEditingDetail: (value: boolean) => void;
  onPromptDelete: (contact: Contact) => void;
  onToggleArchive: (contact: Contact) => Promise<void>;
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
  detailedContacts,
  composing,
  deletingContact,
  deletingAddressBook,
  onSetCreatingBook,
  onOpenComposer,
  onGuardEditing,
  onToggleBookVisibility,
  onShowAllBooks,
  onCreateBook,
  onRenameBook,
  onDeleteBook,
  onToggleBookArchived,
  onSetSearch,
  onSetViewingContact,
  onSetError,
  onSetViewingArchive,
  onSetEditingDetail,
  onPromptDelete,
  onToggleArchive,
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
    menu.open(event, itemsFor(contact));
  }

  return (
    <main className="flex flex-col bg-bg pb-[env(safe-area-inset-bottom)] text-text lg:h-[calc(100dvh-var(--sb-header-h,74px))] lg:overflow-hidden lg:pb-0">
      <div className="sb-shell grid min-h-0 flex-1 lg:h-full" style={sidebar.cols}>
        <SidebarDrawer title="Contacts and address books" sidebar={sidebar}>
          <SidebarHeader
            eyebrow="My contacts"
            title="Contacts"
            action={
              <button
                type="button"
                onClick={onOpenComposer}
                aria-label="Add contact"
                className={sidebarHeaderAction}
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            }
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
                <PlusIcon className="h-4 w-4" />
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
                className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${focusRing} ${sidebarRowState(viewingArchive)}`}
              >
                <span className={sidebarMark}><ArchiveIcon /></span>
                <span className="min-w-0 flex-1 truncate font-medium">{ARCHIVE_VIEW_NAME}</span>
                <span className={`shrink-0 ${sidebarCount}`}>{archivedContacts.length || ""}</span>
              </button>
            </div>
          </SidebarSection>
        </SidebarDrawer>

        <section className="order-1 flex min-w-0 flex-col overflow-hidden lg:order-none lg:min-h-0">
          <header className="flex flex-col gap-2.5 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-3.5 lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-tight">
                {listTitle}
              </h1>
              <span
                className="ml-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-mute"
                title={`${filtered.length} contact${filtered.length === 1 ? "" : "s"} shown`}
              >
                {filtered.length}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onOpenComposer}
                className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] ${focusRing}`}
              >
                <PlusIcon />
                New contact
              </button>
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <SearchIcon />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => onSetSearch(e.target.value)}
                  placeholder="Search contacts"
                  aria-label="Search contacts"
                  className="h-8 w-full rounded-xl border border-line bg-panel pl-8 pr-7 text-xs text-text outline-none transition-colors duration-150 placeholder:text-mute/60 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring sm:w-52"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => onSetSearch("")}
                    className={`absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    <ClearIcon />
                  </button>
                ) : null}
              </div>
            </div>
          </header>

          <div
            ref={contactsSplit.containerRef}
            style={contactsSplit.cols}
            className="sb-split grid min-h-0 flex-1"
          >
            <div className={`min-w-0 overflow-y-auto ${viewingContact ? "hidden lg:block" : ""}`}>
              {error && !composing && !deletingContact && !deletingAddressBook ? (
                <p className="border-b border-line/60 px-4 py-3 text-sm text-danger sm:px-5 lg:px-6" role="alert">{error}</p>
              ) : null}

              {loadingVault && contacts.length === 0 ? (
                <ContactListSkeleton />
              ) : filtered.length === 0 && search.trim() ? (
                <div className="flex flex-col items-center px-6 py-16 animate-fade-in-up">
                  <p className="text-sm text-mute">No contacts matching "{search}"</p>
                  <button type="button" className={`${ghost} mt-3`} onClick={() => onSetSearch("")}>
                    Clear search
                  </button>
                </div>
              ) : viewingArchive && filtered.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-12 text-center animate-fade-in-up sm:py-16">
                  <p className="text-sm font-medium text-text">The Archive is empty</p>
                  <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-mute">
                    Archiving a contact takes it out of its address book and
                    puts it here, without deleting anything.
                  </p>
                  <button type="button" className={`${ghost} mt-3`} onClick={() => onSetViewingArchive(false)}>
                    Back to contacts
                  </button>
                </div>
              ) : contacts.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-12 text-center animate-fade-in-up sm:py-16">
                  <p className="text-sm font-medium text-text">No contacts yet</p>
                  <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-mute">
                    Everything you add here is encrypted on this device before it
                    reaches the server.
                  </p>
                  <button type="button" className={`${btnPrimary} mt-5`} onClick={onOpenComposer}>
                    <PlusIcon />
                    Add your first contact
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-12 text-center animate-fade-in-up sm:py-16">
                  <p className="text-sm text-mute">
                    {soleShownBook
                      ? `${soleShownBook.name} has no contacts yet.`
                      : "No contacts in the address books you are showing."}
                  </p>
                  <button type="button" className={`${ghost} mt-3`} onClick={onShowAllBooks}>
                    Show all address books
                  </button>
                </div>
              ) : (
                <ul className="min-w-0">
                  {filtered.map((card) => (
                    <ContactCard
                      key={card.id}
                      contact={card}
                      selected={viewingContact?.id === card.id}
                      bookName={
                        soleShownBook && !viewingArchive
                          ? undefined
                          : bookNameById(addressBooks, card.addressBookId)
                      }
                      onSelect={(contact) =>
                        onGuardEditing(() => {
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
      </div>

      <ContextMenu state={menu.menu} onClose={menu.close} />
    </main>
  );
}
