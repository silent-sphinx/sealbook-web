import {
  coreOrderByName,
  coreOrderByRecency,
  coreOrderContainers,
} from "./wasm";

/** Core orders by position, so two entries sharing an id both survive. */
function inOrder<T>(items: T[], positions: string[]): T[] {
  return positions.map((position) => items[Number(position)]);
}

export function sortByName<T>(items: T[], name: (item: T) => string): T[] {
  const ids = coreOrderByName(
    items.map((item, index) => ({ id: String(index), name: name(item) })),
  );
  return inOrder(items, ids);
}

export function sortContainers<T extends { id: string; name: string }>(
  defaultId: string,
  items: T[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ids = coreOrderContainers(
    defaultId,
    items.map((item) => ({ id: item.id, name: item.name })),
  );
  return ids.map((id) => byId.get(id) as T);
}

export function sortByRecency<T>(
  items: T[],
  fields: {
    name: (item: T) => string;
    stamp: (item: T) => string | undefined;
    pinned?: (item: T) => boolean;
  },
): T[] {
  const ids = coreOrderByRecency(
    items.map((item, index) => ({
      id: String(index),
      name: fields.name(item),
      stamp: fields.stamp(item) ?? "",
      pinned: fields.pinned?.(item) ?? false,
    })),
    fields.pinned !== undefined,
  );
  return inOrder(items, ids);
}
