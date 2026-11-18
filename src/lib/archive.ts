type Nested = { id: string; parentId?: string };

/**
 * Items that carry a flag or sit under one that does: flagging a collection
 * flags everything nested in it.
 */
function flaggedIds<T extends Nested>(items: T[], flagged: (item: T) => boolean | undefined): Set<string> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const out = new Set<string>();
  for (const item of items) {
    let current: T | undefined = item;
    // The hop cap stops a parent cycle from looping.
    for (let hops = 0; current && hops <= items.length; hops += 1) {
      if (flagged(current)) {
        out.add(item.id);
        break;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return out;
}

/**
 * Collections that are archived or sit under one that is: archiving a
 * collection puts away everything nested in it, so a view that leaves the
 * archive out leaves out all of these.
 */
export function archivedIds(collections: (Nested & { archived?: boolean })[]): Set<string> {
  return flaggedIds(collections, (collection) => collection.archived);
}

/**
 * Collections hidden from the overviews or nested under one that is. Unlike an
 * archived collection, a hidden one stays listed, openable and searchable.
 */
export function hiddenIds(collections: (Nested & { hideFromAll?: boolean })[]): Set<string> {
  return flaggedIds(collections, (collection) => collection.hideFromAll);
}
