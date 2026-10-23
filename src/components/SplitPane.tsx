import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import {
  DEFAULT_LEADING,
  HANDLE_WIDTH,
  KEY_STEP,
  MIN_LEADING,
  clampLeading,
  loadSplit,
  maxLeading,
  saveSplit,
} from "../lib/splitPane";
import { useMediaQuery } from "../lib/useMediaQuery";
import { focusRing } from "../lib/styles";

/** Matches the `lg:` breakpoint the contacts grid switches on. */
const DESKTOP = "(min-width: 1024px)";

export type SplitPane = {
  /** A drag is in progress, so the container suppresses text selection. */
  dragging: boolean;
  /** Goes on the grid container, whose class is `sb-split`. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** `--sb-split-cols` for that container. */
  cols: CSSProperties;
  /** Everything `SplitHandle` needs; not called directly. */
  handle: {
    width: number;
    max: number;
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
    onDoubleClick: () => void;
  };
};

/**
 * A draggable split between two columns, remembered for the session.
 *
 * The stored width is what the user dragged to; the width actually used is that
 * clamped against the container, so shrinking the window or reopening the
 * sidebar cannot squeeze the detail pane out of existence. The container is
 * measured with a `ResizeObserver` rather than a window `resize` listener
 * because collapsing the sidebar changes its width without resizing the window.
 */
export function useSplitPane(storageKey: string, defaultLeading: number = DEFAULT_LEADING): SplitPane {
  const isDesktop = useMediaQuery(DESKTOP);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stored, setStored] = useState<number>(() => loadSplit(storageKey, defaultLeading));
  const [available, setAvailable] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isDesktop) return;

    const observer = new ResizeObserver((entries) => {
      setAvailable(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [isDesktop]);

  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("sb-dragging");
    return () => document.body.classList.remove("sb-dragging");
  }, [dragging]);

  // Before the first measurement the stored width is used as it is, which is
  // what the column would have been anyway.
  const max = maxLeading(available);
  const width = clampLeading(stored, available);

  const commit = useCallback(
    (next: number) => {
      setStored(next);
      saveSplit(storageKey, next);
    },
    [storageKey],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || event.button !== 0) return;
      event.preventDefault();

      const bounds = container.getBoundingClientRect();
      const limit = maxLeading(bounds.width);
      const handle = event.currentTarget;
      // Pointer capture rather than window listeners: the move keeps arriving
      // once the pointer leaves the 7px track, which it does immediately.
      handle.setPointerCapture(event.pointerId);
      // The preventDefault above is what stops a drag selecting text, and it
      // also suppresses the focus a click would have given the handle, so the
      // arrow keys would not work on the divider just dragged.
      handle.focus();
      setDragging(true);

      // Dragged live rather than on release, and written to storage once at the
      // end, so a drag is not a few hundred storage writes.
      let latest = width;

      function onMove(moveEvent: PointerEvent) {
        latest = Math.min(Math.max(moveEvent.clientX - bounds.left, MIN_LEADING), limit);
        setStored(latest);
      }

      function stop() {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        setDragging(false);
        saveSplit(storageKey, latest);
      }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    },
    [storageKey, width],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step =
        event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0;
      if (step !== 0) {
        event.preventDefault();
        commit(Math.min(Math.max(width + step, MIN_LEADING), max));
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        commit(MIN_LEADING);
      } else if (event.key === "End") {
        event.preventDefault();
        commit(max === Infinity ? width : max);
      }
    },
    [commit, max, width],
  );

  const onDoubleClick = useCallback(() => {
    setStored(defaultLeading);
    saveSplit(storageKey, null);
  }, [defaultLeading, storageKey]);

  return {
    dragging,
    containerRef,
    cols: {
      "--sb-split-cols": `${width}px ${HANDLE_WIDTH}px minmax(0, 1fr)`,
    } as CSSProperties,
    handle: { width, max, onPointerDown, onKeyDown, onDoubleClick },
  };
}

/**
 * The divider itself: a hairline in a 7px track, widening on hover and while
 * dragged so it reads as a grab target without taking space when it is not one.
 *
 * It is a focusable `separator`, so the split is adjustable from the keyboard as
 * well as the pointer: arrows nudge, Home and End go to the stops, and a double
 * click restores the default.
 */
export function SplitHandle({ split, label }: { split: SplitPane; label: string }) {
  const { width, max, onPointerDown, onKeyDown, onDoubleClick } = split.handle;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_LEADING}
      aria-valuemax={max === Infinity ? undefined : Math.round(max)}
      tabIndex={0}
      title="Drag to resize, double click to reset"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      className={`group relative hidden cursor-col-resize touch-none select-none lg:block ${focusRing}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 transition-colors duration-150 ${split.dragging ? "w-[3px] bg-accent-dim" : "w-px bg-line group-hover:w-[3px] group-hover:bg-accent-dim"}`}
      />
    </div>
  );
}
