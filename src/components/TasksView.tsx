import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { SidebarDrawer, SidebarHeader, type Sidebar } from "./SidebarDrawer";
import { SplitHandle, useSplitPane } from "./SplitPane";
import { TaskDetailPane } from "./TaskDetailPane";
import { TaskForm } from "./TaskForm";
import { SMART_VIEWS, TaskListSidebar } from "./TaskListSidebar";
import { TaskIcon } from "./TaskIcon";
import { TaskTreeList } from "./TaskTreeList";
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
import { focusRing, sidebarHeaderAction } from "../lib/styles";
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
  buildTaskTreeOf,
  canReparentTask,
  flattenTaskTree,
  childCounts,
  taskAncestors,
  taskSubtree,
} from "../lib/taskTree";
import { TASKS_LEADING } from "../lib/splitPane";
import { utcToLocalInput } from "../lib/timezone";
import { flattenTree } from "../lib/tree";
import type { Task, TaskDraft, TaskList, TaskPatch } from "../lib/types";

type Props = {
  session: Session;
  tasks: Task[];
  taskLists: TaskList[];
  busy: boolean;
  timezone: string;
  onRefresh: () => Promise<unknown> | void;
  /**
   * Folds one action's writes into the vault listing. Without it every action
   * falls back to `onRefresh`, which re-reads the whole collection.
   */
  onApply?: (patch: TaskPatch) => void;
  readOnly?: boolean;
  sidebar: Sidebar;
  /** A task to bring into view, such as one opened from the calendar. */
  focusTaskId?: string;
  onFocusHandled?: () => void;
};

type FormState = { initial: TaskDraft; editingId: string | null; key: number };
type Notice = { message: string; previous: Task };

/** Idle time after the last write before the vault is re-read in the background. */
const REFRESH_IDLE_MS = 10_000;

export function TasksView({ session, tasks, taskLists, busy, timezone, onRefresh, onApply, readOnly, sidebar, focusTaskId, onFocusHandled }: Props) {
  const readOnlyMode = readOnly === true;
  const [requestedScope, setScope] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
  const [deletingList, setDeletingList] = useState<TaskList | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formCount = useRef(0);
  const [handledFocus, setHandledFocus] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | undefined>();
  // Remembered for the session, not for good: see `useSplitPane`.
  const split = useSplitPane("sealbook.tasks-split", TASKS_LEADING);

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
      setSelectedId(target.id);
      setForm(null);
      setExpanded((current) => {
        const next = new Set(current);
        for (const id of ancestors) next.add(id);
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
        const lists = await ensureDefaultTaskList(session, taskLists);
        if (onApply) onApply({ taskLists: lists });
        else await onRefresh();
      } catch (err) {
        setError(friendlyError(err));
      }
    })();
  }, [taskLists, onApply, onRefresh, readOnlyMode, session]);

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

  const scopeTree = useMemo(() => {
    if (!isSmart && !searching) return null;
    const scoped = isSmart
      ? tasks.filter((task) => inScope(task, scope as TaskScope, now, timezone))
      : tasks.filter((task) => resolveTaskListId(task.taskListId) === scope);
    return buildTaskTreeOf(scoped.filter((task) => taskMatches(task, deferredSearch)));
  }, [tasks, scope, isSmart, searching, deferredSearch, now, timezone]);

  const tree = useMemo(
    () => (isSmart ? [] : buildTaskTree(tasks, scope)),
    [tasks, scope, isSmart],
  );

  const selected = selectedId ? (tasks.find((task) => task.id === selectedId) ?? null) : null;
  const selectedParent = selected?.parentId
    ? tasks.find((task) => task.id === selected.parentId)
    : undefined;
  const subtasks = useMemo(
    () => (selected ? sortTasks(tasks.filter((task) => task.parentId === selected.id)) : []),
    [tasks, selected],
  );

  const disabled = busy || saving || readOnlyMode;

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function backgroundRefresh() {
    if (refreshTimer.current !== null) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    // A failed re-read changes nothing on screen: the patch already put the
    // write there, and the next one tries again.
    void Promise.resolve(onRefresh()).catch(() => {});
  }

  /**
   * Arms the trailing re-read. The patch keeps this view current, so the walk is
   * only for what another device wrote and for the offline snapshot, and waits
   * until the ticking and dragging has stopped.
   */
  function scheduleRefresh() {
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(backgroundRefresh, REFRESH_IDLE_MS);
  }

  useEffect(
    () => () => {
      if (refreshTimer.current === null) return;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    },
    [],
  );

  async function run(action: () => Promise<TaskPatch | void>): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const patch = await action();
      if (patch && onApply) {
        onApply(patch);
        scheduleRefresh();
      } else {
        await onRefresh();
      }
      return true;
    } catch (err) {
      setError(friendlyError(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function changeScope(next: string) {
    setScope(next);
    setSelectedId(null);
    setForm(null);
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
      setExpanded((current) => {
        const next = new Set(current);
        next.add(parentId);
        return next;
      });
    }
    openForm(initial, null);
  }

  async function saveForm(draft: TaskDraft) {
    if (!form) return;
    const { editingId } = form;
    const original = editingId ? tasks.find((task) => task.id === editingId) : undefined;
    let savedId = editingId;
    const ok = await run(async () => {
      const moved = original && resolveTaskListId(original.taskListId) !== draft.taskListId;
      const next = moved ? { ...draft, parentId: undefined } : draft;
      const saved = [await putTask(session, next, editingId ?? undefined)];
      savedId = saved[0]!.id;
      if (moved && editingId) {
        for (const id of taskSubtree(tasks, editingId).slice(1)) {
          const child = tasks.find((task) => task.id === id);
          if (child) saved.push(await putTask(session, { ...child, taskListId: draft.taskListId }, id));
        }
      }
      return { tasks: saved };
    });
    if (ok) {
      setForm(null);
      setSelectedId(savedId);
    }
  }

  async function toggleDone(task: Task) {
    setNotice(null);
    const finishing = !task.done;
    const draft = finishing ? completeTask(task, new Date(), timezone) : reopenTask(task);
    const ok = await run(async () => ({ tasks: [await putTask(session, draft, task.id)] }));
    if (ok && finishing && task.recurrence && !draft.done) {
      const label = dueLabel({ ...task, dueDate: draft.dueDate }, new Date(), timezone);
      setNotice({ message: `"${task.title}" is next due ${label ?? "later"}.`, previous: task });
    }
  }

  async function undo(previous: Task) {
    setNotice(null);
    await run(async () => ({ tasks: [await putTask(session, previous, previous.id)] }));
  }

  async function removeTask(task: Task) {
    const ok = await run(async () => {
      const saved: Task[] = [];
      for (const child of tasks) {
        if (child.parentId !== task.id) continue;
        saved.push(await putTask(session, { ...child, parentId: task.parentId }, child.id));
      }
      await deleteTask(session, task.id);
      return { tasks: saved, removedTaskIds: [task.id] };
    });
    if (ok) {
      setConfirmDelete(null);
      if (form?.editingId === task.id) setForm(null);
      if (selectedId === task.id) setSelectedId(task.parentId ?? null);
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
    const parent = parentId ? tasks.find((entry) => entry.id === parentId) : undefined;
    const listId = resolveTaskListId((parent ?? task).taskListId);
    const relisted = listId !== resolveTaskListId(task.taskListId);
    if ((task.parentId ?? null) === parentId && !relisted) return;
    if (parentId) {
      setExpanded((current) => {
        const next = new Set(current);
        next.add(parentId);
        return next;
      });
    }
    // A subtask follows its parent into another list, and its own subtasks follow it.
    await run(async () => {
      const written = [
        await putTask(
          session,
          { ...task, parentId: parentId ?? undefined, taskListId: relisted ? listId : task.taskListId },
          id,
        ),
      ];
      if (relisted) {
        for (const childId of taskSubtree(tasks, id).slice(1)) {
          const child = tasks.find((entry) => entry.id === childId);
          if (child) written.push(await putTask(session, { ...child, taskListId: listId }, childId));
        }
      }
      return { tasks: written };
    });
  }

  async function createList(name: string, parentId?: string): Promise<string | undefined> {
    let created: string | undefined;
    await run(async () => {
      const list = await putTaskList(session, name, parentId);
      created = list.id;
      return { taskLists: [list] };
    });
    return created;
  }

  async function renameList(list: TaskList, name: string) {
    await run(async () => ({
      taskLists: [await putTaskList(session, name, list.parentId, list.id, list.raw, list.color)],
    }));
  }

  async function recolorList(list: TaskList, color: string) {
    await run(async () => ({
      taskLists: [await putTaskList(session, list.name, list.parentId, list.id, list.raw, color)],
    }));
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
    await run(async () => ({
      taskLists: [
        await putTaskList(session, list.name, parentId ?? undefined, list.id, list.raw, list.color),
      ],
    }));
  }

  async function removeList(list: TaskList) {
    const parentId = list.parentId;
    const ok = await run(async () => {
      const savedLists: TaskList[] = [];
      for (const child of taskLists) {
        if (child.parentId !== list.id) continue;
        savedLists.push(
          await putTaskList(session, child.name, parentId, child.id, child.raw, child.color),
        );
      }
      const savedTasks: Task[] = [];
      for (const task of tasks) {
        if (resolveTaskListId(task.taskListId) !== list.id) continue;
        savedTasks.push(
          await putTask(session, { ...task, taskListId: parentId ?? DEFAULT_TASK_LIST_ID }, task.id),
        );
      }
      await deleteTaskList(session, list.id);
      return { tasks: savedTasks, taskLists: savedLists, removedTaskListIds: [list.id] };
    });
    if (ok) {
      if (scope === list.id) changeScope(parentId ?? "all");
      setDeletingList(null);
    }
  }

  const actions: TaskActions = {
    now,
    timezone,
    readOnly: readOnlyMode || saving,
    counts,
    highlightId,
    activeId: selectedId ?? undefined,
    // Only a smart view or a search mixes lists, and only with a second list is
    // the pill worth the row's width.
    listNameFor:
      isSmart && taskLists.length > 1
        ? (task) => taskListNameById(taskLists, task.taskListId)
        : undefined,
    onToggleDone: (task) => void toggleDone(task),
    onSelect: (task) => {
      setForm(null);
      setSelectedId(task.id);
    },
    onEdit: (task) => {
      setSelectedId(task.id);
      openForm({ ...task }, task.id);
    },
    onAddChild: (parentId) => startAdd(parentId),
    onDelete: (task) => setConfirmDelete(task),
  };

  const title = isSmart
    ? (SMART_VIEWS.find((view) => view.id === scope)?.label ?? "Tasks")
    : (taskLists.find((list) => list.id === scope)?.name ?? "Tasks");
  const shown = scopeTree
    ? flattenTaskTree(scopeTree).length
    : tasks.filter((task) => resolveTaskListId(task.taskListId) === scope).length;
  const paneOpen = form !== null || selected !== null;

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
          <SidebarHeader
            eyebrow="My to-dos"
            title="Tasks"
            action={
              !readOnlyMode ? (
                <button
                  type="button"
                  onClick={() => {
                    startAdd();
                    sidebar.close();
                  }}
                  disabled={disabled}
                  aria-label="Create task"
                  title="Create task"
                  className={sidebarHeaderAction}
                >
                  <TaskIcon name="plus" className="h-4 w-4" />
                </button>
              ) : null
            }
          />
          <TaskListSidebar
            lists={taskLists}
            scope={scope}
            onScope={changeScope}
            smartCounts={smartCounts}
            listCounts={listCounts}
            readOnly={readOnlyMode}
            onCreate={createList}
            onRename={renameList}
            onRecolor={recolorList}
            onMove={moveList}
            onDelete={setDeletingList}
          />
        </SidebarDrawer>

        <section className="order-1 flex min-w-0 flex-col overflow-hidden lg:order-none lg:min-h-0">
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

          <div
            ref={split.containerRef}
            style={split.cols}
            className="sb-split grid min-h-0 flex-1"
          >
            <div className={`min-w-0 overflow-y-auto ${paneOpen ? "hidden lg:block" : ""}`}>
              {scopeTree ? (
                scopeTree.length === 0 ? (
                  <p className="px-6 py-12 text-center text-sm text-mute">
                    {searching ? "No tasks match that search." : "Nothing here."}
                  </p>
                ) : (
                  <TaskTreeList
                    {...actions}
                    tree={scopeTree}
                    expanded={expanded}
                    onToggle={toggleExpanded}
                    blockedDropIds={(id) => new Set(taskSubtree(tasks, id))}
                    onMove={(id, parentId) => void moveTask(id, parentId)}
                  />
                )
              ) : tree.length === 0 ? (
                <p className="px-6 py-12 text-center text-sm text-mute">
                  No tasks in this list yet. Tasks are encrypted on this device before they leave it.
                </p>
              ) : (
                <TaskTreeList
                  {...actions}
                  tree={tree}
                  expanded={expanded}
                  onToggle={toggleExpanded}
                  blockedDropIds={(id) => new Set(taskSubtree(tasks, id))}
                  onMove={(id, parentId) => void moveTask(id, parentId)}
                />
              )}
            </div>

            <SplitHandle split={split} label="Resize the task list" />

            <div className={`min-w-0 flex-col overflow-hidden lg:flex ${paneOpen ? "flex" : "hidden"}`}>
              {form ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:h-dvh max-lg:w-screen">
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-5">
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
                  </div>
                </div>
              ) : selected ? (
                <TaskDetailPane
                  key={selected.id}
                  task={selected}
                  listName={taskListNameById(taskLists, selected.taskListId)}
                  parent={selectedParent}
                  subtasks={subtasks}
                  now={now}
                  timezone={timezone}
                  readOnly={readOnlyMode}
                  busy={disabled}
                  onToggleDone={(task) => void toggleDone(task)}
                  onEdit={(task) => openForm({ ...task }, task.id)}
                  onAddChild={(parentId) => startAdd(parentId)}
                  onDelete={(task) => setConfirmDelete(task)}
                  onSelect={(task) => setSelectedId(task.id)}
                  onClose={() => setSelectedId(null)}
                />
              ) : (
                <div className="hidden min-h-56 flex-1 items-center justify-center px-6 text-center lg:flex">
                  <p className="max-w-xs text-sm leading-relaxed text-mute">
                    Select a task to see its details.
                  </p>
                </div>
              )}
            </div>
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
