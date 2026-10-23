import { useRef, useState } from "react";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { SidebarSection } from "./SidebarDrawer";
import { TaskIcon } from "./TaskIcon";
import {
  buildTaskListTree,
  canMoveTaskList,
  DEFAULT_TASK_LIST_ID,
  taskListTone,
} from "../lib/task";
import type { TaskScope } from "../lib/task";
import { focusRing } from "../lib/styles";
import type { TreeNode } from "../lib/tree";
import type { TaskList } from "../lib/types";

export const SMART_VIEWS: { id: TaskScope; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "overdue", label: "Overdue" },
  { id: "all", label: "All tasks" },
  { id: "completed", label: "Completed" },
];

const LIST_DRAG_TYPE = "application/x-sealbook-task-list";
const ROOT_DROP = "__root__";
const nameInput =
  "h-8 w-full rounded-lg border border-accent-dim bg-bg px-2 text-xs text-text outline-none ring-1 ring-accent-ring placeholder:text-mute/60";
const rowBase = "list-row group -mx-2 flex items-center rounded-lg pr-2 transition-colors";
const rowButton = `flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated ${focusRing}`;
const sectionButton = `flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`;

/** Depth as the row's leading inset, so every row keeps one vertical rhythm. */
function indentOf(depth: number) {
  return { paddingLeft: `${depth * 0.75}rem` };
}

type Props = {
  lists: TaskList[];
  scope: string;
  onScope: (scope: string) => void;
  smartCounts: Record<TaskScope, number>;
  listCounts: Map<string, number>;
  readOnly: boolean;
  onCreate: (name: string, parentId?: string) => Promise<string | undefined>;
  onRename: (list: TaskList, name: string) => Promise<void>;
  onRecolor: (list: TaskList, color: string) => Promise<void>;
  onMove: (id: string, parentId: string | null) => Promise<void>;
  onDelete: (list: TaskList) => void;
};

export function TaskListSidebar({
  lists,
  scope,
  onScope,
  smartCounts,
  listCounts,
  readOnly,
  onCreate,
  onRename,
  onRecolor,
  onMove,
  onDelete,
}: Props) {
  const menu = useContextMenu();
  const tree = buildTaskListTree(lists);
  const [creatingUnder, setCreatingUnder] = useState<{ parentId?: string; depth: number } | null>(
    null,
  );
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const renameCancelled = useRef(false);
  const committing = useRef(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  function reveal(id: string) {
    setCollapsed((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startCreate(parentId: string | undefined, depth: number) {
    setCreatingUnder({ parentId, depth });
    setNewName("");
    if (parentId) reveal(parentId);
  }

  function cancelCreate() {
    setCreatingUnder(null);
    setNewName("");
  }

  async function create() {
    const name = newName.trim();
    if (!name || !creatingUnder || committing.current) {
      if (!name) cancelCreate();
      return;
    }
    const parentId = creatingUnder.parentId;
    committing.current = true;
    setCreatingUnder(null);
    setNewName("");
    try {
      const id = await onCreate(name, parentId);
      if (id) onScope(id);
    } finally {
      committing.current = false;
    }
  }

  function startRename(list: TaskList) {
    renameCancelled.current = false;
    setRenamingId(list.id);
    setRenameText(list.name);
  }

  async function rename(list: TaskList) {
    if (renameCancelled.current) {
      renameCancelled.current = false;
      return;
    }
    const name = renameText.trim();
    setRenamingId(null);
    if (name && name !== list.name) await onRename(list, name);
  }

  function itemsFor(list: TaskList, depth: number): MenuItem[] {
    if (readOnly) return [];
    const items: MenuItem[] = [
      { label: "Add sublist", onSelect: () => startCreate(list.id, depth + 1) },
      { label: "Rename list", onSelect: () => startRename(list) },
    ];
    if (list.id !== DEFAULT_TASK_LIST_ID) {
      items.push({ label: "Delete list", danger: true, onSelect: () => onDelete(list) });
    }
    return items;
  }

  function createInput(label: string, placeholder: string, depth: number) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
        autoComplete="off"
        style={indentOf(depth)}
        className="-mx-2 px-2 py-1"
      >
        <input
          autoFocus
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onBlur={() => void create()}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancelCreate();
          }}
          placeholder={placeholder}
          aria-label={label}
          className={nameInput}
        />
      </form>
    );
  }

  function rows(nodes: TreeNode<TaskList>[]) {
    return nodes.map((node) => {
      const item = node.item;
      const hasChildren = node.children.length > 0;
      const open = !collapsed.has(item.id);
      const active = scope === item.id;
      const droppable =
        dragging !== null && dragging !== item.id && canMoveTaskList(lists, dragging, item.id);
      return (
        <li key={item.id}>
          {renamingId === item.id ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void rename(item);
              }}
              autoComplete="off"
              style={indentOf(node.depth)}
              className="-mx-2 px-2 py-1"
            >
              <input
                autoFocus
                value={renameText}
                onChange={(event) => setRenameText(event.target.value)}
                onBlur={() => void rename(item)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    renameCancelled.current = true;
                    setRenamingId(null);
                  }
                }}
                aria-label={`Rename ${item.name}`}
                className={nameInput}
              />
            </form>
          ) : (
            <div
              draggable={!readOnly}
              onDragStart={(event) => {
                event.dataTransfer.setData(LIST_DRAG_TYPE, item.id);
                event.dataTransfer.effectAllowed = "move";
                setDragging(item.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setDropTarget(null);
              }}
              onDragOver={(event) => {
                if (!droppable) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(item.id);
              }}
              onDragLeave={() => setDropTarget((current) => (current === item.id ? null : current))}
              onDrop={(event) => {
                if (!droppable) return;
                event.preventDefault();
                const id = event.dataTransfer.getData(LIST_DRAG_TYPE);
                setDropTarget(null);
                setDragging(null);
                if (id) {
                  reveal(item.id);
                  void onMove(id, item.id);
                }
              }}
              onContextMenu={(event) => menu.open(event, itemsFor(item, node.depth))}
              style={indentOf(node.depth)}
              className={`${rowBase} ${active ? "bg-surface" : "hover:bg-surface/40"} ${
                dropTarget === item.id ? "ring-1 ring-accent-ring" : ""
              }`}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  aria-label={open ? `Collapse ${item.name}` : `Expand ${item.name}`}
                  aria-expanded={open}
                  className={`flex h-7 w-3 shrink-0 items-center justify-center text-mute transition-colors hover:text-text ${focusRing}`}
                >
                  <TaskIcon
                    name="chevron"
                    className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
                  />
                </button>
              ) : (
                <span aria-hidden="true" className="h-7 w-3 shrink-0" />
              )}
              {!readOnly && !item.parentId ? (
                <input
                  type="color"
                  value={taskListTone(lists, item.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => void onRecolor(item, event.target.value)}
                  title={`Change colour for ${item.name}`}
                  aria-label={`Change colour for ${item.name}`}
                  className="color-dot ml-1 h-3.5 w-3.5 shrink-0 cursor-pointer"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="ml-1 h-3.5 w-3.5 shrink-0 rounded-full"
                  style={{ background: taskListTone(lists, item.id) }}
                />
              )}
              <button
                type="button"
                onClick={() => onScope(item.id)}
                onDoubleClick={() => {
                  if (!readOnly) startRename(item);
                }}
                aria-current={active ? "true" : undefined}
                className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pl-2.5 pr-2 text-left text-xs transition-colors ${
                  active ? "text-text" : "text-mute"
                } ${focusRing}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
              </button>
              <span
                className={`relative flex h-7 shrink-0 items-center justify-end ${
                  readOnly ? "w-4" : "list-row-slot"
                }`}
              >
                <span className="list-row-rest absolute inset-0 flex items-center justify-end pr-1 text-[10px] tabular-nums text-mute/70">
                  {listCounts.get(item.id) || ""}
                </span>
                {readOnly ? null : (
                  <span className="list-row-actions absolute inset-0 flex items-center justify-end gap-0.5">
                    <button
                      type="button"
                      onClick={() => startCreate(item.id, node.depth + 1)}
                      title="Add sublist"
                      aria-label={`Add sublist under ${item.name}`}
                      className={`${rowButton} hover:text-text`}
                    >
                      <TaskIcon name="plus" className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => startRename(item)}
                      title="Rename list"
                      aria-label={`Rename ${item.name}`}
                      className={`${rowButton} hover:text-text`}
                    >
                      <TaskIcon name="pencil" className="h-3 w-3" />
                    </button>
                    {item.id !== DEFAULT_TASK_LIST_ID ? (
                      <button
                        type="button"
                        onClick={() => onDelete(item)}
                        title="Delete list"
                        aria-label={`Delete ${item.name}`}
                        className={`${rowButton} hover:text-danger`}
                      >
                        <TaskIcon name="trash" className="h-3 w-3" />
                      </button>
                    ) : null}
                  </span>
                )}
              </span>
            </div>
          )}

          {creatingUnder && creatingUnder.parentId === item.id
            ? createInput(`New sublist under ${item.name}`, "Sublist name", node.depth + 1)
            : null}

          {hasChildren && open ? <ul className="space-y-0.5">{rows(node.children)}</ul> : null}
        </li>
      );
    });
  }

  const rootDroppable = dragging !== null && canMoveTaskList(lists, dragging, null);

  return (
    <>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      <SidebarSection label="Views">
        <ul className="mt-2.5 space-y-0.5">
          {SMART_VIEWS.map((view) => (
            <li key={view.id}>
              <button
                type="button"
                onClick={() => onScope(view.id)}
                aria-current={scope === view.id ? "true" : undefined}
                className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${
                  scope === view.id
                    ? "bg-surface text-text"
                    : "text-mute hover:bg-surface/40 hover:text-text"
                } ${focusRing}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{view.label}</span>
                <span className="pr-1 text-[10px] tabular-nums text-mute/70">
                  {smartCounts[view.id] || ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </SidebarSection>

      <SidebarSection
        label="Lists"
        action={
          !readOnly ? (
            <button
              type="button"
              onClick={() => startCreate(undefined, 0)}
              title="Add a top-level list"
              aria-label="Add list"
              className={sectionButton}
            >
              <TaskIcon name="plus" />
            </button>
          ) : null
        }
      >
        <ul className="mt-2.5 space-y-0.5">{rows(tree)}</ul>

        {rootDroppable ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDropTarget(ROOT_DROP);
            }}
            onDragLeave={() => setDropTarget((current) => (current === ROOT_DROP ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData(LIST_DRAG_TYPE);
              setDropTarget(null);
              setDragging(null);
              if (id) void onMove(id, null);
            }}
            className={`mt-1 rounded-lg border border-dashed px-3 py-1.5 text-center text-[10px] transition-colors ${
              dropTarget === ROOT_DROP ? "border-accent-dim text-text" : "border-line text-mute"
            }`}
          >
            Move to top level
          </div>
        ) : null}

        {creatingUnder && creatingUnder.parentId === undefined
          ? createInput("New list name", "List name", 0)
          : null}
      </SidebarSection>
    </>
  );
}
