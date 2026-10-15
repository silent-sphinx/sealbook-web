import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { focusRing } from "../lib/styles";

/**
 * The row actions, as a menu the pointer opens on right-click.
 *
 * A sidebar row carries two or three actions, and drawing them all on every row
 * leaves a column of competing icons. On a pointer device they live here
 * instead; without a pointer there is no right-click, so the rows keep their own
 * buttons and `.list-row-actions` in `index.css` decides which case applies.
 */
export type MenuItem = {
  label: string;
  onSelect: () => void;
  /** Drawn in the danger colour, and separated from what comes before it. */
  danger?: boolean;
  disabled?: boolean;
  /** Why the item is unavailable, for the title attribute. */
  disabledReason?: string;
};

export type MenuState = { x: number; y: number; items: MenuItem[] } | null;

export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState>(null);
  return {
    menu,
    /**
     * Call from `onContextMenu`; a row with no items opens nothing.
     *
     * The Menu key and Shift+F10 raise the same event with no coordinates, so a
     * zeroed pointer is read as "from the keyboard" and the menu is placed
     * against the row instead. That is what makes the actions reachable without
     * a mouse now that the row's icons are gone.
     */
    open(event: ReactMouseEvent, items: MenuItem[]) {
      if (items.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.clientX === 0 && event.clientY === 0) {
        const box = event.currentTarget.getBoundingClientRect();
        setMenu({ x: box.left + box.width / 2, y: box.bottom, items });
        return;
      }
      setMenu({ x: event.clientX, y: event.clientY, items });
    },
    close() {
      setMenu(null);
    },
  };
}

/** Keeps the menu on screen, flipping it rather than letting it run off. */
const MARGIN = 8;

export function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);

  // Measured before paint: a menu that is painted at the pointer and then moved
  // is a menu that visibly jumps.
  useLayoutEffect(() => {
    if (!state || !ref.current) {
      setPlaced(null);
      return;
    }
    const box = ref.current.getBoundingClientRect();
    const left =
      state.x + box.width + MARGIN > window.innerWidth
        ? Math.max(MARGIN, state.x - box.width)
        : state.x;
    const top =
      state.y + box.height + MARGIN > window.innerHeight
        ? Math.max(MARGIN, state.y - box.height)
        : state.y;
    setPlaced({ left, top });
    ref.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [state]);

  useEffect(() => {
    if (!state) return;
    // Capture phase fires at `window` before the event reaches the menu, so
    // `stopPropagation` on the menu's own `onPointerDown` is already too late
    // to stop this listener. Checking containment instead lets outside clicks
    // close immediately while clicks on the menu's own buttons still land.
    const close = (event: Event) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = Array.from(
        ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
      );
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? at + 1 : at - 1;
      items[(next + items.length) % items.length]?.focus();
    };
    // `true` so a click anywhere closes the menu before that click does anything
    // else, which is what every other context menu does.
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [state, onClose]);

  if (!state) return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      // Hidden until measured, rather than drawn at the pointer and corrected.
      style={{
        left: placed?.left ?? state.x,
        top: placed?.top ?? state.y,
        visibility: placed ? "visible" : "hidden",
      }}
      className="fixed z-50 min-w-[10rem] overflow-hidden rounded-xl border border-line bg-panel py-1 shadow-lg shadow-black/40"
      onContextMenu={(event) => event.preventDefault()}
    >
      {state.items.map((item, at) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          title={item.disabled ? item.disabledReason : undefined}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className={`flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            item.danger
              ? "text-danger hover:bg-danger/10"
              : "text-text hover:bg-surface disabled:hover:bg-transparent"
          } ${at > 0 && item.danger && !state.items[at - 1]?.danger ? "mt-1 border-t border-line pt-2" : ""} ${focusRing}`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
