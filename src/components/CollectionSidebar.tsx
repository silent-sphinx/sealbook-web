import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  focusRing,
  sidebarChildren,
  sidebarCount,
  sidebarMark,
  sidebarNameInput,
  sidebarRowAction,
  sidebarRowState,
  sidebarSubgroup,
} from "../lib/styles";
import { archivedIds, hiddenIds } from "../lib/archive";
import { ancestorsOf, buildTree, type TreeNode } from "../lib/tree";
import { CollectionIcon, type CollectionKind } from "./AppIcons";
import { ColourPalette, type PaletteState } from "./ColourPalette";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { Icon } from "./Icon";
import { PencilMark, PlusMark, TrashMark } from "./SidebarTree";

export type SidebarCollection = {
  id: string;
  name: string;
  parentId?: string;
  archived?: boolean;
  hideFromAll?: boolean;
};

type Props<C extends SidebarCollection> = {
  collections: C[];
  /** Orders siblings; collections keep the order given when absent. */
  sort?: (siblings: C[]) => C[];
  /** The current scope, which may name something other than a collection. */
  selectedId: string;
  onSelect: (id: string) => void;
  icon: CollectionKind;
  /** Lower case: "notebook", "list", "collection". */
  kindLabel: string;
  /** Lower case: "sublist", "subcollection". */
  subLabel?: string;
  tone: (collection: C) => string;
  /** The reserved default, which has no delete action. */
  protectedId: string;
  counts: ReadonlyMap<string, number>;
  /** Set by the section's own "+"; cleared through `onCreateHandled`. */
  creating: boolean;
  onCreateHandled: () => void;
  onCreate: (name: string, parentId?: string) => Promise<unknown> | void;
  onRename: (collection: C, name: string) => Promise<unknown> | void;
  onDelete: (collection: C) => void;
  /**
   * Both are needed for the archive. An archived collection, and any nested
   * under it, leaves the tree for a group of its own at the foot.
   */
  onArchive?: (collection: C) => void;
  onRestore?: (collection: C) => void;
  /**
   * Hides a collection from the overview, or shows it again. A hidden one, and
   * any nested under it, stays listed and openable, drawn dimmer.
   */
  onToggleHidden?: (collection: C) => void;
  onRecolor?: (collection: C, color: string) => Promise<unknown> | void;
  /** Both are needed for nesting; without them collections stay flat. */
  canMove?: (id: string, parentId: string | null) => boolean;
  onMove?: (id: string, parentId: string | null) => Promise<unknown> | void;
  extraMenuItems?: (collection: C) => MenuItem[];
  /** Lets a drag that starts outside the sidebar, such as a bookmark, land on a row. */
  externalDrop?: {
    canDrop: (collectionId: string) => boolean;
    onDrop: (collectionId: string) => void;
  };
  /** Drawn under an open collection, after its subcollections. */
  renderContents?: (collection: C) => ReactNode;
  readOnly?: boolean;
  busy?: boolean;
};

const DRAG_TYPE = "application/x-sealbook-collection";
const ROOT_DROP = "__root__";

export function CollectionSidebar<C extends SidebarCollection>({
  collections,
  sort = keepOrder,
  selectedId,
  onSelect,
  icon,
  kindLabel,
  subLabel,
  tone,
  protectedId,
  counts,
  creating,
  onCreateHandled,
  onCreate,
  onRename,
  onDelete,
  onArchive,
  onRestore,
  onToggleHidden,
  onRecolor,
  canMove,
  onMove,
  extraMenuItems,
  externalDrop,
  renderContents,
  readOnly = false,
  busy = false,
}: Props<C>) {
  const nesting = Boolean(canMove && onMove);
  const archiving = Boolean(onArchive && onRestore);
  const { live, archivedRoots } = useMemo(() => splitArchive(collections), [collections]);
  const tree = useMemo(() => buildTree(live, sort), [live, sort]);
  const hidden = useMemo(() => hiddenIds(collections), [collections]);
  const archivedSorted = useMemo(() => sort(archivedRoots), [archivedRoots, sort]);
  const selectedArchived = archivedRoots.some(
    (root) => root.id === selectedId || ancestorsOf(collections, selectedId).includes(root.id),
  );
  const [archivedOpen, setArchivedOpen] = useState(false);
  const open = useMemo(
    () => new Set([selectedId, ...ancestorsOf(collections, selectedId)]),
    [collections, selectedId],
  );

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const committing = useRef(false);
  const cancelled = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [palette, setPalette] = useState<PaletteState>(null);
  const recoloring = useRef<C | null>(null);
  const menuAt = useRef({ x: 0, y: 0 });
  const menu = useContextMenu();

  const creatingTop = creating && !readOnly;

  useEffect(() => {
    if (creating) {
      setDraft("");
      setRenamingId(null);
      setCreatingUnder(null);
    }
  }, [creating]);

  const closePalette = useCallback(() => setPalette(null), []);

  function reset() {
    setRenamingId(null);
    setCreatingUnder(null);
    setDraft("");
    onCreateHandled();
  }

  async function commit(target: C | null) {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (committing.current) return;
    const name = draft.trim();
    if (!name || (target && name === target.name)) {
      reset();
      return;
    }
    committing.current = true;
    const parentId = creatingUnder ?? undefined;
    reset();
    try {
      if (target) await onRename(target, name);
      else await onCreate(name, parentId);
    } finally {
      committing.current = false;
    }
  }

  function startRename(collection: C) {
    onCreateHandled();
    setCreatingUnder(null);
    setRenamingId(collection.id);
    setDraft(collection.name);
  }

  function startCreateUnder(collection: C) {
    onCreateHandled();
    setRenamingId(null);
    setCreatingUnder(collection.id);
    setDraft("");
    if (!open.has(collection.id)) onSelect(collection.id);
  }

  function pickColour(collection: C) {
    recoloring.current = collection;
    setPalette({ ...menuAt.current, current: tone(collection) });
  }

  function itemsFor(collection: C): MenuItem[] {
    if (readOnly) return [];
    const items: MenuItem[] = [];
    if (collection.archived) {
      items.push({ label: `Restore ${kindLabel}`, onSelect: () => onRestore?.(collection) });
      items.push({ label: `Delete ${kindLabel}`, danger: true, onSelect: () => onDelete(collection) });
      return items;
    }
    if (nesting && subLabel) {
      items.push({ label: `Add ${subLabel}`, onSelect: () => startCreateUnder(collection) });
    }
    items.push({ label: `Rename ${kindLabel}`, onSelect: () => startRename(collection) });
    if (onRecolor && !collection.parentId) {
      items.push({ label: "Change colour", onSelect: () => pickColour(collection) });
    }
    items.push(...(extraMenuItems?.(collection) ?? []));
    if (onToggleHidden) {
      items.push({
        label: collection.hideFromAll ? "Show in overview" : "Hide from overview",
        onSelect: () => onToggleHidden(collection),
      });
    }
    if (archiving && collection.id !== protectedId) {
      items.push({ label: `Archive ${kindLabel}`, onSelect: () => onArchive?.(collection) });
    }
    if (collection.id !== protectedId) {
      items.push({
        label: `Delete ${kindLabel}`,
        danger: true,
        onSelect: () => onDelete(collection),
      });
    }
    return items;
  }

  function nameInput(label: string, target: C | null, placeholder?: string) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void commit(target);
        }}
        autoComplete="off"
        className="-mx-2 px-2 py-1"
      >
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit(target)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              cancelled.current = true;
              reset();
            }
          }}
          placeholder={placeholder}
          disabled={busy}
          aria-label={label}
          className={sidebarNameInput}
        />
      </form>
    );
  }

  function row(collection: C) {
    const selected = selectedId === collection.id;
    const isArchived = collection.archived === true;
    const isHidden = !isArchived && hidden.has(collection.id);
    const internalDroppable =
      !isArchived && nesting && dragging !== null && dragging !== collection.id && canMove!(dragging, collection.id);
    const externalDroppable =
      dragging === null && !readOnly && !isArchived && Boolean(externalDrop?.canDrop(collection.id));
    const droppable = internalDroppable || externalDroppable;
    return (
      <div
        draggable={nesting && !readOnly && !isArchived}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, collection.id);
          event.dataTransfer.effectAllowed = "move";
          setDragging(collection.id);
        }}
        onDragEnd={() => {
          setDragging(null);
          setDropTarget(null);
        }}
        onDragOver={(event) => {
          if (!droppable) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget(collection.id);
        }}
        onDragLeave={() => setDropTarget((current) => (current === collection.id ? null : current))}
        onDrop={(event) => {
          if (!droppable) return;
          event.preventDefault();
          setDropTarget(null);
          if (externalDroppable) {
            externalDrop!.onDrop(collection.id);
            return;
          }
          const id = event.dataTransfer.getData(DRAG_TYPE);
          setDragging(null);
          if (id) void onMove!(id, collection.id);
        }}
        onContextMenu={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          menuAt.current =
            event.clientX === 0 && event.clientY === 0
              ? { x: box.left, y: box.bottom }
              : { x: event.clientX, y: event.clientY };
          menu.open(event, itemsFor(collection));
        }}
        className={`list-row group -mx-2 flex items-center rounded-lg pr-2 transition-colors ${
          selected ? "bg-surface" : "hover:bg-surface/40"
        } ${dropTarget === collection.id ? "ring-1 ring-accent-ring" : ""}`}
      >
        <button
          type="button"
          onClick={() => onSelect(collection.id)}
          onDoubleClick={() => {
            if (!readOnly) startRename(collection);
          }}
          aria-current={selected ? "true" : undefined}
          className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${focusRing} ${
            selected ? "text-text" : "text-mute"
          } ${isHidden ? "opacity-60" : ""}`}
        >
          <span className={sidebarMark} style={{ color: tone(collection) }}>
            <CollectionIcon kind={icon} />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{collection.name}</span>
          {isHidden && collection.hideFromAll ? (
            <span title="Hidden from the overview" aria-hidden="true" className="shrink-0">
              <Icon name="eyeOff" className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </button>

        <span className={`relative flex h-7 shrink-0 items-center justify-end ${readOnly ? "w-4" : "list-row-slot"}`}>
          <span className={`list-row-rest absolute inset-0 flex items-center justify-end ${sidebarCount}`}>
            {counts.get(collection.id) || ""}
          </span>
          {readOnly ? null : (
            <span className="list-row-actions absolute inset-0 flex items-center justify-end gap-0.5">
              {nesting && subLabel && !isArchived ? (
                <button
                  type="button"
                  onClick={() => startCreateUnder(collection)}
                  title={`Add ${subLabel}`}
                  aria-label={`Add ${subLabel} under ${collection.name}`}
                  className={`${sidebarRowAction} hover:text-text`}
                >
                  <PlusMark />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => startRename(collection)}
                title={`Rename ${kindLabel}`}
                aria-label={`Rename ${collection.name}`}
                className={`${sidebarRowAction} hover:text-text`}
              >
                <PencilMark />
              </button>
              {archiving && collection.id !== protectedId ? (
                <button
                  type="button"
                  onClick={() => (isArchived ? onRestore!(collection) : onArchive!(collection))}
                  title={`${isArchived ? "Restore" : "Archive"} ${kindLabel}`}
                  aria-label={`${isArchived ? "Restore" : "Archive"} ${collection.name}`}
                  className={`${sidebarRowAction} ${isArchived ? "text-accent" : "hover:text-text"}`}
                >
                  <Icon name={isArchived ? "unarchive" : "archive"} className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {collection.id === protectedId ? null : (
                <button
                  type="button"
                  onClick={() => onDelete(collection)}
                  title={`Delete ${kindLabel}`}
                  aria-label={`Delete ${collection.name}`}
                  className={`${sidebarRowAction} hover:text-danger`}
                >
                  <TrashMark />
                </button>
              )}
            </span>
          )}
        </span>
      </div>
    );
  }

  function rows(nodes: TreeNode<C>[]): ReactNode {
    return nodes.map(({ item, children }) => {
      const expanded = open.has(item.id) && (children.length > 0 || Boolean(renderContents));
      const addingHere = creatingUnder === item.id && !readOnly;
      return (
        <li key={item.id}>
          {renamingId === item.id ? nameInput(`Rename ${item.name}`, item) : row(item)}
          {expanded || addingHere ? (
            <div className={`${sidebarChildren} mb-1`}>
              {children.length > 0 ? <ul className="space-y-0.5">{rows(children)}</ul> : null}
              {addingHere
                ? nameInput(`New ${subLabel ?? kindLabel} under ${item.name}`, null, `${capitalise(subLabel ?? kindLabel)} name`)
                : null}
              {expanded ? renderContents?.(item) : null}
            </div>
          ) : null}
        </li>
      );
    });
  }

  const rootDroppable = nesting && dragging !== null && canMove!(dragging, null);
  const archivedGroup = archiving && archivedSorted.length > 0 ? (
    <div className={sidebarSubgroup}>
      <button
        type="button"
        onClick={() => setArchivedOpen((current) => !current)}
        aria-expanded={archivedOpen || selectedArchived}
        className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${sidebarRowState(false)} ${focusRing}`}
      >
        <span className={sidebarMark}>
          <Icon name="chevron" className={`h-3 w-3 transition-transform ${archivedOpen || selectedArchived ? "rotate-90" : ""}`} />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">Archived {kindLabel}s</span>
        <span className={`shrink-0 ${sidebarCount}`}>{archivedSorted.length}</span>
      </button>
      {archivedOpen || selectedArchived ? (
        <ul className="mt-0.5 space-y-0.5">
          {archivedSorted.map((collection) => (
            <li key={collection.id}>
              {renamingId === collection.id ? nameInput(`Rename ${collection.name}`, collection) : row(collection)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="mt-2.5">
      <ContextMenu state={menu.menu} onClose={menu.close} />
      {onRecolor && !readOnly ? (
        <ColourPalette
          state={palette}
          label={`${capitalise(kindLabel)} colour`}
          onPick={(hex) => {
            const target = recoloring.current;
            if (target) void onRecolor(target, hex);
          }}
          onClose={closePalette}
        />
      ) : null}
      <ul className="space-y-0.5">{rows(tree)}</ul>

      {rootDroppable ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDropTarget(ROOT_DROP);
          }}
          onDragLeave={() => setDropTarget((current) => (current === ROOT_DROP ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData(DRAG_TYPE);
            setDragging(null);
            setDropTarget(null);
            if (id) void onMove!(id, null);
          }}
          className={`mt-1 rounded-lg border border-dashed px-3 py-1.5 text-center text-[10px] transition-colors ${
            dropTarget === ROOT_DROP ? "border-accent-dim text-text" : "border-line text-mute"
          }`}
        >
          Move to top level
        </div>
      ) : null}

      {creatingTop ? nameInput(`New ${kindLabel} name`, null, `${capitalise(kindLabel)} name`) : null}
      {archivedGroup}
    </div>
  );
}

/**
 * The tree holds only collections outside the archive. The archive lists the
 * topmost archived ones, each carrying its subtree back when restored.
 */
function splitArchive<C extends SidebarCollection>(collections: C[]): { live: C[]; archivedRoots: C[] } {
  const away = archivedIds(collections);
  return {
    live: collections.filter((collection) => !away.has(collection.id)),
    archivedRoots: collections.filter(
      (collection) => collection.archived === true && !(collection.parentId && away.has(collection.parentId)),
    ),
  };
}

function keepOrder<C>(siblings: C[]): C[] {
  return siblings;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The "New note" / "New task" row at the foot of a collection's contents. */
export function SidebarAddRow({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`list-row -mx-2 flex w-[calc(100%+1rem)] items-center rounded-lg pr-2 text-left transition-colors hover:bg-surface/40 ${focusRing}`}
      style={{ paddingLeft: "0.5rem" }}
    >
      <span className="flex h-7 w-4 shrink-0 items-center justify-center text-note-new">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </span>
      <span className="py-2 pl-2.5 text-xs text-mute transition-colors group-hover:text-text">{label}</span>
    </button>
  );
}
