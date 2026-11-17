import { useMemo, useState } from "react";
import { ContextMenu, useContextMenu } from "./ContextMenu";
import { TaskRow, type TaskActions } from "./TaskTreeList";
import { focusRing } from "../lib/styles";
import type { TaskAgenda } from "../lib/task";
import type { Task } from "../lib/types";
import { Icon } from "./Icon";
import { EmptyState } from "./EmptyState";

export const UNDATED_SHOWN = 10;

type SectionKey = keyof TaskAgenda;

const SECTIONS: { key: SectionKey; label: string; folded?: boolean; addOffset?: number }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today", addOffset: 0 },
  { key: "tomorrow", label: "Tomorrow", addOffset: 1 },
  { key: "week", label: "This week" },
  { key: "later", label: "Later", folded: true },
  { key: "undated", label: "No date" },
  { key: "done_today", label: "Done today", folded: true },
];

export type AgendaFolds = {
  folded: ReadonlySet<SectionKey>;
  allUndated: boolean;
  toggle: (key: SectionKey) => void;
  showAllUndated: () => void;
};

/** Kept by the view, so it can tell which rows are on screen. */
export function useAgendaFolds(): AgendaFolds {
  const [folded, setFolded] = useState<ReadonlySet<SectionKey>>(
    () => new Set(SECTIONS.filter((section) => section.folded).map((section) => section.key)),
  );
  const [allUndated, setAllUndated] = useState(false);
  return {
    folded,
    allUndated,
    toggle: (key) =>
      setFolded((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    showAllUndated: () => setAllUndated(true),
  };
}

/** The ids the agenda lists right now, top to bottom, leaving out folded and capped rows. */
export function agendaVisibleIds(agenda: TaskAgenda, { folded, allUndated }: Pick<AgendaFolds, "folded" | "allUndated">): string[] {
  return SECTIONS.flatMap(({ key }) => {
    if (folded.has(key)) return [];
    return key === "undated" && !allUndated ? agenda[key].slice(0, UNDATED_SHOWN) : agenda[key];
  });
}

type Props = TaskActions & {
  agenda: TaskAgenda;
  folds: AgendaFolds;
  tasks: Task[];
  /** Starts a task due `offset` days from today. Absent when read only. */
  onAddDue?: (offset: number) => void;
};

export function TaskAgendaList({ agenda, folds, tasks, onAddDue, ...actions }: Props) {
  const { folded, allUndated } = folds;
  const menu = useContextMenu();
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const open = SECTIONS.filter((section) => section.key !== "done_today").reduce(
    (sum, section) => sum + agenda[section.key].length,
    0,
  );
  const doneToday = agenda.done_today.length;

  if (open === 0) {
    return (
      <EmptyState
        title="All clear"
        body={
          doneToday > 0
            ? `${doneToday} ${doneToday === 1 ? "task" : "tasks"} done today. Nothing else is open.`
            : "No open tasks. Tasks are encrypted on this device before they leave it."
        }
      />
    );
  }

  return (
    <div>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      {SECTIONS.map(({ key, label, addOffset }) => {
        const ids = agenda[key];
        if (ids.length === 0 && key !== "today") return null;
        const closed = folded.has(key);
        const capped = key === "undated" && !allUndated ? ids.slice(0, UNDATED_SHOWN) : ids;
        const rows = capped.map((id) => byId.get(id)).filter((task): task is Task => task !== undefined);
        return (
          <section key={key} aria-label={label} className="border-b border-line/60">
            <div className="flex items-center gap-2 bg-panel/40 px-3 py-1.5">
              <button
                type="button"
                onClick={() => folds.toggle(key)}
                aria-expanded={!closed}
                className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left text-[11px] font-semibold uppercase tracking-[0.14em] ${
                  key === "overdue" ? "text-danger" : "text-mute"
                } ${focusRing}`}
              >
                <Icon name="chevron" className={`h-3 w-3 transition-transform ${closed ? "" : "rotate-90"}`} />
                <span>{label}</span>
                {ids.length > 0 ? <span className="tabular-nums font-medium">{ids.length}</span> : null}
              </button>
              {onAddDue && addOffset !== undefined ? (
                <button
                  type="button"
                  onClick={() => onAddDue(addOffset)}
                  aria-label={`Add a task due ${label.toLowerCase()}`}
                  title={`Add a task due ${label.toLowerCase()}`}
                  className={`hit-area relative flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
                >
                  <Icon name="plus" className="h-3 w-3" />
                </button>
              ) : null}
            </div>
            {closed ? null : ids.length === 0 ? (
              <p className="px-9 py-2 text-xs text-mute">Nothing due today.</p>
            ) : (
              <ul className="min-w-0">
                {rows.map((task) => (
                  <li key={task.id}>
                    <TaskRow
                      {...actions}
                      task={task}
                      parentTitle={task.parentId ? byId.get(task.parentId)?.title : undefined}
                      menu={menu}
                    />
                  </li>
                ))}
                {capped.length < ids.length ? (
                  <li>
                    <button
                      type="button"
                      onClick={folds.showAllUndated}
                      className={`w-full px-9 py-2 text-left text-xs font-medium text-accent hover:underline ${focusRing}`}
                    >
                      {`Show all ${ids.length}`}
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
