import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { CollectionIcon } from "./AppIcons";
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
  sortBookmarks,
  sortCollections,
} from "../lib/bookmark";
import {
  deleteBookmark,
  deleteBookmarkCollection,
  deleteBookmarks,
  ensureDefaultBookmarkCollection,
  putBookmark,
  putBookmarkCollection,
  putBookmarks,
  RefusedWrites,
  type Session,
} from "../lib/client";
import { friendlyError } from "../lib/errors";
import {
  btnHeader,
  btnPrimary,
  btnSecondary,
  checkbox,
  eyebrow,
  field,
  fieldBase,
  fieldLabel,
  focusRing,
  paneCount,
  paneHeader,
  paneTitle,
  primary,
  searchClear,
  searchField,
  searchIcon,
  secondary,
  selectField,
  sidebarCount,
  sidebarHeaderAction,
  sidebarMark,
  sidebarRowState,
  sidebarSectionAction,
} from "../lib/styles";
import { flattenTree } from "../lib/tree";
import type { Bookmark, BookmarkCollection, BookmarkDraft } from "../lib/types";
import { Icon } from "./Icon";
import { TagsInput } from "./FieldControls";
import { ErrorMessage } from "./ErrorMessage";
import { Modal } from "./Modal";
import { EmptyState } from "./EmptyState";

type Props = {
  session: Session;
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

type BulkKind = "addTag" | "removeTag" | "move" | "delete";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function BookmarksView({
  session,
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
  const [draft, setDraft] = useState<BookmarkDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const menu = useContextMenu();
  const [confirmDelete, setConfirmDelete] = useState<Bookmark | null>(null);
  const [deletingCollection, setDeletingCollection] =
    useState<BookmarkCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkKind | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkCollection, setBulkCollection] = useState(DEFAULT_BOOKMARK_COLLECTION_ID);
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

  /**
   * Bookmarks directly in the selected collection, not those of a collection
   * nested under it: a subcollection's own links are reached from the sidebar,
   * so the two views never show the same bookmark twice.
   */
  const hiddenFromAll = useMemo(() => hiddenFromAllIds(collectionTree), [collectionTree]);

  const visible = useMemo(() => {
    const scoped =
      scope === ALL
        ? bookmarks.filter(
            (bookmark) =>
              !hiddenFromAll.has(resolveCollectionId(bookmark.collectionId)),
          )
        : bookmarks.filter(
            (bookmark) => resolveCollectionId(bookmark.collectionId) === scope,
          );
    const tagged = tagFilter
      ? scoped.filter((bookmark) =>
          bookmark.tags?.some((tag) => tag.toLowerCase() === tagFilter),
        )
      : scoped;
    return sortBookmarks(
      tagged.filter((bookmark) => bookmarkMatches(bookmark, deferredSearch)),
    );
  }, [bookmarks, scope, deferredSearch, hiddenFromAll, tagFilter]);

  // Keyed by lowercase so "Rust" and "rust" are one tag, as normalizeTags treats them.
  const tagList = useMemo(() => {
    const found = new Map<string, { name: string; count: number }>();
    for (const bookmark of bookmarks) {
      for (const tag of bookmark.tags ?? []) {
        const key = tag.toLowerCase();
        const entry = found.get(key);
        if (entry) entry.count += 1;
        else found.set(key, { name: tag, count: 1 });
      }
    }
    return [...found.entries()]
      .map(([key, { name, count }]) => ({ key, name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [bookmarks]);

  /** The first spelling a tag was saved with wins, so "Rust" never sits beside "rust". */
  function canonicalTag(tag: string): string {
    return tagList.find((known) => known.key === tag.trim().toLowerCase())?.name ?? tag.trim();
  }

  useEffect(() => {
    if (tagFilter && !tagList.some((tag) => tag.key === tagFilter)) setTagFilter(null);
  }, [tagList, tagFilter]);

  // Selection never outlives what is on screen: moving scope or narrowing the
  // search must not leave a bulk action aimed at rows the user cannot see.
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const shown = new Set(visible.map((bookmark) => bookmark.id));
      const kept = [...current].filter((id) => shown.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [visible]);

  // Narrowing the view can empty a selection the user never cleared by hand.
  const hadSelection = useRef(false);
  useEffect(() => {
    if (selected.size > 0) hadSelection.current = true;
    else if (hadSelection.current) {
      hadSelection.current = false;
      setSelecting(false);
    }
  }, [selected]);

  useEffect(() => {
    if (!selecting || bulk) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") endSelecting();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, bulk]);

  useEffect(() => {
    if (readOnlyMode || bulk || draft) return;
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "a") return;
      const target = event.target as HTMLElement | null;
      // Leave text editing and open dialogs to the browser's own select-all.
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      if (document.querySelector("[role='dialog']")) return;
      if (visible.length === 0) return;
      event.preventDefault();
      if (selecting && selected.size === visible.length) {
        endSelecting();
        return;
      }
      setSelecting(true);
      setSelected(new Set(visible.map((bookmark) => bookmark.id)));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnlyMode, bulk, draft, visible, selecting, selected]);

  const selectedBookmarks = useMemo(
    () => visible.filter((bookmark) => selected.has(bookmark.id)),
    [visible, selected],
  );

  const countByCollection = useMemo(() => {
    const counts = new Map<string, number>();
    for (const bookmark of bookmarks) {
      const id = resolveCollectionId(bookmark.collectionId);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [bookmarks]);

  const topCollections = useMemo(
    () => (scope === ALL ? collectionTree.map((node) => node.item) : []),
    [collectionTree, scope],
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

  function endSelecting() {
    setSelecting(false);
    setSelected(new Set());
    setAnchorId(null);
  }

  function beginSelecting(bookmark: Bookmark) {
    setSelecting(true);
    setSelected(new Set([bookmark.id]));
    setAnchorId(bookmark.id);
  }

  /** Plain click toggles; Shift+click adds the run between it and the last click. */
  function toggleSelected(bookmark: Bookmark, extend: boolean) {
    const next = new Set(selected);
    const from = extend && anchorId ? visible.findIndex((item) => item.id === anchorId) : -1;
    if (from >= 0) {
      const to = visible.findIndex((item) => item.id === bookmark.id);
      const [low, high] = from < to ? [from, to] : [to, from];
      for (const item of visible.slice(low, high + 1)) next.add(item.id);
    } else if (next.has(bookmark.id)) {
      next.delete(bookmark.id);
    } else {
      next.add(bookmark.id);
    }
    if (next.size === 0) {
      endSelecting();
      return;
    }
    setSelected(next);
    setAnchorId(bookmark.id);
  }

  function toggleAll() {
    if (selected.size === visible.length) endSelecting();
    else setSelected(new Set(visible.map((bookmark) => bookmark.id)));
  }

  function openBulk(kind: BulkKind) {
    setBulk(kind);
    setBulkText("");
    setBulkError(null);
    setBulkCollection(
      visible.length > 0 ? resolveCollectionId(selectedBookmarks[0]?.collectionId) : DEFAULT_BOOKMARK_COLLECTION_ID,
    );
  }

  function bulkItems(): MenuItem[] {
    const none = selected.size === 0;
    const count = plural(selected.size, "bookmark");
    const disabledReason = "Select bookmarks first";
    return [
      { label: `Add tag to ${count}`, disabled: none, disabledReason, onSelect: () => openBulk("addTag") },
      { label: `Remove tag from ${count}`, disabled: none, disabledReason, onSelect: () => openBulk("removeTag") },
      { label: `Move ${count} to collection`, disabled: none, disabledReason, onSelect: () => openBulk("move") },
      { label: `Delete ${count}`, danger: true, disabled: none, disabledReason, onSelect: () => openBulk("delete") },
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
    } else if (bulk === "move") {
      writes = writable
        .filter((bookmark) => resolveCollectionId(bookmark.collectionId) !== bulkCollection)
        .map((bookmark) => ({
          id: bookmark.id,
          draft: { ...bookmarkDraft(bookmark), collectionId: bulkCollection },
        }));
    }
    setSaving(true);
    setError(null);
    try {
      if (bulk === "delete") {
        await deleteBookmarks(session, selectedBookmarks.map((bookmark) => bookmark.id));
      } else {
        await putBookmarks(session, writes);
      }
      await onRefresh();
      setBulk(null);
      endSelecting();
      const changed = bulk === "delete" ? selectedBookmarks.length : writes.length;
      const parts = [`${plural(changed, "bookmark")} ${bulk === "delete" ? "deleted" : "updated"}`];
      if (skipped > 0) parts.push(`${skipped} skipped: saved by a newer version of Sealbook`);
      setNotice(`${parts.join(", ")}.`);
    } catch (err) {
      if (err instanceof RefusedWrites) {
        await onRefresh();
        setSelected(new Set(err.refused.keys()));
      }
      setBulkError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  function bookmarkMenuFor(bookmark: Bookmark): MenuItem[] {
    if (readOnlyMode) return [];
    if (selected.has(bookmark.id) && selected.size > 1) return bulkItems();
    const [edit, ...rest] = bookmarkItemsFor(bookmark);
    return [
      edit!,
      {
        label: "Select",
        onSelect: () => (selecting ? toggleSelected(bookmark, false) : beginSelecting(bookmark)),
      },
      ...rest,
    ];
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
      await deleteBookmark(session, bookmark.id);
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
   * Deletes a collection and moves what it held up to its parent, rather than
   * cascading.
   *
   * Taking a subtree of saved links out behind one confirm dialog is the wrong
   * default when the vault has no undo: the collection goes, its contents stay.
   */
  async function removeCollection(collection: BookmarkCollection) {
    setSaving(true);
    setError(null);
    const parentId = collection.parentId;
    try {
      for (const child of collections) {
        if (child.parentId !== collection.id) continue;
        await putBookmarkCollection(
          session,
          child.name,
          parentId,
          child.id,
          child.raw,
          child.color,
        );
      }
      for (const bookmark of bookmarks) {
        if (resolveCollectionId(bookmark.collectionId) !== collection.id)
          continue;
        await putBookmark(
          session,
          {
            ...bookmarkDraft(bookmark),
            collectionId: parentId ?? DEFAULT_BOOKMARK_COLLECTION_ID,
          },
          bookmark.id,
        );
      }
      await deleteBookmarkCollection(session, collection.id);
      await onRefresh();
      if (scope === collection.id) setScope(parentId ?? ALL);
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
        label: collection.hideFromAll ? "Show in All Bookmarks" : "Hide from All Bookmarks",
        onSelect: () => void toggleHideFromAll(collection),
      },
    ];
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

  const disabled = busy || saving || readOnlyMode;

  return (
    <main className="flex h-[calc(100dvh-var(--sb-header-h,74px))] flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] text-text lg:pb-0">
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

      <div className="sb-shell grid min-h-0 flex-1" style={sidebar.cols}>
        <SidebarDrawer title="Bookmarks" sidebar={sidebar}>
          <SidebarHeader
            eyebrow="My links"
            title="Bookmarks"
            action={
              !readOnlyMode ? (
                <button
                  type="button"
                  onClick={() => {
                    startAdd();
                    sidebar.close();
                  }}
                  disabled={disabled}
                  aria-label="Create bookmark"
                  title="Create bookmark"
                  className={sidebarHeaderAction}
                >
                  <Icon name="plus" className="h-4 w-4" />
                </button>
              ) : null
            }
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
              className={`-mx-2 mt-2.5 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${sidebarRowState(
                scope === ALL,
              )} ${focusRing}`}
            >
              <span className={sidebarMark}>
                <CollectionIcon kind="bookmark" />
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
              canMove={(id, parentId) => canMoveCollection(collections, id, parentId)}
              onMove={moveCollection}
              extraMenuItems={collectionExtras}
              readOnly={readOnlyMode}
              busy={busy || saving}
            />
          </SidebarSection>
        </SidebarDrawer>

        <section className="flex min-h-0 flex-col overflow-hidden">
          <header className={paneHeader}>
            <div className="flex min-w-0 items-center gap-2">
              <h1 className={paneTitle}>
                {scope === ALL
                  ? "All bookmarks"
                  : (collections.find((item) => item.id === scope)?.name ??
                    "Bookmarks")}
              </h1>
              <span
                className={paneCount}
                title={`${visible.length} bookmark${visible.length === 1 ? "" : "s"}`}
              >
                {visible.length}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              {!readOnlyMode && !selecting ? (
                <button
                  type="button"
                  onClick={() => startAdd()}
                  disabled={disabled}
                  className={btnHeader}
                >
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">New bookmark</span>
                  <span className="sm:hidden">New</span>
                </button>
              ) : null}
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Icon
                  name="search"
                  className={searchIcon}
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search bookmarks"
                  aria-label="Search bookmarks"
                  className={`${searchField} sm:w-52 sm:focus:w-72`}
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
            </div>
          </header>

          {selecting ? (
            <div className="flex shrink-0 items-center gap-3 border-b border-line bg-panel/60 px-4 py-2 lg:px-6">
              <input
                type="checkbox"
                ref={(node) => {
                  if (node) node.indeterminate = selected.size > 0 && selected.size < visible.length;
                }}
                checked={visible.length > 0 && selected.size === visible.length}
                onChange={toggleAll}
                aria-label="Select all bookmarks"
                className={checkbox}
              />
              <span className="min-w-0 flex-1 text-xs text-mute" aria-live="polite">
                {selected.size} selected
              </span>
              <button
                type="button"
                onClick={(event) => menu.open(event, bulkItems())}
                disabled={disabled}
                aria-haspopup="menu"
                className={btnHeader}
              >
                <span>Actions</span>
                <Icon name="chevron" className="h-3 w-3 rotate-90" />
              </button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 lg:px-6">
            {draft ? (
              <form
                className="mb-4 rounded-2xl border border-line bg-panel/80 p-4"
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
                  {topCollections.map((collection) => (
                    <button
                      key={collection.id}
                      type="button"
                      onClick={() => setScope(collection.id)}
                      aria-label={`Open ${collection.name}`}
                      className={`flex items-center gap-2.5 rounded-xl border border-line bg-panel/60 px-3 py-2.5 text-left transition-colors hover:border-line-light hover:bg-panel ${focusRing}`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ background: collectionTone(collections, collection.id) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">
                        {collection.name}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-mute">
                        {countByCollection.get(collection.id) || ""}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!search.trim() && scope === ALL && tagList.length > 0 ? (
              <div className="mb-5">
                <p className={`mb-2 ${eyebrow}`}>Tags</p>
                <div className="flex flex-wrap gap-2">
                  {tagList.map((tag) => {
                    const active = tagFilter === tag.key;
                    return (
                      <button
                        key={tag.key}
                        type="button"
                        onClick={() => setTagFilter(active ? null : tag.key)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${focusRing} ${
                          active
                            ? "border-accent-dim bg-accent/15 text-text"
                            : "border-line bg-panel/60 text-text hover:border-line-light hover:bg-panel"
                        }`}
                      >
                        <span className="font-medium">{tag.name}</span>
                        <span className="text-[10px] tabular-nums text-mute">{tag.count}</span>
                      </button>
                    );
                  })}
                </div>
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
                <EmptyState
                  title="No bookmarks here yet"
                  body="Saved links are encrypted on this device before they leave it."
                />
              )
            ) : (
              <ul className="divide-y divide-line/60 border-y border-line/60">
                {visible.map((bookmark) => {
                  const tone = collectionTone(collections, resolveCollectionId(bookmark.collectionId));
                  return (
                  <li key={bookmark.id}>
                    {/* The row click is a pointer shortcut; the checkbox inside is the
                        keyboard path, and its click bubbles here. */}
                    {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                    <div
                      data-bookmark-id={bookmark.id}
                      className={`list-row flex items-center gap-2 px-3 py-2.5 transition-colors sm:gap-3 ${highlightId === bookmark.id ? "bg-surface/70" : "hover:bg-surface/40"}`}
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
                      <a
                        href={bookmarkHref(bookmark.url)}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`Open ${bookmark.title}`}
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                      >
                        <Icon name="link" />
                      </a>
                      {!readOnlyMode && !selecting ? (
                        <>
                          <select
                            value={resolveCollectionId(bookmark.collectionId)}
                            onChange={(event) =>
                              void moveBookmark(bookmark, event.target.value)
                            }
                            aria-label={`Collection for ${bookmark.title}`}
                            // `pr-8` rather than the shared token's `pr-6`: the
                            // native arrow is drawn wider in Firefox, and at this
                            // size the name runs under it.
                            className={`h-8 max-w-[6.5rem] shrink-0 cursor-pointer rounded-lg border border-line bg-bg pl-2 pr-8 text-xs text-mute sm:max-w-[9rem] ${focusRing}`}
                          >
                            {rows.map(({ item, depth }) => (
                              <option key={item.id} value={item.id}>
                                {`${"— ".repeat(depth)}${item.name}`}
                              </option>
                            ))}
                          </select>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => startEdit(bookmark)}
                              aria-label={`Edit ${bookmark.title}`}
                              className={`flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                            >
                              <Icon name="pencil" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(bookmark)}
                              aria-label={`Delete ${bookmark.title}`}
                              className={`flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-danger ${focusRing}`}
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete bookmark"
          heading={`Delete “${confirmDelete.title}”?`}
          body="It will be removed from every device signed in to this account."
          confirmLabel="Delete"
          tone="danger"
          busy={saving}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => void removeBookmark(confirmDelete)}
        />
      ) : null}

      {bulk === "delete" ? (
        <ConfirmDialog
          title="Delete bookmarks"
          heading={`Delete ${plural(selectedBookmarks.length, "bookmark")}?`}
          body="They will be removed from every device signed in to this account."
          confirmLabel="Delete"
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
            bulk === "addTag" ? "Add tag" : bulk === "removeTag" ? "Remove tag" : "Move to collection"
          }
          onClose={() => setBulk(null)}
        >
          <form
            className="p-6"
            onSubmit={(event) => {
              event.preventDefault();
              void applyBulk();
            }}
          >
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
            {bulk === "move" ? (
              <label className={`mt-4 ${fieldLabel}`}>
                Collection
                <select
                  autoFocus
                  value={bulkCollection}
                  onChange={(event) => setBulkCollection(event.target.value)}
                  className={`mt-1.5 ${selectField}`}
                >
                  {rows.map(({ item, depth }) => (
                    <option key={item.id} value={item.id}>
                      {`${"— ".repeat(depth)}${item.name}`}
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
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setBulk(null)} className={`${secondary} flex-1`}>
                Cancel
              </button>
              <button type="submit" disabled={saving} className={`${primary} flex-1`}>
                Apply
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {deletingCollection ? (
        <ConfirmDialog
          title="Delete collection"
          heading={`Delete “${deletingCollection.name}”?`}
          body={`The collection will be removed. The bookmarks and collections inside it are kept and move up one level.`}
          confirmLabel="Delete"
          tone="danger"
          busy={saving}
          onClose={() => setDeletingCollection(null)}
          onConfirm={() => void removeCollection(deletingCollection)}
        />
      ) : null}
    </main>
  );
}
