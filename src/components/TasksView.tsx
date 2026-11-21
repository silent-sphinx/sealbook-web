import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrashPanel, TrashRow, trashRootsFor } from "./Trash";
import { NO_TRASH, type TrashListing } from "../lib/trash";
import { trashItems } from "../lib/trashApi";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { SidebarDrawer, SidebarHeader, type Sidebar } from "./SidebarDrawer";
import { SplitHandle, useSplitPane } from "./SplitPane";
import { TaskDetailPane } from "./TaskDetailPane";
import { TagFilterMenu } from "./TagFilterMenu";
import { TaskForm } from "./TaskForm";
import { SMART_VIEWS, TaskListSidebar } from "./TaskListSidebar";
import { TaskAgendaList, agendaVisibleIds, useAgendaFolds } from "./TaskAgendaList";
import { TaskTreeList } from "./TaskTreeList";
import type { TaskActions, TaskSelection } from "./TaskTreeList";
import {
  ensureDefaultTaskList,
  deleteTask,
  deleteTaskList,
  putTask,
  putTaskList,
  type Session,
} from "../lib/client";
import { archivedIds, hiddenIds } from "../lib/archive";
import { friendlyError } from "../lib/errors";
import {
  btnPrimarySm,
  focusRing,
  searchClear,
  searchField,
  searchIcon,
  viewMain,
  viewGrid,
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
  visibleTaskIds,
} from "../lib/taskTree";
import { planTaskBulk, type TaskBulkChange } from "../lib/taskBulk";
import { useItemSelection } from "../lib/useItemSelection";
import { TASKS_LEADING } from "../lib/splitPane";
import { keyFor } from "../lib/calendarModel";
import { utcToLocalInput } from "../lib/timezone";
import { hasTag, tagVocabulary } from "../lib/tags";
import { flattenTree } from "../lib/tree";
import type { Task, TaskDraft, TaskList, TaskPatch } from "../lib/types";
import {
  coreTaskListMovePlan,
  coreTaskMovePlan,
  coreTaskRelistPlan,
} from "../lib/wasm";
import type { CoreTaskPlan } from "../lib/wasm";
import { Icon } from "./Icon";
import { PaneHeader, BulkBar, BulkMove } from "./PaneControls";
import { Banner } from "./Banner";
import { EmptyState } from "./EmptyState";

type Props = {
  session: Session;
  /** What is in the trash; the Tasks tab lists its tasks and lists. */
  trash?: TrashListing;
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
    taskLists.push(await putTaskList(session, draft.name, draft.parent_id, id, draft.raw, draft.color, draft.archived));
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const bulkControl =
  "box-border h-7 shrink-0 cursor-pointer rounded-lg border border-line bg-bg px-2.5 text-xs font-medium text-mute outline-none transition-[border-color,box-shadow] hover:border-line-light focus:border-accent-dim focus:ring-2 focus:ring-accent-ring";

type FormState = { initial: TaskDraft; editingId: string | null; key: number };
type Notice = { message: string; previous: Task; reopened: Task[] };

/** Idle time after the last write before the vault is re-read in the background. */
const REFRESH_IDLE_MS = 10_000;

export function TasksView({ session, trash = NO_TRASH, tasks, taskLists, busy, timezone, onRefresh, onApply, readOnly, sidebar, focusTaskId, onFocusHandled }: Props) {
  const readOnlyMode = readOnly === true;
  const [requestedScope, setScope] = useState<string>("upnext");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
  const [deletingList, setDeletingList] = useState<TaskList | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingTrash, setViewingTrash] = useState(false);
  const trashCount = useMemo(() => trashRootsFor(trash, "tasks").length, [trash]);
  const [saving, setSaving] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const bulkMenu = useContextMenu();
  const folds = useAgendaFolds();
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

  // The smart views leave out an archived list's tasks; the list itself, opened
  // from the archive, still shows them.
  const awayLists = useMemo(() => archivedIds(taskLists), [taskLists]);
  // A hidden list is left out of the smart views too, but a search still
  // reaches it.
  const hiddenLists = useMemo(() => hiddenIds(taskLists), [taskLists]);
  const searchableTasks = useMemo(
    () => tasks.filter((task) => !awayLists.has(resolveTaskListId(task.taskListId))),
    [tasks, awayLists],
  );
  const liveTasks = useMemo(
    () => searchableTasks.filter((task) => !hiddenLists.has(resolveTaskListId(task.taskListId))),
    [searchableTasks, hiddenLists],
  );

  const agenda = useMemo(() => taskAgenda(liveTasks, now, timezone), [liveTasks, now, timezone]);
  const smartCounts = useMemo(() => {
    const open = liveTasks.filter((task) => !task.done).length;
    return {
      upnext: open,
      all: open,
      completed: liveTasks.length - open,
    } satisfies Record<TaskScope, number>;
  }, [liveTasks]);

  const listCounts = useMemo(() => {
    const result = new Map<string, number>();
    for (const task of tasks) {
      if (task.done) continue;
      const id = resolveTaskListId(task.taskListId);
      result.set(id, (result.get(id) ?? 0) + 1);
    }
    return result;
  }, [tasks]);

  // The tasks the view shows before a tag or a search narrows them.
  const scopeTasks = useMemo(
    () =>
      isSmart
        ? liveTasks.filter((task) => inScope(task, scope as TaskScope))
        : tasks.filter((task) => resolveTaskListId(task.taskListId) === scope),
    [tasks, liveTasks, scope, isSmart],
  );
  const tagList = useMemo(() => tagVocabulary(scopeTasks.map((task) => task.tags)), [scopeTasks]);
  const knownTags = useMemo(() => tagVocabulary(searchableTasks.map((task) => task.tags)), [searchableTasks]);

  // A tag no task in this view carries filters nothing out, so it reads as off.
  const activeTag = tagList.some((tag) => tag.key === tagFilter) ? tagFilter : null;
  const filtering = searching || activeTag !== null;

  const showAgenda = scope === "upnext" && !filtering;
  const scopeTree = useMemo(() => {
    if ((!isSmart && !filtering) || showAgenda) return null;
    const scoped = searching
      ? isSmart
        ? searchableTasks.filter((task) => inScope(task, scope as TaskScope))
        : scopeTasks
      : scopeTasks;
    // A search never reaches an archived list, even one opened from the archive.
    const searchable = searching ? scoped.filter((task) => !awayLists.has(resolveTaskListId(task.taskListId))) : scoped;
    const tagged = activeTag ? searchable.filter((task) => hasTag(task.tags, activeTag)) : searchable;
    return buildTaskTreeOf(tagged.filter((task) => taskMatches(task, deferredSearch)));
  }, [scopeTasks, searchableTasks, awayLists, scope, isSmart, searching, filtering, showAgenda, deferredSearch, activeTag]);

  const tree = useMemo(
    () => (isSmart ? [] : buildTaskTree(tasks, scope)),
    [tasks, scope, isSmart],
  );

  const { folded, allUndated } = folds;
  const selectable = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const ids = showAgenda
      ? agendaVisibleIds(agenda, { folded, allUndated })
      : visibleTaskIds(scopeTree ?? tree, expanded);
    return ids.flatMap((id) => {
      const task = byId.get(id);
      return task ? [task] : [];
    });
  }, [tasks, showAgenda, agenda, folded, allUndated, scopeTree, tree, expanded]);
  const selection = useItemSelection(selectable, {
    enabled: !readOnlyMode,
    paused: form !== null || confirmDelete !== null || deletingList !== null || confirmBulkDelete,
  });

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
    selection.clear();
    setScope(next);
    setSelectedId(null);
    setForm(null);
  }

  /** Where the sidebar title leads: Up next, with nothing filtered. */
  function goHome() {
    changeScope("upnext");
    setSearch("");
    setTagFilter(null);
    setViewingTrash(false);
    sidebar.close();
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

  /** Moves a task to the trash; its subtasks go with it. */
  async function removeTask(task: Task) {
    const ok = await run(() => trashItems(session, [{ kind: "task", item: task }]));
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

  /** Moves the picked tasks to the trash, writing only the outermost: each takes its subtasks along. */
  async function trashPicked(picked: Task[]) {
    const ids = new Set(picked.map((task) => task.id));
    const outermost = picked.filter(
      (task) => !picked.some((other) => other.id !== task.id && taskSubtree(tasks, other.id).includes(task.id)),
    );
    selection.clear();
    setNotice(null);
    const ok = await run(() => trashItems(session, outermost.map((item) => ({ kind: "task" as const, item }))));
    if (ok && selectedId && ids.has(selectedId)) setSelectedId(null);
  }

  async function applyBulk(change: TaskBulkChange) {
    if (change.kind === "delete") {
      await trashPicked(selection.selectedItems);
      return;
    }
    const plan = planTaskBulk(change, selection.selectedItems, tasks, new Date(), timezone);
    selection.clear();
    setNotice(null);
    if (plan.writes.length > 0 || plan.removed.length > 0) {
      const ok = await run(async () => {
        const saved: Task[] = [];
        const removed: string[] = [];
        try {
          for (const { id, draft } of plan.writes) saved.push(await putTask(session, draft, id));
          for (const id of plan.removed) {
            await deleteTask(session, id);
            removed.push(id);
          }
        } catch (err) {
          // What did land stays on screen, so the failure leaves nothing half shown.
          onApply?.({ tasks: saved, removedTaskIds: removed });
          throw err;
        }
        return { tasks: saved, removedTaskIds: removed };
      });
      if (!ok) return;
      if (selectedId && plan.removed.includes(selectedId)) setSelectedId(null);
    }
    if (plan.skipped > 0) {
      setError(
        `${plural(plan.skipped, "task")} left alone: written by a newer version of Sealbook. Update this client to change ${plan.skipped === 1 ? "it" : "them"}.`,
      );
    }
  }

  function bulkItems(): MenuItem[] {
    const picked = selection.selectedItems;
    const open = picked.filter((task) => !task.done).length;
    const done = picked.length - open;
    return [
      ...(open > 0
        ? [{ label: `Complete ${plural(open, "task")}`, onSelect: () => void applyBulk({ kind: "complete" }) }]
        : []),
      ...(done > 0
        ? [{ label: `Reopen ${plural(done, "task")}`, onSelect: () => void applyBulk({ kind: "reopen" }) }]
        : []),
      { label: "Clear due date", onSelect: () => void applyBulk({ kind: "due" }) },
      {
        label: `Delete ${plural(picked.length, "task")}`,
        danger: true,
        onSelect: () => setConfirmBulkDelete(true),
      },
    ];
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

  async function setListArchived(list: TaskList, archived: boolean) {
    await run(async () => ({
      taskLists: [
        await putTaskList(session, list.name, list.parentId, list.id, list.raw, list.color, archived),
      ],
    }));
    if (archived && (list.id === scope || awayLists.has(scope))) changeScope("all");
  }

  async function toggleListHidden(list: TaskList) {
    await run(async () => ({
      taskLists: [
        await putTaskList(
          session,
          list.name,
          list.parentId,
          list.id,
          list.raw,
          list.color,
          undefined,
          list.hideFromAll !== true,
        ),
      ],
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

  /** Moves a list to the trash, with the tasks and lists inside it. */
  async function removeList(list: TaskList) {
    if (list.id === DEFAULT_TASK_LIST_ID) {
      setError("The default list cannot be deleted.");
      return;
    }
    const ok = await run(() => trashItems(session, [{ kind: "task_list", item: list }]));
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
    selection: readOnlyMode
      ? undefined
      : ({
          selecting: selection.selecting,
          count: selection.selected.size,
          isSelected: selection.isSelected,
          onBegin: selection.begin,
          onToggle: selection.toggle,
          bulkItems,
        } satisfies TaskSelection),
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
    <main className={viewMain}>
      {error ? (
        <Banner tone="danger" role="alert">{error}</Banner>
      ) : null}
      <ContextMenu state={bulkMenu.menu} onClose={bulkMenu.close} />
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

      <div className={viewGrid} style={sidebar.cols}>
        <SidebarDrawer title="Tasks" sidebar={sidebar}>
          <SidebarHeader
            title="Tasks"
            onTitleClick={goHome}
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
            onArchive={(list) => void setListArchived(list, true)}
            onRestore={(list) => void setListArchived(list, false)}
            onToggleHidden={(list) => void toggleListHidden(list)}
          />
          {readOnlyMode ? null : (
            <TrashRow
              count={trashCount}
              active={viewingTrash}
              onToggle={() => {
                setForm(null);
                setViewingTrash(!viewingTrash);
              }}
            />
          )}
        </SidebarDrawer>

        {viewingTrash ? (
          <TrashPanel session={session} trash={trash} tab="tasks" sidebar={sidebar} onChanged={async () => { await onRefresh(); }} />
        ) : (
        <section className="order-1 flex min-w-0 flex-col overflow-hidden lg:order-none lg:min-h-0">
          <PaneHeader title={title} count={shown} sidebar={sidebar}>
              {!readOnlyMode ? (
                <button
                  type="button"
                  onClick={() => startAdd()}
                  disabled={disabled}
                  className={btnPrimarySm}
                >
                  <Icon name="plus" />
                  <span className="hidden sm:inline">New task</span>
                  <span className="sm:hidden">New</span>
                </button>
              ) : null}
              {tagList.length > 0 ? <TagFilterMenu tags={tagList} active={activeTag} onChange={setTagFilter} /> : null}
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
</PaneHeader>

          {selection.selecting ? (
            <BulkBar
              label="Bulk edit tasks"
              noun="tasks"
              selected={selection.selected.size}
              total={selectable.length}
              onToggleAll={selection.toggleAll}
              onClear={selection.clear}
            >
              <BulkMove
                label="Move selected tasks to"
                options={listRows.map(({ item, depth }) => ({
                  id: item.id,
                  name: `${"\u00a0\u00a0".repeat(depth)}${item.name}`,
                }))}
                disabled={disabled}
                onMove={(taskListId) => void applyBulk({ kind: "move", taskListId })}
              />
              <input
                type="date"
                aria-label="Set due date for selected tasks"
                value=""
                disabled={disabled}
                onChange={(event) => {
                  if (event.target.value) void applyBulk({ kind: "due", dueDate: event.target.value });
                }}
                className={bulkControl}
              />
              <button
                type="button"
                onClick={(event) => bulkMenu.open(event, bulkItems())}
                disabled={disabled}
                aria-haspopup="menu"
                className={btnPrimarySm}
              >
                <span>Actions</span>
                <Icon name="chevron" className="h-3 w-3 rotate-90" />
              </button>
            </BulkBar>
          ) : null}

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
                  folds={folds}
                  tasks={tasks}
                  onAddDue={readOnlyMode ? undefined : startAddDue}
                />
              ) : scopeTree ? (
                scopeTree.length === 0 ? (
                  filtering ? (
                    <EmptyState title={searching ? "No tasks match that search." : "No tasks have that tag."} />
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
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg max-lg:fixed max-lg:inset-0 max-lg:z-(--z-overlay) max-lg:h-dvh max-lg:w-screen">
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-5">
                    <TaskForm
                      key={form.key}
                      initial={form.initial}
                      editing={form.editingId !== null}
                      listOptions={listRows.map(({ item, depth }) => ({ id: item.id, name: item.name, depth }))}
                      timezone={timezone}
                      knownTags={knownTags}
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
        )}
      </div>

      {confirmDelete ? (
        <ConfirmDialog
          title="Move to trash"
          heading={`Move “${confirmDelete.title}” to the trash?`}
          body="It and its subtasks can be restored from the trash for 30 days."
          confirmLabel="Move to trash"
          tone="danger"
          busy={saving}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => void removeTask(confirmDelete)}
        />
      ) : null}

      {confirmBulkDelete ? (
        <ConfirmDialog
          title="Move to trash"
          heading={`Move ${plural(selection.selected.size, "task")} to the trash?`}
          body="They and their subtasks can be restored from the trash for 30 days."
          confirmLabel="Move to trash"
          tone="danger"
          busy={saving}
          onClose={() => setConfirmBulkDelete(false)}
          onConfirm={() => {
            setConfirmBulkDelete(false);
            void applyBulk({ kind: "delete" });
          }}
        />
      ) : null}

      {deletingList ? (
        <ConfirmDialog
          title="Move to trash"
          heading={`Move “${deletingList.name}” to the trash?`}
          body="The list and the tasks and lists inside it can be restored from the trash for 30 days."
          confirmLabel="Move to trash"
          tone="danger"
          busy={saving}
          onClose={() => setDeletingList(null)}
          onConfirm={() => void removeList(deletingList)}
        />
      ) : null}
    </main>
  );
}
