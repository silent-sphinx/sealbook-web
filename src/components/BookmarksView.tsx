import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { SidebarDrawer, type Sidebar } from "./SidebarDrawer";
import {
  bookmarkFitsObjectLimit,
  bookmarkHost,
  bookmarkMatches,
  buildCollectionTree,
  canMoveCollection,
  collectionSubtree,
  collectionTone,
  DEFAULT_BOOKMARK_COLLECTION_ID,
  emptyBookmarkDraft,
  isValidUrl,
  normalizeTags,
  normalizeUrl,
  resolveCollectionId,
  sortBookmarks,
} from "../lib/bookmark";
import {
  deleteBookmark,
  deleteBookmarkCollection,
  ensureDefaultBookmarkCollection,
  putBookmark,
  putBookmarkCollection,
  type Session,
} from "../lib/client";
import { friendlyError } from "../lib/errors";
import {
  btnPrimary,
  btnSecondary,
  fieldBase,
  focusRing,
  selectField,
} from "../lib/styles";
import { flattenTree, type TreeNode } from "../lib/tree";
import type { Bookmark, BookmarkCollection, BookmarkDraft } from "../lib/types";

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
};

/** Stands for "every collection" in the sidebar, as `ALL_NOTEBOOKS` does for notes. */
const ALL = "all";

/** Marks the dragged id across the native drag events, mirroring `NoteTreeList`. */
const COLLECTION_DRAG_TYPE = "application/x-sealbook-bookmark-collection";

/** Stands for the top level as a drop target, distinct from any real collection id. */
const ROOT_DROP = "__root__";

function Icon({
  name,
  className = "h-3.5 w-3.5",
}: {
  name: string;
  className?: string;
}) {
  const paths: Record<string, string> = {
    plus: "M8 3.5v9M3.5 8h9",
    search:
      "M7.25 12a4.75 4.75 0 1 0 0-9.5 4.75 4.75 0 0 0 0 9.5ZM10.75 10.75 13.5 13.5",
    chevron: "m6 4 4 4-4 4",
    link: "M6.5 9.5a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-.5.5M9.5 6.5a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l.5-.5",
    trash: "M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8",
    pencil: "M11.5 2.5 13.5 4.5 5.5 12.5 3 13l.5-2.5 8-8Z",
  };
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
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
}: Props) {
  const readOnlyMode = readOnly === true;
  const [scope, setScope] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<BookmarkDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tagText, setTagText] = useState("");
  // `undefined` is top level; a collection's own id nests the new one under it.
  // Kept apart from a plain boolean so the header's "+" and a row's "add
  // subcollection" can share one input without either guessing the other's intent.
  const [creatingUnder, setCreatingUnder] = useState<{ parentId?: string } | null>(null);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  // Escape closes the input, which also blurs it. Without this the blur would
  // then save the very text the escape was there to discard.
  const renameCancelled = useRef(false);
  // Collapsed, rather than expanded: a collection added anywhere must show up
  // without first requiring every ancestor to be opened by hand.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [draggingCollection, setDraggingCollection] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const menu = useContextMenu();
  const [confirmDelete, setConfirmDelete] = useState<Bookmark | null>(null);
  const [deletingCollection, setDeletingCollection] =
    useState<BookmarkCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  // A full pass over every bookmark, so the typed value is deferred: the field
  // stays responsive on a vault the filter takes time over.
  const deferredSearch = useDeferredValue(search);

  const collectionTree = useMemo(
    () => buildCollectionTree(collections),
    [collections],
  );

  const rows = useMemo(() => flattenTree(collectionTree), [collectionTree]);

  /**
   * A collection's bookmarks include those of every collection nested under it,
   * so selecting a parent does not read as empty when the links are one level
   * down.
   */
  const scopeIds = useMemo(
    () =>
      scope === ALL ? null : new Set(collectionSubtree(collections, scope)),
    [collections, scope],
  );

  const visible = useMemo(() => {
    const scoped = scopeIds
      ? bookmarks.filter((bookmark) =>
          scopeIds.has(resolveCollectionId(bookmark.collectionId)),
        )
      : bookmarks;
    return sortBookmarks(
      scoped.filter((bookmark) => bookmarkMatches(bookmark, deferredSearch)),
    );
  }, [bookmarks, scopeIds, deferredSearch]);

  const countByCollection = useMemo(() => {
    const counts = new Map<string, number>();
    for (const bookmark of bookmarks) {
      const id = resolveCollectionId(bookmark.collectionId);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [bookmarks]);

  function startAdd() {
    const target = scope === ALL ? DEFAULT_BOOKMARK_COLLECTION_ID : scope;
    setDraft(emptyBookmarkDraft(target));
    setTagText("");
    setEditingId(null);
    setError(null);
  }

  function startEdit(bookmark: Bookmark) {
    setDraft({ ...bookmark });
    setTagText((bookmark.tags ?? []).join(", "));
    setEditingId(bookmark.id);
    setError(null);
  }

  function closeForm() {
    setDraft(null);
    setEditingId(null);
    setTagText("");
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
      // A bookmark saved without a title lists by its URL, so an empty field is
      // not an error worth stopping on.
      title: draft.title.trim() || normalizeUrl(draft.url),
      tags: normalizeTags(tagText.split(",")),
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
        );
      }
      for (const bookmark of bookmarks) {
        if (resolveCollectionId(bookmark.collectionId) !== collection.id)
          continue;
        await putBookmark(
          session,
          {
            ...bookmark,
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

  function startRename(collection: BookmarkCollection) {
    renameCancelled.current = false;
    setRenamingId(collection.id);
    setRenameText(collection.name);
  }

  function toggleCollapsed(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Reveals a collection that a rename, a move or a new child just put a row into. */
  function reveal(id: string) {
    setCollapsedIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  /**
   * Starts the new-collection input. `parentId` is the whole difference between
   * the header's "+", which always starts a top-level collection, and a row's
   * own "Add subcollection", which nests under that row: neither has to guess
   * the other's intent from what happens to be selected.
   */
  function startCreateUnder(parentId?: string) {
    setCreatingUnder({ parentId });
    setNewCollectionName("");
    if (parentId) reveal(parentId);
  }

  function cancelCreateUnder() {
    setCreatingUnder(null);
    setNewCollectionName("");
  }

  /** The same actions the row's own buttons carry, for the context menu. */
  function itemsFor(collection: BookmarkCollection): MenuItem[] {
    if (readOnlyMode) return [];
    const actions: MenuItem[] = [
      {
        label: "Add subcollection",
        onSelect: () => startCreateUnder(collection.id),
      },
      { label: "Rename collection", onSelect: () => startRename(collection) },
    ];
    // The default collection is renamable but not deletable: every bookmark
    // without a collection resolves to its reserved id.
    if (collection.id !== DEFAULT_BOOKMARK_COLLECTION_ID) {
      actions.push({
        label: "Delete collection",
        danger: true,
        onSelect: () => setDeletingCollection(collection),
      });
    }
    return actions;
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

  function cancelRename() {
    renameCancelled.current = true;
    setRenamingId(null);
  }

  /**
   * Renames a collection in place.
   *
   * The stored payload goes back in as `previousRaw`, and the parent is passed
   * through unchanged: a rename must not move a collection, and must not drop a
   * key a newer build put there.
   */
  async function renameCollection(collection: BookmarkCollection) {
    if (renameCancelled.current) {
      renameCancelled.current = false;
      return;
    }
    const name = renameText.trim();
    if (!name || name === collection.name) {
      setRenamingId(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await putBookmarkCollection(
        session,
        name,
        collection.parentId,
        collection.id,
        collection.raw,
      );
      await onRefresh();
      setRenamingId(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function createCollection() {
    const name = newCollectionName.trim();
    if (!name || !creatingUnder) return;
    const id = await onCreateCollection(name, creatingUnder.parentId);
    setNewCollectionName("");
    setCreatingUnder(null);
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
      );
      if (parentId) reveal(parentId);
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
      await putBookmark(session, { ...bookmark, collectionId }, bookmark.id);
      await onRefresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * The collections tree, drawn recursively so each level of nesting is its own
   * indented, left-bordered `<ul>` rather than a flat list padded by a depth
   * number: a guide line under every parent is what actually answers "who is
   * under who," where padding alone reads as the same list redrawn wider.
   *
   * Drag and drop reparents by the same rule the context menu's "Add
   * subcollection" and the header's "Add collection" use to tell a new
   * top-level collection from a nested one: `moveCollection`'s `parentId` is
   * `null` for the top level and a collection's id for everywhere else, and
   * `canMoveCollection` is asked fresh on every row a drag passes over rather
   * than trusted from when the drag started.
   */
  function renderCollectionRows(nodes: TreeNode<BookmarkCollection>[]) {
    return nodes.map((node) => {
      const item = node.item;
      const hasChildren = node.children.length > 0;
      const open = !collapsedIds.has(item.id);
      const isDefault = item.id === DEFAULT_BOOKMARK_COLLECTION_ID;
      const droppable =
        draggingCollection !== null &&
        draggingCollection !== item.id &&
        canMoveCollection(collections, draggingCollection, item.id);

      return (
        <li key={item.id}>
          {renamingId === item.id ? (
            <div className="flex items-center gap-1.5 py-0.5 pl-1">
              <input
                autoFocus
                value={renameText}
                onChange={(event) => setRenameText(event.target.value)}
                onBlur={() => void renameCollection(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void renameCollection(item);
                  if (event.key === "Escape") cancelRename();
                }}
                aria-label={`Rename ${item.name}`}
                className="h-8 w-full min-w-0 rounded-lg border border-line bg-bg px-2.5 text-xs text-text outline-none focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
              />
            </div>
          ) : (
            <div
              draggable={!readOnlyMode}
              onDragStart={(event) => {
                event.dataTransfer.setData(COLLECTION_DRAG_TYPE, item.id);
                event.dataTransfer.effectAllowed = "move";
                setDraggingCollection(item.id);
              }}
              onDragEnd={() => {
                setDraggingCollection(null);
                setDropTarget(null);
              }}
              onDragOver={(event) => {
                if (!droppable) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(item.id);
              }}
              onDragLeave={() =>
                setDropTarget((current) => (current === item.id ? null : current))
              }
              onDrop={(event) => {
                if (!droppable) return;
                event.preventDefault();
                const id = event.dataTransfer.getData(COLLECTION_DRAG_TYPE);
                setDropTarget(null);
                setDraggingCollection(null);
                if (id) void moveCollection(id, item.id);
              }}
              onContextMenu={(event) => menu.open(event, itemsFor(item))}
              className={`list-row flex items-center gap-0.5 rounded-lg transition-colors ${
                dropTarget === item.id ? "ring-1 ring-accent-ring" : ""
              }`}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggleCollapsed(item.id)}
                  aria-label={open ? `Collapse ${item.name}` : `Expand ${item.name}`}
                  aria-expanded={open}
                  className={`flex h-7 w-5 shrink-0 items-center justify-center text-mute transition-colors hover:text-text ${focusRing}`}
                >
                  <Icon
                    name="chevron"
                    className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
                  />
                </button>
              ) : (
                <span aria-hidden="true" className="h-7 w-5 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => setScope(item.id)}
                onDoubleClick={() => {
                  if (!readOnlyMode) startRename(item);
                }}
                aria-current={scope === item.id ? "true" : undefined}
                className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pr-2 text-left text-xs transition-colors ${
                  scope === item.id
                    ? "bg-surface text-text"
                    : "text-mute hover:bg-surface/40 hover:text-text"
                } ${focusRing}`}
              >
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 rounded-full"
                  style={{ background: collectionTone(item.id) }}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                <span className="text-[10px] tabular-nums text-mute/70">
                  {countByCollection.get(item.id) || ""}
                </span>
              </button>
              {!readOnlyMode ? (
                <div className="list-row-actions flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => startCreateUnder(item.id)}
                    title="Add subcollection"
                    aria-label={`Add subcollection under ${item.name}`}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                  >
                    <Icon name="plus" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startRename(item)}
                    aria-label={`Rename ${item.name}`}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                  >
                    <Icon name="pencil" />
                  </button>
                  {/* The default collection can be renamed but not deleted: it
                      is the id that is reserved, not the name, and every
                      bookmark without a collection resolves to it. */}
                  {!isDefault ? (
                    <button
                      type="button"
                      onClick={() => setDeletingCollection(item)}
                      aria-label={`Delete ${item.name}`}
                      className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-danger ${focusRing}`}
                    >
                      <Icon name="trash" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {creatingUnder && creatingUnder.parentId === item.id ? (
            <div className="ml-5 flex items-center gap-1.5 border-l border-line py-0.5 pl-2.5">
              <input
                autoFocus
                value={newCollectionName}
                onChange={(event) => setNewCollectionName(event.target.value)}
                onBlur={() => {
                  if (!newCollectionName.trim()) cancelCreateUnder();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createCollection();
                  if (event.key === "Escape") cancelCreateUnder();
                }}
                placeholder="Subcollection name"
                aria-label={`New subcollection under ${item.name}`}
                className="h-8 w-full min-w-0 rounded-lg border border-line bg-bg px-2.5 text-xs text-text outline-none focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
              />
              <button
                type="button"
                onClick={() => void createCollection()}
                className={`flex h-8 shrink-0 items-center rounded-lg bg-accent px-2.5 text-xs font-semibold text-bg ${focusRing}`}
              >
                Add
              </button>
            </div>
          ) : null}

          {hasChildren && open ? (
            <ul className="ml-5 mt-0.5 space-y-0.5 border-l border-line pl-2.5">
              {renderCollectionRows(node.children)}
            </ul>
          ) : null}
        </li>
      );
    });
  }

  const rootDroppable =
    draggingCollection !== null && canMoveCollection(collections, draggingCollection, null);

  const disabled = busy || saving || readOnlyMode;

  return (
    <main className="flex h-[calc(100dvh-var(--sb-header-h,74px))] flex-col overflow-hidden bg-bg pb-[env(safe-area-inset-bottom)] text-text lg:pb-0">
      <ContextMenu state={menu.menu} onClose={menu.close} />
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
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
              My links
            </p>
            <h2 className="mt-1 text-lg font-semibold">Bookmarks</h2>
          </div>

          <div className="mt-5">
            <div className="relative min-w-0 flex-1">
              <Icon
                name="search"
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mute"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search bookmarks"
                aria-label="Search bookmarks"
                className="h-8 w-full min-w-0 rounded-lg border border-line bg-bg pl-8 pr-2.5 text-xs text-text outline-none transition-colors placeholder:text-mute/70 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
              />
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
                Collections
              </p>
              {!readOnlyMode ? (
                <button
                  type="button"
                  onClick={() => startCreateUnder(undefined)}
                  title="Add a top-level collection"
                  className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                  aria-label="Add collection"
                >
                  <Icon name="plus" />
                </button>
              ) : null}
            </div>

            <ul className="mt-2 space-y-0.5">
              <li>
                <button
                  type="button"
                  onClick={() => setScope(ALL)}
                  aria-current={scope === ALL ? "true" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${
                    scope === ALL
                      ? "bg-surface text-text"
                      : "text-mute hover:bg-surface/40 hover:text-text"
                  } ${focusRing}`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">All bookmarks</span>
                  <span className="text-[10px] tabular-nums text-mute/70">
                    {bookmarks.length || ""}
                  </span>
                </button>
              </li>
              {renderCollectionRows(collectionTree)}
            </ul>

            {/* Shown only while dragging, or it would sit as a permanent band
                of empty space under a tree that is usually fully nested. */}
            {rootDroppable ? (
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropTarget(ROOT_DROP);
                }}
                onDragLeave={() =>
                  setDropTarget((current) => (current === ROOT_DROP ? null : current))
                }
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData(COLLECTION_DRAG_TYPE);
                  setDropTarget(null);
                  setDraggingCollection(null);
                  if (id) void moveCollection(id, null);
                }}
                className={`mt-1 rounded-lg border border-dashed px-3 py-1.5 text-center text-[10px] transition-colors ${
                  dropTarget === ROOT_DROP ? "border-accent-dim text-text" : "border-line text-mute"
                }`}
              >
                Move to top level
              </div>
            ) : null}

            {creatingUnder && creatingUnder.parentId === undefined ? (
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  autoFocus
                  value={newCollectionName}
                  onChange={(event) => setNewCollectionName(event.target.value)}
                  onBlur={() => {
                    if (!newCollectionName.trim()) cancelCreateUnder();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createCollection();
                    if (event.key === "Escape") cancelCreateUnder();
                  }}
                  placeholder="Collection name"
                  aria-label="New collection name"
                  className="h-8 w-full min-w-0 rounded-lg border border-line bg-bg px-2.5 text-xs text-text outline-none focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
                />
                <button
                  type="button"
                  onClick={() => void createCollection()}
                  className={`flex h-8 shrink-0 items-center rounded-lg bg-accent px-2.5 text-xs font-semibold text-bg ${focusRing}`}
                >
                  Add
                </button>
              </div>
            ) : null}
          </div>
        </SidebarDrawer>

        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3 lg:px-6">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">
                {scope === ALL
                  ? "All bookmarks"
                  : (collections.find((item) => item.id === scope)?.name ??
                    "Bookmarks")}
              </h3>
              <p className="text-xs text-mute">
                {visible.length}{" "}
                {visible.length === 1 ? "bookmark" : "bookmarks"}
              </p>
            </div>
            {!readOnlyMode ? (
              <button
                type="button"
                onClick={startAdd}
                disabled={disabled}
                className={btnPrimary}
              >
                <Icon name="plus" />
                Add<span className="hidden sm:inline">&nbsp;bookmark</span>
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 lg:px-6">
            {draft ? (
              <form
                className="mb-4 rounded-2xl border border-line bg-panel/80 p-4"
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
                <label className="mt-3 block text-xs text-mute">
                  Tags
                  <input
                    value={tagText}
                    onChange={(event) => setTagText(event.target.value)}
                    placeholder="Comma separated"
                    className={`mt-1.5 ${fieldBase}`}
                  />
                </label>
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

            {visible.length === 0 ? (
              <p className="py-12 text-center text-sm text-mute">
                {search.trim()
                  ? "No bookmarks match that search."
                  : "No bookmarks here yet. Saved links are encrypted on this device before they leave it."}
              </p>
            ) : (
              <ul className="space-y-1">
                {visible.map((bookmark) => (
                  <li key={bookmark.id}>
                    <div
                      className="list-row flex items-center gap-2 rounded-xl border border-transparent px-3 py-2.5 transition-colors hover:border-line hover:bg-panel/60 sm:gap-3"
                      onContextMenu={(event) =>
                        menu.open(event, bookmarkItemsFor(bookmark))
                      }
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: collectionTone(
                            resolveCollectionId(bookmark.collectionId),
                          ),
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <a
                          href={bookmark.url || undefined}
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
                      {!readOnlyMode ? (
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
                            className={`hidden h-8 max-w-[9rem] cursor-pointer rounded-lg border border-line bg-bg pl-2 pr-8 text-xs text-mute sm:block ${focusRing}`}
                          >
                            {rows.map(({ item, depth }) => (
                              <option key={item.id} value={item.id}>
                                {`${"— ".repeat(depth)}${item.name}`}
                              </option>
                            ))}
                          </select>
                          <div className="list-row-actions flex shrink-0 items-center gap-0.5">
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
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete bookmark"
          heading="Delete bookmark"
          body={`"${confirmDelete.title}" will be removed from every device signed in to this account.`}
          confirmLabel="Delete"
          tone="danger"
          busy={saving}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => void removeBookmark(confirmDelete)}
        />
      ) : null}

      {deletingCollection ? (
        <ConfirmDialog
          title="Delete collection"
          heading="Delete collection"
          body={`"${deletingCollection.name}" will be removed. The bookmarks and collections inside it are kept and move up one level.`}
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
