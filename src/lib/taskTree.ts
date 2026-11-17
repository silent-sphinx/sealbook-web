import { resolveTaskListId, sortTasks, taskTo } from "./task";
import { ancestorsOf as treeAncestors, buildTree, subtree } from "./tree";
import type { TreeNode } from "./tree";
import type { Task } from "./types";
import { coreTaskCanMove } from "./wasm";

export type TaskTreeNode = {
  task: Task;
  depth: number;
  children: TaskTreeNode[];
};

function asTaskNode(node: TreeNode<Task>): TaskTreeNode {
  return { task: node.item, depth: node.depth, children: node.children.map(asTaskNode) };
}

/** The tree over whatever set is on screen; a task whose parent is outside it
 * sits at the top level. */
export function buildTaskTreeOf(scoped: Task[]): TaskTreeNode[] {
  return buildTree(scoped, sortTasks).map(asTaskNode);
}

/** A task whose parent is in another list sits at this list's top level. */
export function buildTaskTree(tasks: Task[], taskListId: string): TaskTreeNode[] {
  return buildTaskTreeOf(tasks.filter((task) => resolveTaskListId(task.taskListId) === taskListId));
}

export function taskSubtree(tasks: Task[], id: string): string[] {
  return subtree(tasks, id);
}

export function canReparentTask(tasks: Task[], id: string, parentId: string | null): boolean {
  return coreTaskCanMove(tasks.map(taskTo), id, parentId ?? undefined);
}

export function flattenTaskTree(nodes: TaskTreeNode[]): TaskTreeNode[] {
  const out: TaskTreeNode[] = [];
  const walk = (list: TaskTreeNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** The ids a tree lists top to bottom when only the `expanded` parents show their subtasks. */
export function visibleTaskIds(nodes: TaskTreeNode[], expanded: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const walk = (list: TaskTreeNode[]) => {
    for (const node of list) {
      out.push(node.task.id);
      if (expanded.has(node.task.id)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function taskAncestors(tasks: Task[], id: string): string[] {
  return treeAncestors(tasks, id);
}

export type ChildCount = { done: number; total: number };

/** Direct subtasks per parent, for the "2/5" badge. */
export function childCounts(tasks: Task[]): Map<string, ChildCount> {
  const ids = new Set(tasks.map((task) => task.id));
  const counts = new Map<string, ChildCount>();
  for (const task of tasks) {
    if (!task.parentId || task.parentId === task.id || !ids.has(task.parentId)) continue;
    const entry = counts.get(task.parentId) ?? { done: 0, total: 0 };
    entry.total += 1;
    if (task.done) entry.done += 1;
    counts.set(task.parentId, entry);
  }
  return counts;
}
