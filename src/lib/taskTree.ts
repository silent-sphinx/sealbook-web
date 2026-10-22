import { resolveTaskListId, sortTasks } from "./task";
import { ancestorsOf as treeAncestors, buildTree, canReparent as treeCanReparent, subtree } from "./tree";
import type { TreeNode } from "./tree";
import type { Task } from "./types";

export type TaskTreeNode = {
  task: Task;
  depth: number;
  children: TaskTreeNode[];
};

function asTaskNode(node: TreeNode<Task>): TaskTreeNode {
  return { task: node.item, depth: node.depth, children: node.children.map(asTaskNode) };
}

/** A task whose parent is in another list sits at this list's top level. */
export function buildTaskTree(tasks: Task[], taskListId: string): TaskTreeNode[] {
  const scoped = tasks.filter((task) => resolveTaskListId(task.taskListId) === taskListId);
  return buildTree(scoped, sortTasks).map(asTaskNode);
}

export function taskSubtree(tasks: Task[], id: string): string[] {
  return subtree(tasks, id);
}

export function canReparentTask(tasks: Task[], id: string, parentId: string | null): boolean {
  return treeCanReparent(tasks, id, parentId);
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

export function taskAncestors(tasks: Task[], id: string): string[] {
  return treeAncestors(tasks, id);
}
