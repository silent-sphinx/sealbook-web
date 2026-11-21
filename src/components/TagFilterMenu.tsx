import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeAt } from "../lib/placement";
import { btnSecondarySm, eyebrow, focusRing, popoverSurface, searchField, searchIcon } from "../lib/styles";
import type { TagEntry } from "../lib/tags";
import { Icon } from "./Icon";

/** Past this many tags the list gets a filter box, so a long vocabulary stays reachable. */
const FILTER_FROM = 8;

/**
 * A header button that opens a scrollable, searchable list of the tags in view.
 * `active` is the filtered tag's lowercase key. It is not a `ContextMenu`
 * because that menu closes on any scroll and cannot scroll itself.
 */
export function TagFilterMenu({
  tags,
  active,
  onChange,
}: {
  tags: TagEntry[];
  active: string | null;
  onChange: (key: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const close = () => {
    setOpen(false);
    setQuery("");
    setPlaced(null);
  };

  useLayoutEffect(() => {
    if (!open || !button.current || !panel.current) return;
    const anchor = button.current.getBoundingClientRect();
    const size = { width: panel.current.offsetWidth, height: panel.current.offsetHeight };
    // Opened from the button's left edge, flipped by `placeAt` when it would overrun.
    setPlaced(placeAt({ x: anchor.left, y: anchor.bottom + 4 }, size, { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || button.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
      button.current?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const activeName = tags.find((tag) => tag.key === active)?.name;
  const needle = query.trim().toLowerCase();
  const shown = needle ? tags.filter((tag) => tag.key.includes(needle)) : tags;

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${btnSecondarySm} ${active ? "border-accent-dim bg-accent-soft text-text" : ""}`}
      >
        <span className="max-w-32 truncate">{activeName ? `Tag: ${activeName}` : "Tags"}</span>
        {activeName ? null : <span className="text-2xs tabular-nums text-faint">{tags.length}</span>}
        <Icon name="chevron" className="h-3 w-3 rotate-90" />
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              role="dialog"
              aria-label="Filter by tag"
              style={{ left: placed?.left ?? 0, top: placed?.top ?? 0, visibility: placed ? "visible" : "hidden" }}
              className={`fixed z-(--z-popover) flex w-72 origin-top-left animate-pop flex-col overflow-hidden ${popoverSurface}`}
            >
              <div className="flex h-9 items-center justify-between px-3.5 pt-1">
                <p className={eyebrow}>Filter by tag</p>
                {active ? (
                  <button
                    type="button"
                    onClick={() => {
                      onChange(null);
                      close();
                    }}
                    className={`-mr-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-accent hover:underline ${focusRing}`}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              {tags.length > FILTER_FROM ? (
                <div className="relative px-2.5 pb-2 pt-1">
                  <Icon name="search" className={`${searchIcon} left-5`} />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Find a tag"
                    aria-label="Find a tag"
                    className={`${searchField} h-8`}
                  />
                </div>
              ) : null}
              <ul className="max-h-[min(20rem,60vh)] space-y-0.5 overflow-y-auto overscroll-contain border-t border-line p-1.5">
                {shown.map((tag) => {
                  const on = tag.key === active;
                  return (
                    <li key={tag.key}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          onChange(on ? null : tag.key);
                          close();
                        }}
                        className={`flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm outline-none transition-colors focus-visible:bg-hover ${focusRing} ${
                          on ? "bg-accent-soft font-medium text-text" : "text-text hover:bg-hover"
                        }`}
                      >
                        <span className="flex size-4 shrink-0 items-center justify-center text-accent">
                          {on ? <Icon name="check" className="size-3.5" /> : <span className="text-mute">#</span>}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                        <span className="rounded-full bg-surface px-1.5 text-2xs tabular-nums text-mute">{tag.count}</span>
                      </button>
                    </li>
                  );
                })}
                {shown.length === 0 ? <li className="px-2 py-3 text-center text-xs text-mute">No tags match "{query.trim()}"</li> : null}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
