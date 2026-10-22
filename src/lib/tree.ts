/**
 * The parent-pointer tree, shared by the note tree and the bookmark collection
 * tree.
 *
 * Both shapes live in their items rather than in a stored tree: an item points
 * at its parent and the shape falls out of the pointers. Nothing validates
 * those pointers, and nothing can — two devices editing offline can each make
 * the other's item the parent, and an item whose parent was deleted keeps
 * pointing at an id that is gone. Every pointer is therefore resolved through
 * `resolveParent`, which reads both cases as "no parent" rather than letting
 * either hide an item or spin a walk forever.
 *
 * Generic over `{ id, parentId }` because there is no second copy of cycle
 * detection worth maintaining: a bug fixed in one would otherwise have to be
 * found again in the other.
 */

export type TreeItem = { id: string; parentId?: string };

export type TreeNode<T extends TreeItem> = {
  item: T;
  depth: number;
  children: TreeNode<T>[];
};

/**
 * The parent to actually use for an item: its own, unless that is missing, is
 * itself, or sits on a chain that leads back to it.
 */
export function resolveParent<T extends TreeItem>(
  id: string,
  byId: Map<string, T>,
): string | null {
  const parentId = byId.get(id)?.parentId;
  if (!parentId || parentId === id || !byId.has(parentId)) return null;
  const seen = new Set<string>([id]);
  let cursor: string | undefined = parentId;
  while (cursor !== undefined) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const next: string | undefined = byId.get(cursor)?.parentId;
    cursor = next !== undefined && byId.has(next) ? next : undefined;
  }
  return parentId;
}

/**
 * The tree over `items`, with siblings ordered by `sort`.
 *
 * `items` is the scope: an item whose parent is outside it sits at the top
 * level, so narrowing the scope never hides one.
 */
export function buildTree<T extends TreeItem>(
  items: T[],
  sort: (siblings: T[]) => T[],
): TreeNode<T>[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    const parent = resolveParent(item.id, byId);
    const siblings = children.get(parent);
    if (siblings) siblings.push(item);
    else children.set(parent, [item]);
  }
  const build = (parent: string | null, depth: number): TreeNode<T>[] =>
    sort(children.get(parent) ?? []).map((item) => ({
      item,
      depth,
      children: build(item.id, depth + 1),
    }));
  return build(null, 0);
}

/** The item and everything under it, the item itself first. */
export function subtree<T extends TreeItem>(items: T[], id: string): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const childrenOf = new Map<string, string[]>();
  for (const item of items) {
    const parent = resolveParent(item.id, byId);
    if (parent === null) continue;
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.push(item.id);
    else childrenOf.set(parent, [item.id]);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    out.push(current);
    stack.push(...(childrenOf.get(current) ?? []));
  }
  return out;
}

/** Whether `id` may be dropped under `parentId` without the tree eating itself. */
export function canReparent<T extends TreeItem>(
  items: T[],
  id: string,
  parentId: string | null,
): boolean {
  if (parentId === null) return true;
  if (parentId === id) return false;
  if (!items.some((item) => item.id === parentId)) return false;
  return !subtree(items, id).includes(parentId);
}

/** Depth-first order, which is the order a sidebar draws rows in. */
export function flattenTree<T extends TreeItem>(nodes: TreeNode<T>[]): TreeNode<T>[] {
  const out: TreeNode<T>[] = [];
  const walk = (list: TreeNode<T>[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** The ancestors of an item, nearest first, so a sidebar can reveal it. */
export function ancestorsOf<T extends TreeItem>(items: T[], id: string): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cursor = resolveParent(id, byId);
  while (cursor !== null && !seen.has(cursor)) {
    out.push(cursor);
    seen.add(cursor);
    cursor = resolveParent(cursor, byId);
  }
  return out;
}
