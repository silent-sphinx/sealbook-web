import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrashPanel, TrashRow, trashRootsFor } from "./Trash";
import { NO_TRASH, type TrashListing } from "../lib/trash";
import { trashItems } from "../lib/trashApi";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { CollectionSidebar } from "./CollectionSidebar";
import { SidebarDrawer, SidebarHeader, SidebarSection, type Sidebar } from "./SidebarDrawer";
import {
  bookmarkFitsObjectLimit,
  bookmarkWithTagAdded,
  bookmarkWithTagRemoved,
  bookmarkWritable,
  bookmarkHost,
  bookmarkMatches,
  buildCollectionTree,
  canMoveCollection,
  bookmarkDraft,
  collectionTone,
  DEFAULT_BOOKMARK_COLLECTION_ID,
  emptyBookmarkDraft,
  hiddenFromAllIds,
  bookmarkHref,
  isValidUrl,
  normalizeTags,
  normalizeUrl,
  resolveCollectionId,
  sortBookmarksBy,
  BOOKMARK_SORTS,
  bookmarkSortLabel,
  loadBookmarkSort,
  storeBookmarkSort,
  type BookmarkSort,
  sortCollections,
} from "../lib/bookmark";
import {
  ensureDefaultBookmarkCollection,
  putBookmark,
  putBookmarkCollection,
  putBookmarks,
  RefusedWrites,
  type Session,
} from "../lib/client";
import { archivedIds } from "../lib/archive";
import { friendlyError } from "../lib/errors";
import { useItemSelection } from "../lib/useItemSelection";
import {
  btnPrimarySm,
  btnPrimary,
  btnSecondarySm,
  btnSecondary,
  eyebrow,
  field,
  fieldBase,
  fieldLabel,
  focusRing,
  iconBtn,
  iconBtnDanger,
  listRow,
  listRowState,
  rowReveal,
  searchClear,
  searchField,
  searchIcon,
  selectField,
  sidebarCount,
  sidebarMark,
  sidebarNameInput,
  sidebarRowState,
  sidebarSectionAction,
  viewMain,
  viewGrid,
  sidebarRow,
} from "../lib/styles";
import { canonicalTag as canonicalTagIn, hasTag, tagVocabulary } from "../lib/tags";
import { flattenTree } from "../lib/tree";
import type { Bookmark, BookmarkCollection, BookmarkDraft } from "../lib/types";
import { Icon } from "./Icon";
import { PickerMenu } from "./PickerMenu";
import { PaneHeader, BulkBar } from "./PaneControls";
import { TagsInput } from "./FieldControls";
import { TagFilterBar } from "./TagFilterBar";
import { ErrorMessage } from "./ErrorMessage";
import { Modal, ModalBody, ModalFooter } from "./Modal";
import { EmptyState } from "./EmptyState";

type Props = {
  session: Session;
  /** What is in the trash; the Bookmarks tab lists its bookmarks and collections. */
  trash?: TrashListing;
  bookmarks: Bookmark[];
  collections: BookmarkCollection[];
  busy: boolean;
  onRefresh: () => Promise<unknown> | void;
  onCreateCollection: (
    name: string,
    parentId?: string,
  ) => Promise<string | undefined>;
  readOnly?: boolean;
  sidebar: Sidebar;
  /** A bookmark to show in its collection, as `TasksView`'s `focusTaskId`. */
  focusBookmarkId?: string;
  onFocusHandled?: () => void;
};

/** Stands for "every collection" in the sidebar, as `ALL_NOTEBOOKS` does for notes. */
const ALL = "all";

type BulkKind = "addTag" | "removeTag" | "delete";

/** What is being dragged. Held in state because a drop target cannot read a payload during dragover. */
type DragItem = { kind: "bookmark"; ids: string[] } | { kind: "collection"; id: string };

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function BookmarksView({
  session,
  trash = NO_TRASH,
  bookmarks,
  collections,
  busy,
  onRefresh,
  onCreateCollection,
  readOnly,
  sidebar,
  focusBookmarkId,
  onFocusHandled,
}: Props) {
  const readOnlyMode = readOnly === true;
  const [scope, setScope] = useState<string>(ALL);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchScope, setSearchScope] = useState<"all" | "collection">("collection");
  const [sort, setSort] = useState<BookmarkSort>(loadBookmarkSort);
  const [draft, setDraft] = useState<BookmarkDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const menu = useContextMenu();
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [dropCardId, setDropCardId] = useState<string | null>(null);
  const [renamingCardId, setRenamingCardId] = useState<string | null>(null);
  const [cardName, setCardName] = useState("");
  const cardRenameDone = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState<Bookmark | null>(null);
  const [deletingCollection, setDeletingCollection] =
    useState<BookmarkCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingTrash, setViewingTrash] = useState(false);
  const trashCount = useMemo(() => trashRootsFor(trash, "bookmarks").length, [trash]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);

  // The default collection is created on first entry here, not on every vault
  // refresh: a failed write on the refresh path would stop the whole vault
  // loading, contacts included. This is also the whole migration for an account
  // that predates bookmarks.
  const ensuredRef = useRef(false);
  useEffect(() => {
    if (readOnlyMode || ensuredRef.current) return;
    ensuredRef.current = true;
    if (collections.some((item) => item.id === DEFAULT_BOOKMARK_COLLECTION_ID))
      return;
    void (async () => {
      try {
        await ensureDefaultBookmarkCollection(session, collections);
        await onRefresh();
      } catch (err) {
        setError(friendlyError(err));
      }
    })();
  }, [collections, onRefresh, readOnlyMode, session]);

  // A collection that went away leaves the sidebar pointing at nothing.
  useEffect(() => {
    if (scope === ALL) return;
    if (!collections.some((item) => item.id === scope)) setScope(ALL);
  }, [collections, scope]);

  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [handledFocus, setHandledFocus] = useState<string | null>(null);
  if (!focusBookmarkId && handledFocus !== null) {
    setHandledFocus(null);
  } else if (focusBookmarkId && focusBookmarkId !== handledFocus) {
    setHandledFocus(focusBookmarkId);
    const target = bookmarks.find((bookmark) => bookmark.id === focusBookmarkId);
    if (target) {
      setScope(resolveCollectionId(target.collectionId));
      setSearch("");
      setHighlightId(target.id);
    }
  }

  useEffect(() => {
    if (focusBookmarkId) onFocusHandled?.();
  }, [focusBookmarkId, onFocusHandled]);

  useEffect(() => {
    if (!highlightId) return;
    document.querySelector(`[data-bookmark-id="${highlightId}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [highlightId, bookmarks]);

  // A full pass over every bookmark, so the typed value is deferred: the field
  // stays responsive on a vault the filter takes time over.
  const deferredSearch = useDeferredValue(search);

  const collectionTree = useMemo(
    () => buildCollectionTree(collections),
    [collections],
  );

  const rows = useMemo(() => flattenTree(collectionTree), [collectionTree]);
  const collectionOptions = useMemo(
    () => rows.map(({ item, depth }) => ({ id: item.id, name: item.name, depth })),
    [rows],
  );

  /**
   * Bookmarks directly in the selected collection, not those of a collection
   * nested under it: a subcollection's own links are reached from the sidebar,
   * so the two views never show the same bookmark twice.
   */
  const awayCollections = useMemo(() => archivedIds(collections), [collections]);
  const hiddenFromAll = useMemo(
    () => new Set([...hiddenFromAllIds(collectionTree), ...awayCollections]),
    [collectionTree, awayCollections],
  );

  const visible = useMemo(() => {
    const scoped =
      scope === ALL || (deferredSearch.trim() && searchScope === "all")
        ? bookmarks.filter(
            (bookmark) =>
              !hiddenFromAll.has(resolveCollectionId(bookmark.collectionId)),
          )
        : bookmarks.filter(
            (bookmark) => resolveCollectionId(bookmark.collectionId) === scope,
          );
    // A search never reaches an archived collection, even one opened from the archive.
    const searchable = deferredSearch.trim()
      ? scoped.filter((bookmark) => !awayCollections.has(resolveCollectionId(bookmark.collectionId)))
      : scoped;
    const tagged = tagFilter
      ? searchable.filter((bookmark) => hasTag(bookmark.tags, tagFilter))
      : searchable;
    return sortBookmarksBy(
      tagged.filter((bookmark) => bookmarkMatches(bookmark, deferredSearch)),
      sort,
    );
  }, [bookmarks, scope, searchScope, deferredSearch, hiddenFromAll, awayCollections, tagFilter, sort]);

  // Open while typing in the field, while it holds a query, and while its own
  // menu has the focus; otherwise the scope control would crowd an idle field.
  const searchExpanded =
    searchFocused || search !== "" || menu.menu?.trigger === "search-scope";

  function searchScopeItems(): MenuItem[] {
    return (
      [
        ["all", "Search all"],
        ["collection", "Search collection"],
      ] as const
    ).map(([key, label]) => ({
      label: key === searchScope ? `\u2713 ${label}` : label,
      onSelect: () => {
        setSearchScope(key);
        // Focus returns to the field, which is what keeps the bar expanded.
        searchInput.current?.focus();
      },
    }));
  }

  function sortItems(): MenuItem[] {
    return BOOKMARK_SORTS.map(({ key, label }) => ({
      label: key === sort ? `\u2713 ${label}` : label,
      onSelect: () => {
        setSort(key);
        storeBookmarkSort(key);
      },
    }));
  }

  const tagList = useMemo(
    () =>
      tagVocabulary(
        bookmarks
          // A tag found only on archived bookmarks would filter to nothing.
          .filter((bookmark) => !awayCollections.has(resolveCollectionId(bookmark.collectionId)))
          .map((bookmark) => bookmark.tags),
      ),
    [bookmarks, awayCollections],
  );

  function canonicalTag(tag: string): string {
    return canonicalTagIn(tagList, tag);
  }

  useEffect(() => {
    if (tagFilter && !tagList.some((tag) => tag.key === tagFilter)) setTagFilter(null);
  }, [tagList, tagFilter]);

  const selection = useItemSelection(visible, { enabled: !readOnlyMode, paused: bulk !== null || draft !== null });
  const {
    selected,
    selectedItems: selectedBookmarks,
    selecting,
    begin: beginSelecting,
    toggle: toggleSelected,
    toggleAll,
    clear: endSelecting,
  } = selection;

  const countByCollection = useMemo(() => {
    const counts = new Map<string, number>();
    for (const bookmark of bookmarks) {
      const id = resolveCollectionId(bookmark.collectionId);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [bookmarks]);

  const topCollections = useMemo(
    () =>
      scope === ALL
        ? collectionTree.map((node) => node.item).filter((item) => !awayCollections.has(item.id))
        : [],
    [collectionTree, scope, awayCollections],
  );

  function startAdd(collectionId?: string) {
    const target = collectionId ?? (scope === ALL ? DEFAULT_BOOKMARK_COLLECTION_ID : scope);
    setDraft(emptyBookmarkDraft(target));
    setTags([]);
    setEditingId(null);
    setError(null);
  }

  function startEdit(bookmark: Bookmark) {
    setDraft(bookmarkDraft(bookmark));
    setTags(bookmark.tags ?? []);
    setEditingId(bookmark.id);
    setError(null);
  }

  function openBulk(kind: BulkKind) {
    setBulk(kind);
    setBulkText("");
    setBulkError(null);
  }

  /** What the selection offers beyond Move and Delete, which the bar draws as their own controls. */
  function bulkMoreItems(): MenuItem[] {
    const none = selected.size === 0;
    const count = plural(selected.size, "bookmark");
    const disabledReason = "Select bookmarks first";
    return [
      { label: `Add tag to ${count}`, disabled: none, disabledReason, onSelect: () => openBulk("addTag") },
      { label: `Remove tag from ${count}`, disabled: none, disabledReason, onSelect: () => openBulk("removeTag") },
    ];
  }

  function bulkItems(): MenuItem[] {
    const none = selected.size === 0;
    return [
      ...bulkMoreItems(),
      {
        label: `Delete ${plural(selected.size, "bookmark")}`,
        danger: true,
        disabled: none,
        disabledReason: "Select bookmarks first",
        onSelect: () => openBulk("delete"),
      },
    ];
  }

  const bulkTagChoices = useMemo(
    () => normalizeTags(selectedBookmarks.flatMap((bookmark) => bookmark.tags ?? [])),
    [selectedBookmarks],
  );

  async function applyBulk() {
    if (!bulk) return;
    setBulkError(null);
    const writable = selectedBookmarks.filter((bookmark) => bookmarkWritable(bookmark));
    const skipped = selectedBookmarks.length - writable.length;
    let writes: { id: string; draft: BookmarkDraft }[] = [];
    if (bulk === "addTag" || bulk === "removeTag") {
      const tag = bulk === "addTag" ? canonicalTag(normalizeTags([bulkText])[0] ?? "") : bulkText;
      if (!tag) {
        setBulkError(bulk === "addTag" ? "Enter a tag." : "Choose a tag.");
        return;
      }
      for (const bookmark of writable) {
        const draft =
          bulk === "addTag" ? bookmarkWithTagAdded(bookmark, tag) : bookmarkWithTagRemoved(bookmark, tag);
        if (!draft) continue;
        if (!bookmarkFitsObjectLimit(draft)) {
          setBulkError(`“${bookmark.title}” is too large to store with that change.`);
          return;
        }
        writes.push({ id: bookmark.id, draft });
      }
    }
    setSaving(true);
    setError(null);
    try {
      if (bulk === "delete") {
        await trashItems(session, selectedBookmarks.map((item) => ({ kind: "bookmark" as const, item })));
      } else {
        await putBookmarks(session, writes);
      }
      await onRefresh();
      setBulk(null);
      endSelecting();
      const changed = bulk === "delete" ? selectedBookmarks.length : writes.length;
      const parts = [`${plural(changed, "bookmark")} ${bulk === "delete" ? "moved to the trash" : "updated"}`];
      if (skipped > 0) parts.push(`${skipped} skipped: saved by a newer version of Sealbook`);
      setNotice(`${parts.join(", ")}.`);
    } catch (err) {
      if (err instanceof RefusedWrites) {
        await onRefresh();
        selection.select(err.refused.keys());
      }
      setBulkError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function moveSelected(collectionId: string) {
    const writable = selectedBookmarks.filter((bookmark) => bookmarkWritable(bookmark));
    const skipped = selectedBookmarks.length - writable.length;
    const writes = writable
      .filter((bookmark) => resolveCollectionId(bookmark.collectionId) !== collectionId)
      .map((bookmark) => ({ id: bookmark.id, draft: { ...bookmarkDraft(bookmark), collectionId } }));
    setSaving(true);
    setError(null);
    try {
      await putBookmarks(session, writes);
      await onRefresh();
      endSelecting();
      const parts = [`${plural(writes.length, "bookmark")} updated`];
      if (skipped > 0) parts.push(`${skipped} skipped: saved by a newer version of Sealbook`);
      setNotice(`${parts.join(", ")}.`);
    } catch (err) {
      if (err instanceof RefusedWrites) {
        await onRefresh();
        selection.select(err.refused.keys());
      }
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  function bookmarkMenuFor(bookmark: Bookmark): MenuItem[] {
    if (readOnlyMode) return [];
    if (selected.has(bookmark.id) && selected.size > 1) return bulkItems();
    return bookmarkItemsFor(bookmark);
  }

  /** Where the sidebar title leads: every bookmark, with nothing filtered. */
  function goHome() {
    setScope(ALL);
    setSearch("");
    setTagFilter(null);
    setViewingTrash(false);
    sidebar.close();
  }

  function closeForm() {
    setDraft(null);
    setEditingId(null);
    setTags([]);
  }

  async function saveDraft() {
    if (!draft) return;
    if (!isValidUrl(draft.url)) {
      setError("Enter a web address, for example example.com/page.");
      return;
    }
    const payload: BookmarkDraft = {
      ...draft,
      url: normalizeUrl(draft.url),
      title: draft.title.trim(),
      tags: normalizeTags(tags.map(canonicalTag)),
    };
    if (!bookmarkFitsObjectLimit(payload)) {
      setError(
        "This bookmark is too large to store. One bookmark can hold about 8 MB.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await putBookmark(session, payload, editingId ?? undefined);
      await onRefresh();
      closeForm();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeBookmark(bookmark: Bookmark) {
    setSaving(true);
    setError(null);
    try {
      await trashItems(session, [{ kind: "bookmark", item: bookmark }]);
      await onRefresh();
      setConfirmDelete(null);
      if (editingId === bookmark.id) closeForm();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Moves a collection to the trash. The bookmarks and collections inside it
   * go with it, and a restore brings them back together.
   */
  async function removeCollection(collection: BookmarkCollection) {
    setSaving(true);
    setError(null);
    try {
      await trashItems(session, [{ kind: "bookmark_collection", item: collection }]);
      await onRefresh();
      if (scope === collection.id) setScope(collection.parentId ?? ALL);
      setDeletingCollection(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  function collectionExtras(collection: BookmarkCollection): MenuItem[] {
    return [
      {
        label: collection.hideFromAll ? "Show in overview" : "Hide from overview",
        onSelect: () => void toggleHideFromAll(collection),
      },
    ];
  }

  function cardItemsFor(collection: BookmarkCollection): MenuItem[] {
    if (readOnlyMode) return [];
    const items: MenuItem[] = [
      {
        label: "Rename collection",
        onSelect: () => {
          cardRenameDone.current = false;
          setCardName(collection.name);
          setRenamingCardId(collection.id);
        },
      },
      ...collectionExtras(collection),
    ];
    if (collection.id !== DEFAULT_BOOKMARK_COLLECTION_ID) {
      items.push({
        label: "Delete collection",
        danger: true,
        onSelect: () => setDeletingCollection(collection),
      });
    }
    return items;
  }

  function commitCardRename(collection: BookmarkCollection) {
    if (cardRenameDone.current) return;
    cardRenameDone.current = true;
    const name = cardName.trim();
    setRenamingCardId(null);
    if (name && name !== collection.name) void renameCollection(collection, name);
  }

  function bookmarkItemsFor(bookmark: Bookmark): MenuItem[] {
    if (readOnlyMode) return [];
    return [
      { label: "Edit bookmark", onSelect: () => startEdit(bookmark) },
      {
        label: "Delete bookmark",
        danger: true,
        onSelect: () => setConfirmDelete(bookmark),
      },
    ];
  }

  /**
   * The stored payload goes back in as `previousRaw`, and the parent is passed
   * through unchanged: a rename must not move a collection, and must not drop a
   * key a newer build put there.
   */
  async function renameCollection(collection: BookmarkCollection, name: string) {
    setSaving(true);
    setError(null);
    try {
      await putBookmarkCollection(
        session,
        name,
        collection.parentId,
        collection.id,
        collection.raw,
        collection.color,
      );
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function setCollectionArchived(collection: BookmarkCollection, archived: boolean) {
    setSaving(true);
    setError(null);
    try {
      await putBookmarkCollection(
        session,
        collection.name,
        collection.parentId,
        collection.id,
        collection.raw,
        collection.color,
        undefined,
        archived,
      );
      if (archived && (scope === collection.id || awayCollections.has(scope))) setScope(ALL);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleHideFromAll(collection: BookmarkCollection) {
    setSaving(true);
    setError(null);
    try {
      await putBookmarkCollection(
        session,
        collection.name,
        collection.parentId,
        collection.id,
        collection.raw,
        collection.color,
        !collection.hideFromAll,
      );
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Sets a top-level collection's colour. Only called for a root collection:
   * every collection nested under it reads this one's colour through
   * `collectionTone` rather than storing a colour of its own.
   */
  async function changeCollectionColor(collection: BookmarkCollection, color: string) {
    setSaving(true);
    setError(null);
    try {
      await putBookmarkCollection(
        session,
        collection.name,
        collection.parentId,
        collection.id,
        collection.raw,
        color,
      );
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function createCollection(name: string, parentId?: string) {
    const id = await onCreateCollection(name, parentId);
    if (id) setScope(id);
  }

  /**
   * Drags a collection under another, or to the top level with `parentId` null.
   *
   * Checked again here even though a row only lets a valid drop land: the tree
   * can change out from under a drag in flight on another device, so the last
   * word on whether this would eat itself belongs to `canMoveCollection`, not
   * to whatever `droppable` happened to render.
   */
  async function moveCollection(id: string, parentId: string | null) {
    if (readOnlyMode) return;
    const collection = collections.find((item) => item.id === id);
    if (!collection) return;
    if (!canMoveCollection(collections, id, parentId)) {
      setError("A collection cannot be moved inside itself.");
      return;
    }
    if ((collection.parentId ?? null) === parentId) return;
    setSaving(true);
    setError(null);
    try {
      await putBookmarkCollection(
        session,
        collection.name,
        parentId ?? undefined,
        collection.id,
        collection.raw,
        collection.color,
      );
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function moveBookmark(bookmark: Bookmark, collectionId: string) {
    setSaving(true);
    setError(null);
    try {
      await putBookmark(session, { ...bookmarkDraft(bookmark), collectionId }, bookmark.id);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  /** Moves bookmarks in one write; ones already there or not writable are left alone. */
  async function moveBookmarks(ids: string[], collectionId: string) {
    const writes = bookmarks
      .filter(
        (bookmark) =>
          ids.includes(bookmark.id) &&
          bookmarkWritable(bookmark) &&
          resolveCollectionId(bookmark.collectionId) !== collectionId,
      )
      .map((bookmark) => ({ id: bookmark.id, draft: { ...bookmarkDraft(bookmark), collectionId } }));
    if (writes.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await putBookmarks(session, writes);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  function canDropOnCollection(collectionId: string): boolean {
    if (!drag || readOnlyMode) return false;
    if (drag.kind === "bookmark") return true;
    return drag.id !== collectionId && canMoveCollection(collections, drag.id, collectionId);
  }

  function dropOnCollection(collectionId: string) {
    const current = drag;
    setDrag(null);
    setDropCardId(null);
    if (!current) return;
    if (current.kind === "bookmark") void moveBookmarks(current.ids, collectionId);
    else void moveCollection(current.id, collectionId);
  }

  function endDrag() {
    setDrag(null);
    setDropCardId(null);
  }

  const disabled = busy || saving || readOnlyMode;

  return (
    <main className={viewMain}>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      {notice ? (
        <p
          role="status"
          className="flex shrink-0 items-center justify-between border-b border-line bg-panel/60 px-4 py-2 text-xs text-mute lg:px-6"
        >
          {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className={focusRing}>
            <Icon name="close" className="h-3 w-3" />
          </button>
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger lg:px-6"
        >
          {error}
        </p>
      ) : null}

      <div className={viewGrid} style={sidebar.cols}>
        <SidebarDrawer title="Bookmarks" sidebar={sidebar}>
          <SidebarHeader
            title="Bookmarks"
            onTitleClick={goHome}
          />

          <SidebarSection
            label="Collections"
            action={
              !readOnlyMode ? (
                <button
                  type="button"
                  onClick={() => setCreatingCollection(true)}
                  title="Add a top-level collection"
                  className={sidebarSectionAction}
                  aria-label="Add collection"
                >
                  <Icon name="plus" />
                </button>
              ) : null
            }
          >
            <button
              type="button"
              onClick={() => setScope(ALL)}
              aria-current={scope === ALL ? "true" : undefined}
              className={`mt-2.5 ${sidebarRow} ${sidebarRowState(
                scope === ALL,
              )} ${focusRing}`}
            >
              <span className={sidebarMark}>
                <Icon name="bookmark" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">All bookmarks</span>
              <span className={sidebarCount}>{bookmarks.length || ""}</span>
            </button>
            <CollectionSidebar
              collections={collections}
              sort={sortCollections}
              selectedId={scope}
              onSelect={setScope}
              icon="bookmark"
              kindLabel="collection"
              subLabel="subcollection"
              tone={(collection) => collectionTone(collections, collection.id)}
              protectedId={DEFAULT_BOOKMARK_COLLECTION_ID}
              counts={countByCollection}
              creating={creatingCollection}
              onCreateHandled={() => setCreatingCollection(false)}
              onCreate={createCollection}
              onRename={renameCollection}
              onRecolor={changeCollectionColor}
              onDelete={setDeletingCollection}
              onArchive={(collection) => void setCollectionArchived(collection, true)}
              onRestore={(collection) => void setCollectionArchived(collection, false)}
              canMove={(id, parentId) => canMoveCollection(collections, id, parentId)}
              onMove={moveCollection}
              onToggleHidden={(collection) => void toggleHideFromAll(collection)}
              externalDrop={{ canDrop: canDropOnCollection, onDrop: dropOnCollection }}
              readOnly={readOnlyMode}
              busy={busy || saving}
            />
            {readOnlyMode ? null : (
              <TrashRow
                count={trashCount}
                active={viewingTrash}
                onToggle={() => setViewingTrash(!viewingTrash)}
              />
            )}
          </SidebarSection>
        </SidebarDrawer>

        {viewingTrash ? (
          <TrashPanel session={session} trash={trash} tab="bookmarks" sidebar={sidebar} onChanged={async () => { await onRefresh(); }} />
        ) : (
        <section className="flex min-h-0 flex-col overflow-hidden">
          <PaneHeader
            title={
              scope === ALL
                ? "All bookmarks"
                : (collections.find((item) => item.id === scope)?.name ?? "Bookmarks")
            }
            count={visible.length}
            countLabel={`${visible.length} bookmark${visible.length === 1 ? "" : "s"}`}
            sidebar={sidebar}
          >
              {!readOnlyMode && !selecting ? (
                <button
                  type="button"
                  onClick={() => startAdd()}
                  disabled={disabled}
                  className={btnPrimarySm}
                >
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">New bookmark</span>
                  <span className="sm:hidden">New</span>
                </button>
              ) : null}
              <button
                type="button"
                data-menu-trigger
                onClick={(event) => menu.toggle(event, sortItems(), "sort")}
                aria-haspopup="menu"
                aria-label={`Sort: ${bookmarkSortLabel(sort)}`}
                title={`Sort: ${bookmarkSortLabel(sort)}`}
                className={btnSecondarySm}
              >
                <Icon name="text" className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sort</span>
              </button>
              <div
                className="relative min-w-0 flex-1 sm:flex-none"
                onFocus={() => setSearchFocused(true)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setSearchFocused(false);
                }}
              >
                <Icon name="search" className={searchIcon} />
                {searchExpanded ? (
                <button
                  type="button"
                  data-menu-trigger
                  onClick={(event) => menu.toggle(event, searchScopeItems(), "search-scope")}
                  aria-haspopup="menu"
                  aria-label={`Search scope: ${searchScope === "all" ? "all" : "collection"}`}
                  title="Search scope"
                  className={`absolute left-7 top-1/2 flex h-6 -translate-y-1/2 items-center gap-0.5 rounded-md px-1.5 text-xs font-medium text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                >
                  <span>{searchScope === "all" ? "All" : "Collection"}</span>
                  <Icon name="chevron" className="h-3 w-3 rotate-90" />
                </button>
                ) : null}
                <input
                  ref={searchInput}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search bookmarks"
                  aria-label="Search bookmarks"
                  style={
                    searchExpanded
                      ? { paddingLeft: searchScope === "all" ? "5.25rem" : "8rem" }
                      : undefined
                  }
                  className={`${searchField} ${searchExpanded ? "sm:w-80" : "sm:w-52"}`}
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
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
              label="Bulk edit bookmarks"
              noun="bookmarks"
              selected={selected.size}
              total={visible.length}
              onToggleAll={toggleAll}
              onClear={endSelecting}
              disabled={disabled}
              move={{
                label: "Move selected bookmarks to",
                noun: "collection",
                icon: "bookmark",
                options: collectionOptions,
                onCreate: (name) => onCreateCollection(name),
                onMove: (collectionId) => void moveSelected(collectionId),
              }}
              onDelete={() => openBulk("delete")}
              more={bulkMoreItems()}
            />
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 lg:px-6">
            {draft ? (
              <form
                className="mb-4 rounded-xl border border-line bg-panel/80 p-4"
                autoComplete="off"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDraft();
                }}
              >
                <h4 className="text-sm font-semibold">
                  {editingId ? "Edit bookmark" : "New bookmark"}
                </h4>
                <label className="mt-3 block text-xs text-mute">
                  Web address
                  <input
                    autoFocus
                    value={draft.url}
                    onChange={(event) =>
                      setDraft({ ...draft, url: event.target.value })
                    }
                    placeholder="example.com/page"
                    className={`mt-1.5 ${fieldBase}`}
                  />
                </label>
                <label className="mt-3 block text-xs text-mute">
                  Title
                  <input
                    value={draft.title}
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                    placeholder="Optional, defaults to the address"
                    className={`mt-1.5 ${fieldBase}`}
                  />
                </label>
                <label className="mt-3 block text-xs text-mute">
                  Collection
                  <select
                    value={draft.collectionId}
                    onChange={(event) =>
                      setDraft({ ...draft, collectionId: event.target.value })
                    }
                    className={`mt-1.5 ${selectField}`}
                  >
                    {rows.map(({ item, depth }) => (
                      <option key={item.id} value={item.id}>
                        {`${"— ".repeat(depth)}${item.name}`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-3 text-xs text-mute">
                  Tags
                  <div className="mt-1.5">
                    <TagsInput
                      values={tags.map((tag) => ({ id: tag, value: tag }))}
                      label="Tags"
                      removeLabel="Remove tag"
                      placeholder="Type a tag and press Enter"
                      suggestions={tagList.map((tag) => tag.name)}
                      onAdd={(value) =>
                        setTags((current) =>
                          normalizeTags([...current, ...value.split(",").map(canonicalTag)]),
                        )
                      }
                      onRemove={(id) => setTags((current) => current.filter((tag) => tag !== id))}
                    />
                  </div>
                </div>
                <label className="mt-3 block text-xs text-mute">
                  Notes
                  <textarea
                    value={draft.notes ?? ""}
                    onChange={(event) =>
                      setDraft({ ...draft, notes: event.target.value })
                    }
                    rows={3}
                    placeholder="Why you saved it"
                    className="mt-1.5 box-border w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
                  />
                </label>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={disabled}
                    className={btnPrimary}
                  >
                    {editingId ? "Save" : "Add"}
                  </button>
                  <button
                    type="button"
                    onClick={closeForm}
                    className={btnSecondary}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            {/* Hidden during a search: the cards below are not filtered by
                it, and showing an unrelated grid above a text search's
                results reads as broken rather than as a shortcut. */}
            {!search.trim() && topCollections.length > 0 ? (
              <div className="mb-5">
                <p className={`mb-2 ${eyebrow}`}>
                  Collections
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {topCollections.map((collection) =>
                    renamingCardId === collection.id ? (
                      <form
                        key={collection.id}
                        autoComplete="off"
                        onSubmit={(event) => {
                          event.preventDefault();
                          commitCardRename(collection);
                        }}
                      >
                        <input
                          autoFocus
                          value={cardName}
                          onChange={(event) => setCardName(event.target.value)}
                          onBlur={() => commitCardRename(collection)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              cardRenameDone.current = true;
                              setRenamingCardId(null);
                            }
                          }}
                          aria-label={`Rename ${collection.name}`}
                          className={sidebarNameInput}
                        />
                      </form>
                    ) : (
                      // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
                      <div
                        key={collection.id}
                        draggable={!readOnlyMode}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", collection.name);
                          event.dataTransfer.effectAllowed = "move";
                          setDrag({ kind: "collection", id: collection.id });
                        }}
                        onDragEnd={endDrag}
                        onDragOver={(event) => {
                          if (!canDropOnCollection(collection.id)) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                          setDropCardId(collection.id);
                        }}
                        onDragLeave={() =>
                          setDropCardId((current) => (current === collection.id ? null : current))
                        }
                        onDrop={(event) => {
                          if (!canDropOnCollection(collection.id)) return;
                          event.preventDefault();
                          dropOnCollection(collection.id);
                        }}
                        onContextMenu={(event) => menu.open(event, cardItemsFor(collection))}
                      >
                        <button
                          type="button"
                          onClick={() => setScope(collection.id)}
                          aria-label={`Open ${collection.name}`}
                          className={`flex w-full items-center gap-2.5 rounded-xl border bg-panel/60 px-3 py-2.5 text-left transition-colors hover:border-line-light hover:bg-panel ${focusRing} ${
                            dropCardId === collection.id ? "border-accent-dim ring-1 ring-accent-ring" : "border-line"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 shrink-0 rounded-full"
                            style={{ background: collectionTone(collections, collection.id) }}
                          />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">
                            {collection.name}
                          </span>
                          <span className="shrink-0 text-2xs tabular-nums text-mute">
                            {countByCollection.get(collection.id) || ""}
                          </span>
                        </button>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : null}

            {!search.trim() && scope === ALL && tagList.length > 0 ? (
              <div className="mb-5">
                <p className={`mb-2 ${eyebrow}`}>Tags</p>
                <TagFilterBar tags={tagList} active={tagFilter} onChange={setTagFilter} />
              </div>
            ) : null}

            {!search.trim() && topCollections.length > 0 ? (
              <p className={`mb-2 ${eyebrow}`}>
                Bookmarks
              </p>
            ) : null}

            {visible.length === 0 ? (
              search.trim() ? (
                <EmptyState title="No bookmarks match that search." />
              ) : (
                <EmptyState title="No bookmarks here yet" />
              )
            ) : (
              <ul>
                {visible.map((bookmark) => {
                  const tone = collectionTone(collections, resolveCollectionId(bookmark.collectionId));
                  return (
                  <li key={bookmark.id}>
                    {/* The row click is a pointer shortcut; the checkbox inside is the
                        keyboard path, and its click bubbles here. */}
                    {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                    <div
                      data-bookmark-id={bookmark.id}
                      draggable={!readOnlyMode && bookmarkWritable(bookmark)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", bookmark.title);
                        event.dataTransfer.effectAllowed = "move";
                        const ids =
                          selecting && selected.has(bookmark.id) ? [...selected] : [bookmark.id];
                        setDrag({ kind: "bookmark", ids });
                      }}
                      onDragEnd={endDrag}
                      className={`group py-2 ${listRow} ${listRowState({ current: highlightId === bookmark.id, checked: selected.has(bookmark.id) })}`}
                      onContextMenu={(event) =>
                        menu.open(event, bookmarkMenuFor(bookmark))
                      }
                      onClick={(event) => {
                        if (readOnlyMode) return;
                        if ((event.target as HTMLElement).closest("a,button,select")) return;
                        if (selecting) toggleSelected(bookmark, event.shiftKey);
                        else if (event.ctrlKey || event.metaKey) beginSelecting(bookmark);
                      }}
                    >
                      {readOnlyMode ? (
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: tone }}
                        />
                      ) : (
                        // The collection dot is also the select control: it grows
                        // into a ring while selecting and fills with a tick when
                        // picked, so selection needs no extra column.
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={selected.has(bookmark.id)}
                          aria-label={`Select ${bookmark.title}`}
                          onClick={(event) =>
                            selecting
                              ? toggleSelected(bookmark, event.shiftKey)
                              : beginSelecting(bookmark)
                          }
                          className={`group flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${focusRing}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`flex items-center justify-center rounded-full text-white transition-all ${
                              selecting
                                ? "h-4 w-4 border-2"
                                : "h-2 w-2 group-hover:h-3 group-hover:w-3"
                            }`}
                            style={{
                              borderColor: tone,
                              background: !selecting || selected.has(bookmark.id) ? tone : "transparent",
                            }}
                          >
                            {selecting && selected.has(bookmark.id) ? (
                              <Icon name="check" className="h-2.5 w-2.5" />
                            ) : null}
                          </span>
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                        <a
                          href={bookmarkHref(bookmark.url)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className={`block truncate text-sm font-medium text-text hover:text-accent ${focusRing}`}
                        >
                          {bookmark.title}
                        </a>
                        <p className="truncate text-xs text-mute">
                          {bookmarkHost(bookmark.url)}
                          {bookmark.tags && bookmark.tags.length > 0
                            ? ` · ${bookmark.tags.join(", ")}`
                            : ""}
                        </p>
                      </div>
                      {/* Open stays with the other controls, so a row at rest is a title
                          and a host. On a phone, where nothing hovers, they all show, and
                          the collection moves to the edit form, which has the room. */}
                      <div className={`flex shrink-0 items-center gap-1 ${rowReveal}`}>
                        <a
                          href={bookmarkHref(bookmark.url)}
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={`Open ${bookmark.title}`}
                          className={iconBtn}
                        >
                          <Icon name="link" className="size-4" />
                        </a>
                        {!readOnlyMode && !selecting ? (
                          <>
                              <div className="hidden w-36 sm:block">
                                <PickerMenu
                                  title="Move to collection"
                                  searchLabel="Find a collection"
                                  emptyNoun="collections"
                                  options={collectionOptions}
                                  value={resolveCollectionId(bookmark.collectionId)}
                                  onPick={(id) => void moveBookmark(bookmark, id)}
                                  create={{ label: "New collection", placeholder: "Collection name", onCreate: (name) => onCreateCollection(name) }}
                                  triggerLabel={`Collection for ${bookmark.title}`}
                                  triggerClassName={`${btnSecondarySm} w-full justify-between`}
                                  trigger={
                                    <>
                                      <span className="truncate">{collectionOptions.find((option) => option.id === resolveCollectionId(bookmark.collectionId))?.name}</span>
                                      <Icon name="chevron" className="size-3 shrink-0 rotate-90" />
                                    </>
                                  }
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => startEdit(bookmark)}
                                aria-label={`Edit ${bookmark.title}`}
                                className={iconBtn}
                              >
                                <Icon name="pencil" className="size-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(bookmark)}
                                aria-label={`Delete ${bookmark.title}`}
                                className={iconBtnDanger}
                              >
                                <Icon name="trash" className="size-4" />
                              </button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
        )}
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Move to trash"
          heading={`Move “${confirmDelete.title}” to the trash?`}
          body="It can be restored from the trash for 30 days."
          confirmLabel="Move to trash"
          tone="danger"
          busy={saving}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => void removeBookmark(confirmDelete)}
        />
      ) : null}

      {bulk === "delete" ? (
        <ConfirmDialog
          title="Move to trash"
          heading={`Move ${plural(selectedBookmarks.length, "bookmark")} to the trash?`}
          body="They can be restored from the trash for 30 days."
          confirmLabel="Move to trash"
          tone="danger"
          busy={saving}
          error={bulkError}
          onClose={() => setBulk(null)}
          onConfirm={() => void applyBulk()}
        />
      ) : null}

      {bulk && bulk !== "delete" ? (
        <Modal
          title={
            bulk === "addTag" ? "Add tag" : "Remove tag"
          }
          size="sm"
          onClose={() => setBulk(null)}
        >
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void applyBulk();
            }}
          >
            <ModalBody>
            <p className="text-sm text-mute">
              Applies to {plural(selectedBookmarks.length, "bookmark")}.
            </p>
            {bulk === "addTag" ? (
              <label className={`mt-4 ${fieldLabel}`}>
                Tag
                <input
                  autoFocus
                  value={bulkText}
                  onChange={(event) => setBulkText(event.target.value)}
                  list="bookmark-tag-history"
                  className={field}
                />
                <datalist id="bookmark-tag-history">
                  {tagList.map((tag) => (
                    <option key={tag.key} value={tag.name} />
                  ))}
                </datalist>
              </label>
            ) : null}
            {bulk === "removeTag" ? (
              <label className={`mt-4 ${fieldLabel}`}>
                Tag
                <select
                  autoFocus
                  value={bulkText}
                  onChange={(event) => setBulkText(event.target.value)}
                  className={`mt-1.5 ${selectField}`}
                >
                  <option value="">Choose a tag</option>
                  {bulkTagChoices.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {bulkError ? (
              <ErrorMessage size="xs" className="mt-4">
                {bulkError}
              </ErrorMessage>
            ) : null}
            </ModalBody>
            <ModalFooter>
              <button type="button" onClick={() => setBulk(null)} className={btnSecondary}>
                Cancel
              </button>
              <button type="submit" disabled={saving} className={btnPrimary}>
                Apply
              </button>
            </ModalFooter>
          </form>
        </Modal>
      ) : null}

      {deletingCollection ? (
        <ConfirmDialog
          title="Move to trash"
          heading={`Move “${deletingCollection.name}” to the trash?`}
          body="The collection and everything inside it can be restored from the trash for 30 days."
          confirmLabel="Move to trash"
          tone="danger"
          busy={saving}
          onClose={() => setDeletingCollection(null)}
          onConfirm={() => void removeCollection(deletingCollection)}
        />
      ) : null}
    </main>
  );
}
