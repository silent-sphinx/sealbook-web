import { useState } from "react";
import { CollectionSidebar } from "./CollectionSidebar";
import { SidebarSection } from "./SidebarDrawer";
import { TaskIcon } from "./TaskIcon";
import {
  canMoveTaskList,
  DEFAULT_TASK_LIST_ID,
  sortTaskLists,
  taskListTone,
} from "../lib/task";
import type { TaskScope } from "../lib/task";
import { focusRing, sidebarCount, sidebarRowState, sidebarSectionAction } from "../lib/styles";
import type { TaskList } from "../lib/types";

export const SMART_VIEWS: { id: TaskScope; label: string }[] = [
  { id: "upnext", label: "Up next" },
  { id: "all", label: "All tasks" },
  { id: "completed", label: "Completed" },
];

type Props = {
  lists: TaskList[];
  scope: string;
  onScope: (scope: string) => void;
  smartCounts: Record<TaskScope, number>;
  overdueCount: number;
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
  overdueCount,
  listCounts,
  readOnly,
  onCreate,
  onRename,
  onRecolor,
  onMove,
  onDelete,
}: Props) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <SidebarSection label="Views">
        <ul className="mt-2.5 space-y-0.5">
          {SMART_VIEWS.map((view) => (
            <li key={view.id}>
              <button
                type="button"
                onClick={() => onScope(view.id)}
                aria-current={scope === view.id ? "true" : undefined}
                className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${sidebarRowState(
                  scope === view.id,
                )} ${focusRing}`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{view.label}</span>
                {view.id === "upnext" && overdueCount > 0 ? (
                  <span
                    title={`${overdueCount} overdue`}
                    className="rounded-full bg-danger/15 px-1.5 text-[10px] font-semibold tabular-nums text-danger"
                  >
                    {overdueCount}
                  </span>
                ) : null}
                <span className={sidebarCount}>{smartCounts[view.id] || ""}</span>
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
              onClick={() => setCreating(true)}
              title="Add a top-level list"
              aria-label="Add list"
              className={sidebarSectionAction}
            >
              <TaskIcon name="plus" />
            </button>
          ) : null
        }
      >
        <CollectionSidebar
          collections={lists}
          sort={sortTaskLists}
          selectedId={scope}
          onSelect={onScope}
          icon="tasks"
          kindLabel="list"
          subLabel="sublist"
          tone={(list) => taskListTone(lists, list.id)}
          protectedId={DEFAULT_TASK_LIST_ID}
          counts={listCounts}
          creating={creating}
          onCreateHandled={() => setCreating(false)}
          onCreate={async (name, parentId) => {
            const id = await onCreate(name, parentId);
            if (id) onScope(id);
          }}
          onRename={onRename}
          onRecolor={onRecolor}
          onDelete={onDelete}
          canMove={(id, parentId) => canMoveTaskList(lists, id, parentId)}
          onMove={onMove}
          readOnly={readOnly}
        />
      </SidebarSection>
    </>
  );
}
