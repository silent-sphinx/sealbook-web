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
  "h-8 w-full min-w-0 rounded-lg border border-line bg-bg px-2.5 text-xs text-text outline-none focus:border-accent-dim focus:ring-1 focus:ring-accent-ring";
const rowButton = `flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface ${focusRing}`;

type Props = {
  lists: TaskList[];
  scope: string;
  onScope: (scope: string) => void;
  smartCounts: Record<TaskScope, number>;
  listCounts: Map<string, number>;
  readOnly: boolean;
  onCreate: (name: string, parentId?: string) => Promise<string | undefined>;
  onRename: (list: TaskList, name: string) => Promise<void>;
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
  onMove,
  onDelete,
}: Props) {
  const menu = useContextMenu();
  const tree = buildTaskListTree(lists);
  const [creatingUnder, setCreatingUnder] = useState<{ parentId?: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const renameCancelled = useRef(false);
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

  function startCreate(parentId?: string) {
    setCreatingUnder({ parentId });
    setNewName("");
    if (parentId) reveal(parentId);
  }

  function cancelCreate() {
    setCreatingUnder(null);
    setNewName("");
  }

  async function create() {
    const name = newName.trim();
    if (!name || !creatingUnder) return;
    const parentId = creatingUnder.parentId;
    setCreatingUnder(null);
    setNewName("");
    const id = await onCreate(name, parentId);
    if (id) onScope(id);
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

  function itemsFor(list: TaskList): MenuItem[] {
    if (readOnly) return [];
    const items: MenuItem[] = [
      { label: "Add sublist", onSelect: () => startCreate(list.id) },
      { label: "Rename list", onSelect: () => startRename(list) },
    ];
    if (list.id !== DEFAULT_TASK_LIST_ID) {
      items.push({ label: "Delete list", danger: true, onSelect: () => onDelete(list) });
    }
    return items;
  }

  function createInput(label: string, placeholder: string) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onBlur={() => {
            if (!newName.trim()) cancelCreate();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create();
            if (event.key === "Escape") cancelCreate();
          }}
          placeholder={placeholder}
          aria-label={label}
          className={nameInput}
        />
        <button
          type="button"
          onClick={() => void create()}
          className={`flex h-8 shrink-0 items-center rounded-lg bg-accent px-2.5 text-xs font-semibold text-bg ${focusRing}`}
        >
          Add
        </button>
      </div>
    );
  }

  function rows(nodes: TreeNode<TaskList>[]) {
    return nodes.map((node) => {
      const item = node.item;
      const hasChildren = node.children.length > 0;
      const open = !collapsed.has(item.id);
      const droppable =
        dragging !== null && dragging !== item.id && canMoveTaskList(lists, dragging, item.id);
      return (
        <li key={item.id}>
          {renamingId === item.id ? (
            <div className="flex items-center gap-1.5 py-0.5 pl-1">
              <input
                autoFocus
                value={renameText}
                onChange={(event) => setRenameText(event.target.value)}
                onBlur={() => void rename(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void rename(item);
                  if (event.key === "Escape") {
                    renameCancelled.current = true;
                    setRenamingId(null);
                  }
                }}
                aria-label={`Rename ${item.name}`}
                className={nameInput}
              />
            </div>
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
              onContextMenu={(event) => menu.open(event, itemsFor(item))}
              className={`list-row flex items-center rounded-lg transition-colors ${
                scope === item.id ? "bg-surface" : "hover:bg-surface/40"
              } ${dropTarget === item.id ? "ring-1 ring-accent-ring" : ""}`}
            >
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  aria-label={open ? `Collapse ${item.name}` : `Expand ${item.name}`}
                  aria-expanded={open}
                  className={`flex h-7 w-4 shrink-0 items-center justify-center text-mute transition-colors hover:text-text ${focusRing}`}
                >
                  <TaskIcon
                    name="chevron"
                    className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
                  />
                </button>
              ) : (
                <span aria-hidden="true" className="h-7 w-4 shrink-0" />
              )}
              <span
                aria-hidden="true"
                className="mr-1.5 h-3.5 w-3.5 shrink-0 rounded-full"
                style={{ background: taskListTone(lists, item.id) }}
              />
              <button
                type="button"
                onClick={() => onScope(item.id)}
                onDoubleClick={() => {
                  if (!readOnly) startRename(item);
                }}
                aria-current={scope === item.id ? "true" : undefined}
                className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pr-2 text-left text-xs transition-colors ${
                  scope === item.id ? "text-text" : "text-mute hover:text-text"
                } ${focusRing}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                <span className="text-[10px] tabular-nums text-mute/70">
                  {listCounts.get(item.id) || ""}
                </span>
              </button>
              {!readOnly ? (
                <div className="list-row-actions flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => startCreate(item.id)}
                    title="Add sublist"
                    aria-label={`Add sublist under ${item.name}`}
                    className={`${rowButton} hover:text-text`}
                  >
                    <TaskIcon name="plus" />
                  </button>
                  <button
                    type="button"
                    onClick={() => startRename(item)}
                    aria-label={`Rename ${item.name}`}
                    className={`${rowButton} hover:text-text`}
                  >
                    <TaskIcon name="pencil" />
                  </button>
                  {item.id !== DEFAULT_TASK_LIST_ID ? (
                    <button
                      type="button"
                      onClick={() => onDelete(item)}
                      aria-label={`Delete ${item.name}`}
                      className={`${rowButton} hover:text-danger`}
                    >
                      <TaskIcon name="trash" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {creatingUnder && creatingUnder.parentId === item.id ? (
            <div className="ml-5 border-l border-line py-0.5 pl-2.5">
              {createInput(`New sublist under ${item.name}`, "Sublist name")}
            </div>
          ) : null}

          {hasChildren && open ? (
            <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-line pl-2">
              {rows(node.children)}
            </ul>
          ) : null}
        </li>
      );
    });
  }

  const rootDroppable = dragging !== null && canMoveTaskList(lists, dragging, null);

  return (
    <>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      <SidebarSection label="Views">
        <ul className="mt-2 space-y-0.5">
          {SMART_VIEWS.map((view) => (
            <li key={view.id}>
              <button
                type="button"
                onClick={() => onScope(view.id)}
                aria-current={scope === view.id ? "true" : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${
                  scope === view.id
                    ? "bg-surface text-text"
                    : "text-mute hover:bg-surface/40 hover:text-text"
                } ${focusRing}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{view.label}</span>
                <span className="text-[10px] tabular-nums text-mute/70">
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
              onClick={() => startCreate(undefined)}
              title="Add a top-level list"
              aria-label="Add list"
              className={`${rowButton} hover:text-text`}
            >
              <TaskIcon name="plus" />
            </button>
          ) : null
        }
      >
        <ul className="mt-2 space-y-0.5">{rows(tree)}</ul>

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

        {creatingUnder && creatingUnder.parentId === undefined ? (
          <div className="mt-2">{createInput("New list name", "List name")}</div>
        ) : null}
      </SidebarSection>
    </>
  );
}
