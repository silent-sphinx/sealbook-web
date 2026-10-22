import { useState } from "react";
import type { DragEventHandler } from "react";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { TaskIcon } from "./TaskIcon";
import { dueLabel, isOverdue, priorityLabel } from "../lib/task";
import type { ChildCount, TaskTreeNode } from "../lib/taskTree";
import { focusRing } from "../lib/styles";
import type { Task } from "../lib/types";

const DRAG_TYPE = "application/x-sealbook-task";
const ROOT_DROP = "__root__";
const NO_BLOCKED: ReadonlySet<string> = new Set();

export type TaskActions = {
  now: Date;
  timezone: string;
  readOnly: boolean;
  counts: Map<string, ChildCount>;
  highlightId?: string;
  onToggleDone: (task: Task) => void;
  onEdit: (task: Task) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (task: Task) => void;
};

type RowProps = TaskActions & {
  task: Task;
  depth?: number;
  lead?: React.ReactNode;
  caption?: string;
  active?: boolean;
  className?: string;
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

function TaskRow(props: RowProps) {
  const { task, depth = 0, lead, caption, active, className = "", dragProps, menu, ...actions } = props;
  const { now, timezone, readOnly, counts, highlightId, onToggleDone, onEdit, onAddChild, onDelete } = actions;
  const due = dueLabel(task, now, timezone);
  const overdue = isOverdue(task, now, timezone);
  const priority = priorityLabel(task.priority);
  const children = counts.get(task.id);
  const meta: React.ReactNode[] = [];
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
        <TaskIcon name="repeat" className="h-3 w-3" />
        Repeats
      </span>,
    );
  }
  if (children) meta.push(<span key="children">{`${children.done}/${children.total} subtasks`}</span>);
  if (task.tags && task.tags.length > 0) meta.push(<span key="tags">{task.tags.join(", ")}</span>);
  if (caption) meta.push(<span key="caption">{caption}</span>);

  return (
    <div
      {...dragProps}
      data-task-id={task.id}
      onContextMenu={(event) => menu.open(event, itemsFor(task, actions))}
      style={{ paddingLeft: `calc(0.5rem + ${depth * 1.25}rem)` }}
      className={`list-row flex items-center gap-2 rounded-lg pr-2 transition-colors hover:bg-panel/60 ${
        active || highlightId === task.id ? "bg-surface ring-1 ring-accent-ring" : ""
      } ${className}`}
    >
      {lead ?? <span aria-hidden="true" className="h-7 w-4 shrink-0" />}
      <input
        type="checkbox"
        checked={task.done === true}
        disabled={readOnly}
        onChange={() => onToggleDone(task)}
        aria-label={`Complete ${task.title}`}
        className="h-4 w-4 shrink-0 cursor-pointer accent-accent disabled:cursor-default"
      />
      <button
        type="button"
        onClick={() => onEdit(task)}
        className={`min-w-0 flex-1 rounded-lg py-2.5 text-left ${focusRing}`}
      >
        <span
          className={`block truncate text-sm font-medium ${task.done ? "text-mute line-through" : "text-text"}`}
        >
          {task.title}
        </span>
        {meta.length > 0 ? (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-mute">
            {meta.map((entry, index) => (
              <span key={index} className="inline-flex items-center gap-2">
                {index > 0 ? <span aria-hidden="true">·</span> : null}
                {entry}
              </span>
            ))}
          </span>
        ) : null}
      </button>
      {readOnly ? null : (
        <span className="list-row-actions flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onAddChild(task.id)}
            title="Add subtask"
            aria-label={`Add subtask to ${task.title}`}
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
          >
            <TaskIcon name="plus" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(task)}
            title="Delete task"
            aria-label={`Delete ${task.title}`}
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-danger ${focusRing}`}
          >
            <TaskIcon name="trash" />
          </button>
        </span>
      )}
    </div>
  );
}

type FlatProps = TaskActions & {
  tasks: Task[];
  captionFor: (task: Task) => string | undefined;
};

/** Rows with no nesting, for the smart views and for search results. */
export function TaskFlatList({ tasks, captionFor, ...actions }: FlatProps) {
  const menu = useContextMenu();
  return (
    <div>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      <ul className="divide-y divide-line/60 border-y border-line/60">
        {tasks.map((task) => (
          <li key={task.id}>
            <TaskRow {...actions} task={task} caption={captionFor(task)} menu={menu} />
          </li>
        ))}
      </ul>
    </div>
  );
}

type TreeProps = TaskActions & {
  tree: TaskTreeNode[];
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Read once when a drag starts; `onMove` is still the last word on a drop. */
  blockedDropIds: (id: string) => Set<string>;
  onMove: (id: string, parentId: string | null) => void;
};

export function TaskTreeList({
  tree,
  collapsed,
  onToggle,
  blockedDropIds,
  onMove,
  ...actions
}: TreeProps) {
  const menu = useContextMenu();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(NO_BLOCKED);

  function endDrag() {
    setDragging(null);
    setOver(null);
    setBlocked(NO_BLOCKED);
  }

  function rows(nodes: TaskTreeNode[]): React.ReactNode {
    return nodes.map((node) => {
      const { task } = node;
      const hasChildren = node.children.length > 0;
      const open = !collapsed.has(task.id);
      const droppable = dragging !== null && dragging !== task.id && !blocked.has(task.id);
      const lead = hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(task.id)}
          aria-label={open ? `Collapse ${task.title}` : `Expand ${task.title}`}
          aria-expanded={open}
          className={`flex h-7 w-4 shrink-0 items-center justify-center text-mute transition-colors hover:text-text ${focusRing}`}
        >
          <TaskIcon name="chevron" className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      ) : undefined;
      return (
        <li key={task.id}>
          <TaskRow
            {...actions}
            task={task}
            depth={node.depth}
            lead={lead}
            menu={menu}
            className={over === task.id ? "ring-1 ring-accent-ring" : ""}
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
                if (!droppable) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (over !== task.id) setOver(task.id);
              },
              onDragLeave: () => setOver((current) => (current === task.id ? null : current)),
              onDrop: (event) => {
                if (!droppable) return;
                event.preventDefault();
                const id = event.dataTransfer.getData(DRAG_TYPE);
                endDrag();
                if (id) onMove(id, task.id);
              },
            }}
          />
          {hasChildren && open ? <ul>{rows(node.children)}</ul> : null}
        </li>
      );
    });
  }

  return (
    <div>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      <ul className="border-y border-line/60">{rows(tree)}</ul>
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
          className={`mt-2 rounded-lg border border-dashed px-3 py-1.5 text-center text-[10px] transition-colors ${
            over === ROOT_DROP ? "border-accent-dim text-text" : "border-line text-mute"
          }`}
        >
          Move to top level
        </div>
      ) : null}
    </div>
  );
}
