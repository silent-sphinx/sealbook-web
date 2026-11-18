type Container = { id: string; archived?: boolean; hideFromAll?: boolean };

/**
 * The containers to mark hidden from a set this device held in local storage
 * before hiding was stored on the container: those the set names that still
 * exist, are in play and are not already marked. Only ever adds, so a
 * container another device has hidden is never shown by this one.
 */
export function idsToHide(containers: Container[], local: ReadonlySet<string>): string[] {
  return containers
    .filter((container) => local.has(container.id) && container.archived !== true && container.hideFromAll !== true)
    .map((container) => container.id);
}
