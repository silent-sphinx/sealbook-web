import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { CollectionIcon } from "./AppIcons";
import { CollectionSidebar } from "./CollectionSidebar";
import { SidebarDrawer, SidebarHeader, SidebarSection, type Sidebar } from "./SidebarDrawer";
import {
  bookmarkFitsObjectLimit,
  bookmarkHost,
  bookmarkMatches,
  buildCollectionTree,
  canMoveCollection,
  bookmarkDraft,
  collectionTone,
  DEFAULT_BOOKMARK_COLLECTION_ID,
  emptyBookmarkDraft,
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
  sidebarCount,
  sidebarHeaderAction,
  sidebarMark,
  sidebarRowState,
  sidebarSectionAction,
} from "../lib/styles";
import { flattenTree } from "../lib/tree";
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
    close: "M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5",
    bookmark: "M4.5 2.5h7v11L8 10.75 4.5 13.5v-11Z",
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
  const [creatingCollection, setCreatingCollection] = useState(false);
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
   * Bookmarks directly in the selected collection, not those of a collection
   * nested under it: a subcollection's own links are reached from the sidebar,
   * so the two views never show the same bookmark twice.
   */
  const hiddenFromAll = useMemo(() => {
    const hidden = new Set<string>();
    const walk = (nodes: typeof collectionTree, inherited: boolean) => {
      for (const node of nodes) {
        const hide = inherited || node.item.hideFromAll === true;
        if (hide) hidden.add(node.item.id);
        walk(node.children, hide);
      }
    };
    walk(collectionTree, false);
    return hidden;
  }, [collectionTree]);

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
    return sortBookmarks(
      scoped.filter((bookmark) => bookmarkMatches(bookmark, deferredSearch)),
    );
  }, [bookmarks, scope, deferredSearch, hiddenFromAll]);

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
    setTagText("");
    setEditingId(null);
    setError(null);
  }

  function startEdit(bookmark: Bookmark) {
    setDraft(bookmarkDraft(bookmark));
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
      title: draft.title.trim(),
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
          <header className="flex flex-col gap-2.5 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-3.5 lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-tight">
                {scope === ALL
                  ? "All bookmarks"
                  : (collections.find((item) => item.id === scope)?.name ??
                    "Bookmarks")}
              </h1>
              <span
                className="ml-1 shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-mute"
                title={`${visible.length} bookmark${visible.length === 1 ? "" : "s"}`}
              >
                {visible.length}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              {!readOnlyMode ? (
                <button
                  type="button"
                  onClick={() => startAdd()}
                  disabled={disabled}
                  className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 ${focusRing}`}
                >
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">New bookmark</span>
                  <span className="sm:hidden">New</span>
                </button>
              ) : null}
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mute"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search bookmarks"
                  aria-label="Search bookmarks"
                  className="h-8 w-full rounded-xl border border-line bg-panel pl-8 pr-7 text-xs text-text outline-none transition-colors duration-150 placeholder:text-mute/60 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring sm:w-52"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className={`absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    <Icon name="close" className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            </div>
          </header>

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

            {/* Hidden during a search: the cards below are not filtered by
                it, and showing an unrelated grid above a text search's
                results reads as broken rather than as a shortcut. */}
            {!search.trim() && topCollections.length > 0 ? (
              <div className="mb-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
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

            {!search.trim() && topCollections.length > 0 ? (
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
                Bookmarks
              </p>
            ) : null}

            {visible.length === 0 ? (
              <p className="py-12 text-center text-sm text-mute">
                {search.trim()
                  ? "No bookmarks match that search."
                  : "No bookmarks here yet. Saved links are encrypted on this device before they leave it."}
              </p>
            ) : (
              <ul className="divide-y divide-line/60 border-y border-line/60">
                {visible.map((bookmark) => (
                  <li key={bookmark.id}>
                    <div
                      data-bookmark-id={bookmark.id}
                      className="list-row flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-panel/60 sm:gap-3"
                      onContextMenu={(event) =>
                        menu.open(event, bookmarkItemsFor(bookmark))
                      }
                    >
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: collectionTone(
                            collections,
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
                      <a
                        href={bookmark.url || undefined}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`Open ${bookmark.title}`}
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                      >
                        <Icon name="link" />
                      </a>
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
