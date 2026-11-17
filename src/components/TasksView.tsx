import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { SidebarDrawer, SidebarHeader, type Sidebar } from "./SidebarDrawer";
import { SplitHandle, useSplitPane } from "./SplitPane";
import { TaskDetailPane } from "./TaskDetailPane";
import { TaskForm } from "./TaskForm";
import { SMART_VIEWS, TaskListSidebar } from "./TaskListSidebar";
import { TaskAgendaList } from "./TaskAgendaList";
import { TaskTreeList } from "./TaskTreeList";
import type { TaskActions } from "./TaskTreeList";
import {
  ensureDefaultTaskList,
  deleteTask,
  deleteTaskList,
  putTask,
  putTaskList,
  type Session,
} from "../lib/client";
import { friendlyError } from "../lib/errors";
import {
  btnHeader,
  focusRing,
  paneCount,
  paneHeader,
  paneTitle,
  searchClear,
  searchField,
  searchIcon,
  sidebarHeaderAction,
} from "../lib/styles";
import {
  buildTaskListTree,
  dueLabel,
  DEFAULT_TASK_LIST_ID,
  draftFrom,
  emptyTaskDraft,
  inScope,
  listTo,
  reopenTask,
  resolveTaskListId,
  sortTasks,
  taskAgenda,
  taskDraft,
  taskListNameById,
  taskListTone,
  taskMatches,
  taskTo,
  tickTask,
} from "../lib/task";
import type { TaskScope } from "../lib/task";
import {
  buildTaskTree,
  buildTaskTreeOf,
  flattenTaskTree,
  childCounts,
  taskAncestors,
  taskSubtree,
} from "../lib/taskTree";
import { TASKS_LEADING } from "../lib/splitPane";
import { keyFor } from "../lib/calendarModel";
import { utcToLocalInput } from "../lib/timezone";
import { flattenTree } from "../lib/tree";
import type { Task, TaskDraft, TaskList, TaskPatch } from "../lib/types";
import {
  coreTaskListMovePlan,
  coreTaskListRemovePlan,
  coreTaskMovePlan,
  coreTaskRelistPlan,
  coreTaskRemovePlan,
} from "../lib/wasm";
import type { CoreTaskPlan } from "../lib/wasm";
import { Icon } from "./Icon";
import { EmptyState } from "./EmptyState";

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

/**
 * Writes what a core task plan names: lists, then tasks, then the deletes, so
 * nothing is removed before what it held has moved.
 */
async function writeTaskPlan(session: Session, plan: CoreTaskPlan): Promise<TaskPatch> {
  const taskLists: TaskList[] = [];
  for (const { id, draft } of plan.lists) {
    taskLists.push(await putTaskList(session, draft.name, draft.parent_id, id, draft.raw, draft.color));
  }
  const tasks: Task[] = [];
  for (const { id, draft } of plan.tasks) tasks.push(await putTask(session, draftFrom(draft), id));
  for (const id of plan.removed_tasks) await deleteTask(session, id);
  for (const id of plan.removed_lists) await deleteTaskList(session, id);
  return {
    tasks,
    taskLists,
    removedTaskIds: plan.removed_tasks,
    removedTaskListIds: plan.removed_lists,
  };
}

type FormState = { initial: TaskDraft; editingId: string | null; key: number };
type Notice = { message: string; previous: Task; reopened: Task[] };

/** Idle time after the last write before the vault is re-read in the background. */
const REFRESH_IDLE_MS = 10_000;

export function TasksView({ session, tasks, taskLists, busy, timezone, onRefresh, onApply, readOnly, sidebar, focusTaskId, onFocusHandled }: Props) {
  const readOnlyMode = readOnly === true;
  const [requestedScope, setScope] = useState<string>("upnext");
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
  const listTones = useMemo(
    () => new Map(taskLists.map((list) => [list.id, taskListTone(taskLists, list.id)])),
    [taskLists],
  );

  const agenda = useMemo(() => taskAgenda(tasks, now, timezone), [tasks, now, timezone]);
  const smartCounts = useMemo(() => {
    const open = tasks.filter((task) => !task.done).length;
    return {
      upnext: open,
      all: open,
      completed: tasks.length - open,
    } satisfies Record<TaskScope, number>;
  }, [tasks]);

  const listCounts = useMemo(() => {
    const result = new Map<string, number>();
    for (const task of tasks) {
      if (task.done) continue;
      const id = resolveTaskListId(task.taskListId);
      result.set(id, (result.get(id) ?? 0) + 1);
    }
    return result;
  }, [tasks]);

  const showAgenda = scope === "upnext" && !searching;
  const scopeTree = useMemo(() => {
    if ((!isSmart && !searching) || showAgenda) return null;
    const scoped = isSmart
      ? tasks.filter((task) => inScope(task, scope as TaskScope))
      : tasks.filter((task) => resolveTaskListId(task.taskListId) === scope);
    return buildTaskTreeOf(scoped.filter((task) => taskMatches(task, deferredSearch)));
  }, [tasks, scope, isSmart, searching, showAgenda, deferredSearch]);

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

  function startAddDue(offset: number) {
    const initial = emptyTaskDraft(DEFAULT_TASK_LIST_ID);
    const day = new Date(`${utcToLocalInput(new Date().toISOString(), timezone).slice(0, 10)}T12:00`);
    day.setDate(day.getDate() + offset);
    initial.dueDate = keyFor(day);
    openForm(initial, null);
  }

  function startAdd(parentId?: string, inList?: string) {
    const parent = parentId ? tasks.find((task) => task.id === parentId) : undefined;
    const listId = parent
      ? resolveTaskListId(parent.taskListId)
      : (inList ?? (isSmart ? DEFAULT_TASK_LIST_ID : scope));
    const initial = emptyTaskDraft(listId, parentId);
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
      const saved = await putTask(session, next, editingId ?? undefined);
      savedId = saved.id;
      if (!moved || !editingId) return { tasks: [saved] };
      const followers = await writeTaskPlan(
        session,
        coreTaskRelistPlan(tasks.map(taskTo), editingId, draft.taskListId),
      );
      return { tasks: [saved, ...(followers.tasks ?? [])] };
    });
    if (ok) {
      setForm(null);
      setSelectedId(savedId);
    }
  }

  async function toggleDone(task: Task) {
    setNotice(null);
    const finishing = !task.done;
    const tick = finishing ? tickTask(task, tasks, new Date(), timezone) : null;
    const draft = tick ? tick.draft : reopenTask(task);
    const reopenedIds = new Set(tick?.reopened.map((entry) => entry.id) ?? []);
    const reopened = tasks.filter((candidate) => reopenedIds.has(candidate.id));
    const ok = await run(async () => {
      const saved = [await putTask(session, draft, task.id)];
      for (const entry of tick?.reopened ?? []) saved.push(await putTask(session, entry.draft, entry.id));
      return { tasks: saved };
    });
    if (ok && tick?.rolled) {
      const label = dueLabel({ ...task, dueDate: draft.dueDate }, new Date(), timezone);
      setNotice({ message: `"${task.title}" is next due ${label ?? "later"}.`, previous: task, reopened });
    }
  }

  async function undo(previous: Task, reopened: Task[]) {
    setNotice(null);
    await run(async () => {
      const saved = [await putTask(session, taskDraft(previous), previous.id)];
      for (const child of reopened) saved.push(await putTask(session, taskDraft(child), child.id));
      return { tasks: saved };
    });
  }

  async function removeTask(task: Task) {
    const ok = await run(() => writeTaskPlan(session, coreTaskRemovePlan(tasks.map(taskTo), task.id)));
    if (ok) {
      setConfirmDelete(null);
      if (form?.editingId === task.id) setForm(null);
      if (selectedId === task.id) setSelectedId(task.parentId ?? null);
    }
  }

  async function moveTask(id: string, parentId: string | null) {
    if (readOnlyMode) return;
    const plan = coreTaskMovePlan(tasks.map(taskTo), id, parentId ?? undefined);
    if (plan.refusal) {
      setError(plan.refusal);
      return;
    }
    if (plan.tasks.length === 0) return;
    if (parentId) {
      setExpanded((current) => {
        const next = new Set(current);
        next.add(parentId);
        return next;
      });
    }
    await run(() => writeTaskPlan(session, plan));
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
    const plan = coreTaskListMovePlan(taskLists.map(listTo), id, parentId ?? undefined);
    if (plan.refusal) {
      setError(plan.refusal);
      return;
    }
    if (plan.lists.length === 0) return;
    await run(() => writeTaskPlan(session, plan));
  }

  async function removeList(list: TaskList) {
    const plan = coreTaskListRemovePlan(taskLists.map(listTo), tasks.map(taskTo), list.id);
    if (plan.refusal) {
      setError(plan.refusal);
      return;
    }
    const ok = await run(() => writeTaskPlan(session, plan));
    if (ok) {
      if (scope === list.id) changeScope(list.parentId ?? "all");
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
    listFor:
      isSmart && taskLists.length > 1
        ? (task) => ({
            name: taskListNameById(taskLists, task.taskListId),
            tone: listTones.get(task.taskListId) ?? taskListTone(taskLists, task.taskListId),
          })
        : undefined,
    onToggleDone: (task) => void toggleDone(task),
    onSelect: (task) => {
      setForm(null);
      setSelectedId(task.id);
    },
    onEdit: (task) => {
      setSelectedId(task.id);
      openForm(taskDraft(task), task.id);
    },
    onAddChild: (parentId) => startAdd(parentId),
    onDelete: (task) => setConfirmDelete(task),
  };

  const title = isSmart
    ? (SMART_VIEWS.find((view) => view.id === scope)?.label ?? "Tasks")
    : (taskLists.find((list) => list.id === scope)?.name ?? "Tasks");
  const shown = showAgenda
    ? smartCounts.upnext
    : scopeTree
    ? flattenTaskTree(scopeTree).length
    : tasks.filter((task) => resolveTaskListId(task.taskListId) === scope).length;
  const paneOpen = form !== null || selected !== null;

  return (
    <main className="flex h-[calc(100dvh-var(--sb-header-h,74px))] flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] text-text lg:pb-0">
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
            onClick={() => void undo(notice.previous, notice.reopened)}
            className={`rounded-md px-1.5 font-semibold text-accent hover:underline ${focusRing}`}
          >
            Undo
          </button>
        </p>
      ) : null}

      <div className="sb-shell grid min-h-0 flex-1" style={sidebar.cols}>
        <SidebarDrawer title="Tasks" sidebar={sidebar}>
          <SidebarHeader
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
                  <Icon name="plus" className="h-4 w-4" />
                </button>
              ) : null
            }
          />
          <TaskListSidebar
            lists={taskLists}
            scope={scope}
            onScope={changeScope}
            smartCounts={smartCounts}
            overdueCount={agenda.overdue.length}
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
          <header className={paneHeader}>
            <div className="flex min-w-0 items-center gap-2">
              <h1 className={paneTitle}>{title}</h1>
              <span className={paneCount}>
                {shown}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              {!readOnlyMode ? (
                <button
                  type="button"
                  onClick={() => startAdd()}
                  disabled={disabled}
                  className={btnHeader}
                >
                  <Icon name="plus" />
                  <span className="hidden sm:inline">New task</span>
                  <span className="sm:hidden">New</span>
                </button>
              ) : null}
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Icon
                  name="search"
                  className={searchIcon}
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search tasks"
                  aria-label="Search tasks"
                  className={`${searchField} sm:w-52 sm:focus:w-72`}
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className={searchClear}
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    <Icon name="close" className="h-3 w-3" />
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
              {showAgenda ? (
                <TaskAgendaList
                  {...actions}
                  agenda={agenda}
                  tasks={tasks}
                  onAddDue={readOnlyMode ? undefined : startAddDue}
                />
              ) : scopeTree ? (
                scopeTree.length === 0 ? (
                  searching ? (
                    <EmptyState title="No tasks match that search." />
                  ) : (
                    <EmptyState
                      title="No tasks here"
                      body="Tasks you add to this list appear here."
                    />
                  )
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
                  onEdit={(task) => openForm(taskDraft(task), task.id)}
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
          heading={`Delete “${confirmDelete.title}”?`}
          body={`It will be removed from every device signed in to this account. Its subtasks are kept and move up one level.`}
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
          heading={`Delete “${deletingList.name}”?`}
          body={`The list will be removed. The tasks and lists inside it are kept and move up one level.`}
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
