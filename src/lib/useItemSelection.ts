import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Options = {
  /** Switches off Ctrl/Cmd+A, such as for a read-only view. */
  enabled?: boolean;
  /** Suspends Escape and Ctrl/Cmd+A while a dialog or form of the view's own is open. */
  paused?: boolean;
};

export type ItemSelection<T extends { id: string }> = {
  selected: ReadonlySet<string>;
  /** The selected items, in list order. */
  selectedItems: T[];
  selecting: boolean;
  isSelected: (id: string) => boolean;
  /** Starts a selection on one item. */
  begin: (item: T) => void;
  /**
   * Starts a selection that takes in another item, such as the one open beside
   * the list: the run between them when `run` is set, or just the two. Falls back
   * to `item` alone when the other is not listed.
   */
  beginFrom: (fromId: string, item: T, run: boolean) => void;
  /** Plain toggles; `extend` adds the run between this item and the last one toggled. */
  toggle: (item: T, extend?: boolean) => void;
  /** Replaces the selection with these ids. */
  select: (ids: Iterable<string>) => void;
  /** Selects every item, or clears when they are all selected already. */
  toggleAll: () => void;
  clear: () => void;
};

/**
 * Multi-select over a list the view already filters and orders. The selection
 * never outlives what is on screen: an id that leaves `items` is dropped, so a
 * bulk action is never aimed at a row the user cannot see.
 */
export function useItemSelection<T extends { id: string }>(
  items: readonly T[],
  { enabled = true, paused = false }: Options = {},
): ItemSelection<T> {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const anchorId = useRef<string | null>(null);

  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const shown = new Set(items.map((item) => item.id));
      const kept = [...current].filter((id) => shown.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [items]);

  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.id)),
    [items, selected],
  );
  const selecting = selected.size > 0;

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorId.current = null;
  }, []);

  const begin = useCallback((item: T) => {
    setSelected(new Set([item.id]));
    anchorId.current = item.id;
  }, []);

  const beginFrom = useCallback(
    (fromId: string, item: T, run: boolean) => {
      const from = items.findIndex((entry) => entry.id === fromId);
      const to = items.findIndex((entry) => entry.id === item.id);
      if (from < 0 || to < 0) {
        begin(item);
        return;
      }
      const ids = run
        ? items.slice(Math.min(from, to), Math.max(from, to) + 1).map((entry) => entry.id)
        : [fromId, item.id];
      setSelected(new Set(ids));
      anchorId.current = item.id;
    },
    [items, begin],
  );

  const toggle = useCallback(
    (item: T, extend = false) => {
      const next = new Set(selected);
      const from = extend && anchorId.current ? items.findIndex((entry) => entry.id === anchorId.current) : -1;
      if (from >= 0) {
        const to = items.findIndex((entry) => entry.id === item.id);
        const [low, high] = from < to ? [from, to] : [to, from];
        for (const entry of items.slice(low, high + 1)) next.add(entry.id);
      } else if (!next.delete(item.id)) {
        next.add(item.id);
      }
      setSelected(next);
      anchorId.current = next.size === 0 ? null : item.id;
    },
    [items, selected],
  );

  const select = useCallback((ids: Iterable<string>) => {
    setSelected(new Set(ids));
    anchorId.current = null;
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === items.length) clear();
    else setSelected(new Set(items.map((item) => item.id)));
  }, [items, selected, clear]);

  useEffect(() => {
    if (!selecting || paused) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") clear();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, paused, clear]);

  useEffect(() => {
    if (!enabled || paused) return;
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "a") return;
      const target = event.target as HTMLElement | null;
      // Leave text editing and open dialogs to the browser's own select-all.
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      if (document.querySelector("[role='dialog']") || items.length === 0) return;
      event.preventDefault();
      toggleAll();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, paused, items, toggleAll]);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return { selected, selectedItems, selecting, isSelected, begin, beginFrom, toggle, select, toggleAll, clear };
}
