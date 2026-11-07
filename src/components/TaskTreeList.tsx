import { useState } from "react";
import type { CSSProperties, DragEventHandler } from "react";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { dueLabel, isOverdue, priorityLabel } from "../lib/task";
import type { ChildCount, TaskTreeNode } from "../lib/taskTree";
import { focusRing, tonePill } from "../lib/styles";
import type { Task } from "../lib/types";
import { Icon } from "./Icon";

const DRAG_TYPE = "application/x-sealbook-task";
const ROOT_DROP = "__root__";
const NO_BLOCKED: ReadonlySet<string> = new Set();

type Zone = "top" | "inside" | "bottom";
type Over = { id: string; zone: Zone; parentId: string | null } | typeof ROOT_DROP;

/** The outer quarters of a row drop beside it, the middle drops inside it. */
function zoneAt(event: React.DragEvent): Zone {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.height === 0) return "inside";
  const offset = (event.clientY - rect.top) / rect.height;
  if (offset < 0.25) return "top";
  if (offset > 0.75) return "bottom";
  return "inside";
}

export type TaskActions = {
  now: Date;
  timezone: string;
  readOnly: boolean;
  counts: Map<string, ChildCount>;
  highlightId?: string;
  activeId?: string;
  /** Left out when every row shares one list, so the pill is not repeated. */
  listFor?: (task: Task) => { name: string; tone: string } | undefined;
  onToggleDone: (task: Task) => void;
  onSelect: (task: Task) => void;
  onEdit: (task: Task) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (task: Task) => void;
};

type RowProps = TaskActions & {
  task: Task;
  depth?: number;
  /** The parent's title, for a subtask listed away from its parent. */
  parentTitle?: string;
  lead?: React.ReactNode;
  className?: string;
  dropLine?: "top" | "bottom";
  dragProps?: {
    draggable: boolean;
    onDragStart: DragEventHandler;
    onDragEnd: DragEventHandler;
    onDragOver: DragEventHandler;
    onDragLeave: DragEventHandler;
    onDrop: DragEventHandler;
  };
  menu: ReturnType<typeof useContextMenu>;
};

function itemsFor(task: Task, actions: TaskActions): MenuItem[] {
  if (actions.readOnly) return [];
  return [
    { label: "Edit task", onSelect: () => actions.onEdit(task) },
    { label: "Add subtask", onSelect: () => actions.onAddChild(task.id) },
    { label: "Delete task", danger: true, onSelect: () => actions.onDelete(task) },
  ];
}

export function TaskRow(props: RowProps) {
  const { task, depth = 0, parentTitle, lead, className = "", dropLine, dragProps, menu, ...actions } = props;
  const { now, timezone, readOnly, counts, highlightId, activeId, listFor, onToggleDone, onSelect, onAddChild, onDelete } = actions;
  const list = listFor?.(task);
  const current = activeId === task.id || highlightId === task.id;
  const due = dueLabel(task, now, timezone);
  const overdue = isOverdue(task, now, timezone);
  const priority = priorityLabel(task.priority);
  const children = counts.get(task.id);
  const meta: React.ReactNode[] = [];
  if (parentTitle) meta.push(<span key="parent" className="max-w-[14rem] truncate">{`in ${parentTitle}`}</span>);
  if (due) {
    meta.push(
      <span key="due" className={overdue ? "text-danger" : undefined}>
        {due}
      </span>,
    );
  }
  if (priority) meta.push(<span key="priority">{priority} priority</span>);
  if (task.recurrence) {
    meta.push(
      <span key="repeat" className="inline-flex items-center gap-1">
        <Icon name="repeat" className="h-3 w-3" />
        Repeats
      </span>,
    );
  }
  if (children) meta.push(<span key="children">{`${children.done}/${children.total} subtasks`}</span>);
  if (task.tags && task.tags.length > 0) meta.push(<span key="tags">{task.tags.join(", ")}</span>);

  return (
    <div
      {...dragProps}
      data-task-id={task.id}
      onContextMenu={(event) => menu.open(event, itemsFor(task, actions))}
      style={{ paddingLeft: `calc(0.5rem + ${depth * 1.5}rem)` }}
      className={`list-row relative flex items-start gap-2 border-b border-l-2 border-line/60 py-2.5 pr-3 transition-colors duration-150 ${
        current ? "border-l-accent bg-surface/70" : "border-l-transparent hover:bg-surface/40"
      } ${className}`}
    >
      {dropLine ? (
        <span
          aria-hidden="true"
          style={{ left: `calc(2.5rem + ${depth * 1.5}rem)` }}
          className={`pointer-events-none absolute right-3 h-0.5 rounded-full bg-accent ${
            dropLine === "top" ? "-top-px" : "-bottom-px"
          }`}
        />
      ) : null}
      {lead ?? <span aria-hidden="true" className="h-5 w-5 shrink-0" />}
      <label className="hit-area relative flex h-5 shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={task.done === true}
          disabled={readOnly}
          onChange={() => onToggleDone(task)}
          aria-label={`Complete ${task.title}`}
          className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-default"
        />
      </label>
      <button
        type="button"
        onClick={() => onSelect(task)}
        className={`ml-1 flex min-w-0 flex-1 items-start gap-3 rounded-sm text-left ${focusRing}`}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={`min-w-0 truncate text-sm font-medium leading-5 ${
              task.done ? "text-mute line-through" : current ? "text-accent" : "text-text"
            }`}
          >
            {task.title}
          </span>
          {meta.length > 0 ? (
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs leading-4 text-mute">
              {meta.map((entry, index) => (
                <span key={index} className="inline-flex items-center gap-2">
                  {index > 0 ? <span aria-hidden="true">·</span> : null}
                  {entry}
                </span>
              ))}
            </span>
          ) : null}
        </span>
        {list ? (
          <span
            className="max-w-[10rem] shrink-0 truncate rounded-full border px-2 text-[11px] font-medium leading-[18px]"
            style={tonePill(list.tone)}
          >
            {list.name}
          </span>
        ) : null}
      </button>
      {readOnly ? null : (
        <span className="list-row-actions -my-1 ml-1 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onAddChild(task.id)}
            title="Add subtask"
            aria-label={`Add subtask to ${task.title}`}
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
          >
            <Icon name="plus" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(task)}
            title="Delete task"
            aria-label={`Delete ${task.title}`}
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-danger ${focusRing}`}
          >
            <Icon name="trash" />
          </button>
        </span>
      )}
    </div>
  );
}

type NestProps = {
  nodes: TaskTreeNode[];
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  renderRow: (
    node: TaskTreeNode,
    lead: React.ReactNode | undefined,
    parentId: string | null,
  ) => React.ReactNode;
  parentId?: string | null;
};

/**
 * The rows of a tree, with each open parent's subtasks in a group of their own
 * beneath it. `parentId` is the parent as drawn, which in a smart view can
 * differ from the stored one when that parent is out of scope.
 */
function nested({ nodes, expanded, onToggle, renderRow, parentId = null }: NestProps): React.ReactNode {
  return nodes.map((node) => {
    const { task } = node;
    const hasChildren = node.children.length > 0;
    const open = expanded.has(task.id);
    const lead = hasChildren ? (
      <button
        type="button"
        onClick={() => onToggle(task.id)}
        aria-label={open ? `Collapse ${task.title}` : `Expand ${task.title}`}
        aria-expanded={open}
        className={`hit-area relative flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-mute transition-colors hover:text-text ${focusRing}`}
      >
        <Icon name="chevron" className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
    ) : undefined;
    return (
      <li key={task.id}>
        {renderRow(node, lead, parentId)}
        {hasChildren && open ? (
          <ul
            className="task-subtree"
            style={{ "--sb-task-guide": `calc(1.125rem + 2px + ${node.depth * 1.5}rem)` } as CSSProperties}
          >
            {nested({ nodes: node.children, expanded, onToggle, renderRow, parentId: task.id })}
          </ul>
        ) : null}
      </li>
    );
  });
}

type TreeProps = TaskActions & {
  tree: TaskTreeNode[];
  /** Parents whose subtasks are shown; a parent starts closed. */
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Read once when a drag starts; `onMove` is still the last word on a drop. */
  blockedDropIds: (id: string) => Set<string>;
  onMove: (id: string, parentId: string | null) => void;
};

export function TaskTreeList({
  tree,
  expanded,
  onToggle,
  blockedDropIds,
  onMove,
  ...actions
}: TreeProps) {
  const menu = useContextMenu();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(NO_BLOCKED);

  function endDrag() {
    setDragging(null);
    setOver(null);
    setBlocked(NO_BLOCKED);
  }

  function renderRow(
    node: TaskTreeNode,
    lead: React.ReactNode | undefined,
    parentId: string | null,
  ): React.ReactNode {
    const { task } = node;
    const here = over !== ROOT_DROP && over?.id === task.id ? over : null;
    return (
      <TaskRow
        {...actions}
        task={task}
        depth={node.depth}
        lead={lead}
        menu={menu}
        className={here?.zone === "inside" ? "ring-1 ring-inset ring-accent-ring" : ""}
        dropLine={here && here.zone !== "inside" ? here.zone : undefined}
        dragProps={{
          draggable: !actions.readOnly,
          onDragStart: (event) => {
            event.dataTransfer.setData(DRAG_TYPE, task.id);
            event.dataTransfer.effectAllowed = "move";
            setDragging(task.id);
            setBlocked(blockedDropIds(task.id));
          },
          onDragEnd: endDrag,
          onDragOver: (event) => {
            if (dragging === null || blocked.has(task.id)) return;
            const zone = zoneAt(event);
            const target = zone === "inside" ? task.id : parentId;
            if (target !== null && blocked.has(target)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            if (here?.zone !== zone) setOver({ id: task.id, zone, parentId: target });
          },
          onDragLeave: (event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setOver((current) => (current !== ROOT_DROP && current?.id === task.id ? null : current));
          },
          onDrop: (event) => {
            if (!here) return;
            event.preventDefault();
            const id = event.dataTransfer.getData(DRAG_TYPE);
            endDrag();
            if (id) onMove(id, here.parentId);
          },
        }}
      />
    );
  }

  return (
    <div>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      <ul className="min-w-0">{nested({ nodes: tree, expanded, onToggle, renderRow })}</ul>
      {dragging !== null ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (over !== ROOT_DROP) setOver(ROOT_DROP);
          }}
          onDragLeave={() => setOver((current) => (current === ROOT_DROP ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            const id = event.dataTransfer.getData(DRAG_TYPE);
            endDrag();
            if (id) onMove(id, null);
          }}
          className={`mx-4 mt-2 rounded-lg border border-dashed px-3 py-1.5 text-center text-xs transition-colors ${
            over === ROOT_DROP ? "border-accent-dim text-text" : "border-line text-mute"
          }`}
        >
          Move to top level
        </div>
      ) : null}
    </div>
  );
}
