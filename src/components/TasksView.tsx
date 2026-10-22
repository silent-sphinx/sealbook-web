import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { SidebarDrawer, SidebarHeader, type Sidebar } from "./SidebarDrawer";
import { TaskForm } from "./TaskForm";
import { SMART_VIEWS, TaskListSidebar } from "./TaskListSidebar";
import { TaskIcon } from "./TaskIcon";
import { TaskFlatList, TaskTreeList } from "./TaskTreeList";
import type { TaskActions } from "./TaskTreeList";
import {
  deleteTask,
  deleteTaskList,
  ensureDefaultTaskList,
  putTask,
  putTaskList,
  type Session,
} from "../lib/client";
import { friendlyError } from "../lib/errors";
import { focusRing } from "../lib/styles";
import {
  buildTaskListTree,
  canMoveTaskList,
  completeTask,
  DEFAULT_TASK_LIST_ID,
  dueLabel,
  emptyTaskDraft,
  inScope,
  reopenTask,
  resolveTaskListId,
  sortTasks,
  taskListNameById,
  taskMatches,
} from "../lib/task";
import type { TaskScope } from "../lib/task";
import {
  buildTaskTree,
  canReparentTask,
  childCounts,
  taskAncestors,
  taskSubtree,
} from "../lib/taskTree";
import { utcToLocalInput } from "../lib/timezone";
import { flattenTree } from "../lib/tree";
import type { Task, TaskDraft, TaskList } from "../lib/types";

type Props = {
  session: Session;
  tasks: Task[];
  taskLists: TaskList[];
  busy: boolean;
  timezone: string;
  onRefresh: () => Promise<unknown> | void;
  readOnly?: boolean;
  sidebar: Sidebar;
  /** A task to bring into view, such as one opened from the calendar. */
  focusTaskId?: string;
  onFocusHandled?: () => void;
};

type FormState = { initial: TaskDraft; editingId: string | null; key: number };
type Notice = { message: string; previous: Task };

export function TasksView({ session, tasks, taskLists, busy, timezone, onRefresh, readOnly, sidebar, focusTaskId, onFocusHandled }: Props) {
  const readOnlyMode = readOnly === true;
  const [requestedScope, setScope] = useState<string>("all");
  const [now, setNow] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
  const [deletingList, setDeletingList] = useState<TaskList | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formCount = useRef(0);
  const [handledFocus, setHandledFocus] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | undefined>();

  if (!focusTaskId && handledFocus !== null) {
    setHandledFocus(null);
  } else if (focusTaskId && focusTaskId !== handledFocus) {
    setHandledFocus(focusTaskId);
    const target = tasks.find((task) => task.id === focusTaskId);
    if (target) {
      const ancestors = taskAncestors(tasks, target.id);
      setScope(resolveTaskListId(target.taskListId));
      setSearch("");
      setHighlightId(target.id);
      setCollapsed((current) => {
        const next = new Set(current);
        for (const id of ancestors) next.delete(id);
        return next;
      });
    }
  }

  useEffect(() => {
    if (focusTaskId) onFocusHandled?.();
  }, [focusTaskId, onFocusHandled]);

  useEffect(() => {
    if (!highlightId) return;
    document.querySelector(`[data-task-id="${highlightId}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [highlightId, tasks]);

  const ensuredRef = useRef(false);
  useEffect(() => {
    if (readOnlyMode || ensuredRef.current) return;
    ensuredRef.current = true;
    if (taskLists.some((list) => list.id === DEFAULT_TASK_LIST_ID)) return;
    void (async () => {
      try {
        await ensureDefaultTaskList(session, taskLists);
        await onRefresh();
      } catch (err) {
        setError(friendlyError(err));
      }
    })();
  }, [taskLists, onRefresh, readOnlyMode, session]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const isSmart =
    SMART_VIEWS.some((view) => view.id === requestedScope) ||
    !taskLists.some((list) => list.id === requestedScope);
  const scope = isSmart && !SMART_VIEWS.some((view) => view.id === requestedScope) ? "all" : requestedScope;

  const deferredSearch = useDeferredValue(search);
  const searching = deferredSearch.trim() !== "";
  const listRows = useMemo(() => flattenTree(buildTaskListTree(taskLists)), [taskLists]);
  const counts = useMemo(() => childCounts(tasks), [tasks]);

  const smartCounts = useMemo(() => {
    const open = tasks.filter((task) => !task.done);
    return {
      today: tasks.filter((task) => inScope(task, "today", now, timezone)).length,
      overdue: tasks.filter((task) => inScope(task, "overdue", now, timezone)).length,
      all: open.length,
      completed: tasks.length - open.length,
    } satisfies Record<TaskScope, number>;
  }, [tasks, now, timezone]);

  const listCounts = useMemo(() => {
    const result = new Map<string, number>();
    for (const task of tasks) {
      if (task.done) continue;
      const id = resolveTaskListId(task.taskListId);
      result.set(id, (result.get(id) ?? 0) + 1);
    }
    return result;
  }, [tasks]);

  const flat = useMemo(() => {
    if (!isSmart && !searching) return null;
    const scoped = isSmart
      ? tasks.filter((task) => inScope(task, scope as TaskScope, now, timezone))
      : tasks.filter((task) => resolveTaskListId(task.taskListId) === scope);
    return sortTasks(scoped.filter((task) => taskMatches(task, deferredSearch)));
  }, [tasks, scope, isSmart, searching, deferredSearch, now, timezone]);

  const tree = useMemo(
    () => (isSmart ? [] : buildTaskTree(tasks, scope)),
    [tasks, scope, isSmart],
  );

  const disabled = busy || saving || readOnlyMode;

  async function run(action: () => Promise<void>): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      await action();
      await onRefresh();
      return true;
    } catch (err) {
      setError(friendlyError(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function openForm(initial: TaskDraft, editingId: string | null) {
    formCount.current += 1;
    setForm({ initial, editingId, key: formCount.current });
    setError(null);
  }

  function startAdd(parentId?: string) {
    const parent = parentId ? tasks.find((task) => task.id === parentId) : undefined;
    const listId = parent ? resolveTaskListId(parent.taskListId) : isSmart ? DEFAULT_TASK_LIST_ID : scope;
    const initial = emptyTaskDraft(listId, parentId);
    if (!parent && scope === "today") {
      initial.dueDate = utcToLocalInput(new Date().toISOString(), timezone).slice(0, 10);
    }
    if (parentId) {
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(parentId);
        return next;
      });
    }
    openForm(initial, null);
  }

  async function saveForm(draft: TaskDraft) {
    if (!form) return;
    const { editingId } = form;
    const original = editingId ? tasks.find((task) => task.id === editingId) : undefined;
    const ok = await run(async () => {
      const moved = original && resolveTaskListId(original.taskListId) !== draft.taskListId;
      const next = moved ? { ...draft, parentId: undefined } : draft;
      await putTask(session, next, editingId ?? undefined);
      if (moved && editingId) {
        for (const id of taskSubtree(tasks, editingId).slice(1)) {
          const child = tasks.find((task) => task.id === id);
          if (child) await putTask(session, { ...child, taskListId: draft.taskListId }, id);
        }
      }
    });
    if (ok) setForm(null);
  }

  async function toggleDone(task: Task) {
    setNotice(null);
    const finishing = !task.done;
    const draft = finishing ? completeTask(task, new Date(), timezone) : reopenTask(task);
    const ok = await run(async () => {
      await putTask(session, draft, task.id);
    });
    if (ok && finishing && task.recurrence && !draft.done) {
      const label = dueLabel({ ...task, dueDate: draft.dueDate }, new Date(), timezone);
      setNotice({ message: `"${task.title}" is next due ${label ?? "later"}.`, previous: task });
    }
  }

  async function undo(previous: Task) {
    setNotice(null);
    await run(async () => {
      await putTask(session, previous, previous.id);
    });
  }

  async function removeTask(task: Task) {
    const ok = await run(async () => {
      for (const child of tasks) {
        if (child.parentId === task.id) await putTask(session, { ...child, parentId: task.parentId }, child.id);
      }
      await deleteTask(session, task.id);
    });
    if (ok) {
      setConfirmDelete(null);
      if (form?.editingId === task.id) setForm(null);
    }
  }

  async function moveTask(id: string, parentId: string | null) {
    if (readOnlyMode) return;
    const task = tasks.find((entry) => entry.id === id);
    if (!task) return;
    if (!canReparentTask(tasks, id, parentId)) {
      setError("A task cannot be moved inside itself.");
      return;
    }
    if ((task.parentId ?? null) === parentId) return;
    if (parentId) {
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(parentId);
        return next;
      });
    }
    await run(async () => {
      await putTask(session, { ...task, parentId: parentId ?? undefined }, id);
    });
  }

  async function createList(name: string, parentId?: string): Promise<string | undefined> {
    let created: string | undefined;
    await run(async () => {
      created = await putTaskList(session, name, parentId);
    });
    return created;
  }

  async function renameList(list: TaskList, name: string) {
    await run(async () => {
      await putTaskList(session, name, list.parentId, list.id, list.raw, list.color);
    });
  }

  async function moveList(id: string, parentId: string | null) {
    if (readOnlyMode) return;
    const list = taskLists.find((entry) => entry.id === id);
    if (!list) return;
    if (!canMoveTaskList(taskLists, id, parentId)) {
      setError("A list cannot be moved inside itself.");
      return;
    }
    if ((list.parentId ?? null) === parentId) return;
    await run(async () => {
      await putTaskList(session, list.name, parentId ?? undefined, list.id, list.raw, list.color);
    });
  }

  async function removeList(list: TaskList) {
    const parentId = list.parentId;
    const ok = await run(async () => {
      for (const child of taskLists) {
        if (child.parentId !== list.id) continue;
        await putTaskList(session, child.name, parentId, child.id, child.raw, child.color);
      }
      for (const task of tasks) {
        if (resolveTaskListId(task.taskListId) !== list.id) continue;
        await putTask(session, { ...task, taskListId: parentId ?? DEFAULT_TASK_LIST_ID }, task.id);
      }
      await deleteTaskList(session, list.id);
    });
    if (ok) {
      if (scope === list.id) setScope(parentId ?? "all");
      setDeletingList(null);
    }
  }

  const actions: TaskActions = {
    now,
    timezone,
    readOnly: readOnlyMode || saving,
    counts,
    highlightId,
    onToggleDone: (task) => void toggleDone(task),
    onEdit: (task) => openForm({ ...task }, task.id),
    onAddChild: (parentId) => startAdd(parentId),
    onDelete: (task) => setConfirmDelete(task),
  };

  const title = isSmart
    ? (SMART_VIEWS.find((view) => view.id === scope)?.label ?? "Tasks")
    : (taskLists.find((list) => list.id === scope)?.name ?? "Tasks");
  const shown = flat ? flat.length : tasks.filter((task) => resolveTaskListId(task.taskListId) === scope).length;

  return (
    <main className="flex h-[calc(100dvh-var(--sb-header-h,74px))] flex-col overflow-hidden bg-bg pb-[env(safe-area-inset-bottom)] text-text lg:pb-0">
      {error ? (
        <p role="alert" className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-xs text-danger lg:px-6">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="flex shrink-0 items-center gap-3 border-b border-line bg-panel/60 px-4 py-2 text-xs text-mute lg:px-6">
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={() => void undo(notice.previous)}
            className={`rounded-md px-1.5 font-semibold text-accent hover:underline ${focusRing}`}
          >
            Undo
          </button>
        </p>
      ) : null}

      <div className="sb-shell grid min-h-0 flex-1" style={sidebar.cols}>
        <SidebarDrawer title="Tasks" sidebar={sidebar}>
          <SidebarHeader eyebrow="My to-dos" title="Tasks" />
          <TaskListSidebar
            lists={taskLists}
            scope={scope}
            onScope={setScope}
            smartCounts={smartCounts}
            listCounts={listCounts}
            readOnly={readOnlyMode}
            onCreate={createList}
            onRename={renameList}
            onMove={moveList}
            onDelete={setDeletingList}
          />
        </SidebarDrawer>

        <section className="flex min-h-0 flex-col overflow-hidden">
          <header className="flex flex-col gap-2.5 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-3.5 lg:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
              <span className="ml-1 shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-mute">
                {shown}
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
                  <TaskIcon name="plus" />
                  <span className="hidden sm:inline">New task</span>
                  <span className="sm:hidden">New</span>
                </button>
              ) : null}
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <TaskIcon
                  name="search"
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mute"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search tasks"
                  aria-label="Search tasks"
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
                    <TaskIcon name="close" className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 lg:px-6">
            {form ? (
              <TaskForm
                key={form.key}
                initial={form.initial}
                editing={form.editingId !== null}
                listOptions={listRows.map(({ item, depth }) => ({ id: item.id, name: item.name, depth }))}
                timezone={timezone}
                disabled={disabled}
                onSubmit={(draft) => void saveForm(draft)}
                onCancel={() => setForm(null)}
              />
            ) : null}

            {flat ? (
              flat.length === 0 ? (
                <p className="py-12 text-center text-sm text-mute">
                  {searching ? "No tasks match that search." : "Nothing here."}
                </p>
              ) : (
                <TaskFlatList
                  {...actions}
                  tasks={flat}
                  captionFor={(task) => (isSmart ? taskListNameById(taskLists, task.taskListId) : undefined)}
                />
              )
            ) : tree.length === 0 ? (
              <p className="py-12 text-center text-sm text-mute">
                No tasks in this list yet. Tasks are encrypted on this device before they leave it.
              </p>
            ) : (
              <TaskTreeList
                {...actions}
                tree={tree}
                collapsed={collapsed}
                onToggle={(id) =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                blockedDropIds={(id) => new Set(taskSubtree(tasks, id))}
                onMove={(id, parentId) => void moveTask(id, parentId)}
              />
            )}
          </div>
        </section>
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete task"
          heading="Delete task"
          body={`"${confirmDelete.title}" will be removed from every device signed in to this account. Its subtasks are kept and move up one level.`}
          confirmLabel="Delete"
          tone="danger"
          busy={saving}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => void removeTask(confirmDelete)}
        />
      ) : null}

      {deletingList ? (
        <ConfirmDialog
          title="Delete list"
          heading="Delete list"
          body={`"${deletingList.name}" will be removed. The tasks and lists inside it are kept and move up one level.`}
          confirmLabel="Delete"
          tone="danger"
          busy={saving}
          onClose={() => setDeletingList(null)}
          onConfirm={() => void removeList(deletingList)}
        />
      ) : null}
    </main>
  );
}
