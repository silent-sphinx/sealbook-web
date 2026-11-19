import { useState, type ReactNode } from "react";

import { focusRing, sidebarGutter } from "../lib/styles";
import type { TreeItem, TreeNode } from "../lib/tree";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { Icon, type IconName } from "./Icon";

export type RowAction = MenuItem & {
  icon: IconName;
  ariaLabel: string;
};

type Props<T extends TreeItem> = {
  nodes: TreeNode<T>[];
  label: (item: T) => string;
  selectedId: string | null;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (item: T) => void;
  /** The leading mark of a row without children; one with children shows a chevron. */
  mark: (item: T, active: boolean) => ReactNode;
  actions: (item: T) => RowAction[];
  /** Read once when a drag starts. Without `onMove` rows are not draggable. */
  blockedDropIds?: (id: string) => Set<string>;
  onMove?: (id: string, parentId: string | null) => void;
  dragType?: string;
  rowAttributes?: (item: T) => Record<string, string>;
};

const ROOT_DROP = "__root__";
const NO_BLOCKED: ReadonlySet<string> = new Set();

export function SidebarTree<T extends TreeItem>({
  nodes,
  label,
  selectedId,
  expanded,
  onToggle,
  onSelect,
  mark,
  actions,
  blockedDropIds,
  onMove,
  dragType = "application/x-sealbook-sidebar-item",
  rowAttributes,
}: Props<T>) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(NO_BLOCKED);
  const menu = useContextMenu();
  const draggable = Boolean(onMove);

  function endDrag() {
    setDragging(null);
    setOver(null);
    setBlocked(NO_BLOCKED);
  }

  function rows(list: TreeNode<T>[]): ReactNode {
    return list.map((node) => {
      const { item } = node;
      const title = label(item);
      const open = expanded.has(item.id);
      const hasChildren = node.children.length > 0;
      const active = selectedId === item.id;
      const droppable = dragging !== null && !blocked.has(item.id);
      const rowActions = actions(item);

      const lead = hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(item.id)}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          aria-expanded={open}
          className={`${sidebarGutter} text-mute transition-colors hover:text-text ${focusRing}`}
        >
          <Icon name="chevron" className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      ) : (
        <span aria-hidden="true" className={sidebarGutter}>
          {mark(item, active)}
        </span>
      );

      return (
        <li key={item.id}>
          <div
            {...rowAttributes?.(item)}
            draggable={draggable}
            onDragStart={(event) => {
              if (!draggable) return;
              event.dataTransfer.setData(dragType, item.id);
              event.dataTransfer.effectAllowed = "move";
              setDragging(item.id);
              setBlocked(blockedDropIds?.(item.id) ?? new Set([item.id]));
            }}
            onDragEnd={endDrag}
            onDragOver={(event) => {
              if (!droppable) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (over !== item.id) setOver(item.id);
            }}
            onDragLeave={() => setOver((current) => (current === item.id ? null : current))}
            onDrop={(event) => {
              if (!droppable) return;
              event.preventDefault();
              const id = event.dataTransfer.getData(dragType);
              endDrag();
              if (id) onMove?.(id, item.id);
            }}
            onContextMenu={(event) => menu.open(event, rowActions)}
            style={{ paddingLeft: `calc(0.5rem + ${node.depth * 0.75}rem)` }}
            className={`list-row tree-row group -mx-2 flex items-center rounded-lg pr-2 transition-colors ${
              active ? "bg-accent-soft" : "hover:bg-hover"
            } ${over === item.id ? "ring-1 ring-accent-ring" : ""}`}
          >
            {lead}

            <button
              type="button"
              onClick={() => onSelect(item)}
              aria-current={active ? "true" : undefined}
              className={`flex min-w-0 flex-1 items-center gap-1.5 h-8 rounded-lg pl-2.5 text-left text-sm font-medium transition-colors ${
                active ? "text-text" : "text-mute hover:text-text"
              } ${focusRing}`}
            >
              <span className="min-w-0 truncate">{title}</span>
            </button>

            {rowActions.length > 0 ? (
              <span className="list-row-slot relative flex h-7 shrink-0 items-center justify-end">
                <span className="list-row-actions absolute inset-0 flex items-center justify-end gap-0.5">
                  {rowActions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={action.onSelect}
                      disabled={action.disabled}
                      title={action.label}
                      aria-label={action.ariaLabel}
                      className={`flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated ${
                        action.danger ? "hover:text-danger" : "hover:text-text"
                      } ${focusRing}`}
                    >
                      <Icon name={action.icon} className="h-3 w-3" />
                    </button>
                  ))}
                </span>
              </span>
            ) : null}
          </div>
          {hasChildren && open ? <ul>{rows(node.children)}</ul> : null}
        </li>
      );
    });
  }

  return (
    <div>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      <ul>{rows(nodes)}</ul>
      {dragging !== null ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (over !== ROOT_DROP) setOver(ROOT_DROP);
          }}
          onDragLeave={() => setOver((current) => (current === ROOT_DROP ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData(dragType);
            endDrag();
            if (id) onMove?.(id, null);
          }}
          className={`mt-1 rounded-lg border border-dashed px-3 py-1.5 text-center text-2xs transition-colors ${
            over === ROOT_DROP ? "border-accent-dim text-text" : "border-line text-mute"
          }`}
        >
          Move to top level
        </div>
      ) : null}
    </div>
  );
}
