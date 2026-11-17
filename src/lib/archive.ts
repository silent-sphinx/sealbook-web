type Archivable = { id: string; parentId?: string; archived?: boolean };

/**
 * Collections that are archived or sit under one that is: archiving a
 * collection puts away everything nested in it, so a view that leaves the
 * archive out leaves out all of these.
 */
export function archivedIds(collections: Archivable[]): Set<string> {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const out = new Set<string>();
  for (const collection of collections) {
    let current: Archivable | undefined = collection;
    // The hop cap stops a parent cycle from looping.
    for (let hops = 0; current && hops <= collections.length; hops += 1) {
      if (current.archived) {
        out.add(collection.id);
        break;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return out;
}
