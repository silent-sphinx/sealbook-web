import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { placeAt, type Point } from "../lib/placement";
import { focusRing, menuItem, menuItemTone, popover } from "../lib/styles";
import { Icon, type IconName } from "./Icon";

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
  icon?: IconName;
};

export type MenuState = {
  x: number;
  y: number;
  items: MenuItem[];
  trigger?: string;
  /** Above the items, for a menu that says whose it is, such as the account menu. */
  header?: ReactNode;
} | null;

export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState>(null);
  return {
    menu,
    /**
     * For a button that opens a menu: a second click on the same button closes
     * it. The menu ignores pointerdowns on a `data-menu-trigger` element, so the
     * click still finds the menu open instead of reopening one that has just shut.
     */
    toggle(event: ReactMouseEvent, items: MenuItem[], trigger: string) {
      if (menu?.trigger === trigger) {
        setMenu(null);
        return;
      }
      this.open(event, items, trigger);
    },
    /**
     * Call from `onContextMenu`; a row with no items opens nothing.
     *
     * The Menu key and Shift+F10 raise the same event with no coordinates, so a
     * zeroed pointer is read as "from the keyboard" and the menu is placed
     * against the row instead. That is what makes the actions reachable without
     * a mouse now that the row's icons are gone.
     */
    open(event: ReactMouseEvent, items: MenuItem[], trigger?: string) {
      if (items.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.clientX === 0 && event.clientY === 0) {
        const box = event.currentTarget.getBoundingClientRect();
        setMenu({ x: box.left + box.width / 2, y: box.bottom, items, trigger });
        return;
      }
      setMenu({ x: event.clientX, y: event.clientY, items, trigger });
    },
    /**
     * For a control that is not a pointer event's target, such as a rail button
     * opened from a handler that has already read its rectangle. The panel flips
     * from `point` rather than clamping, so a menu on a button at the foot of the
     * screen grows upward from it.
     */
    openAt(point: Point, items: MenuItem[], options: { trigger?: string; header?: ReactNode } = {}) {
      if (items.length === 0) return;
      setMenu({ x: point.x, y: point.y, items, ...options });
    },
    close() {
      setMenu(null);
    },
  };
}

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
    // Layout size, not the bounding rect: the panel opens from `scale(0.95)`, so
    // its rect is 5% smaller than the panel and a menu at an edge would overrun it.
    const panel = ref.current;
    setPlaced(
      placeAt(
        { x: state.x, y: state.y },
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    ref.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [state]);

  useEffect(() => {
    if (!state) return;
    // Capture phase fires at `window` before the event reaches the menu, so
    // `stopPropagation` on the menu's own `onPointerDown` is already too late
    // to stop this listener. Checking containment instead lets outside clicks
    // close immediately while clicks on the menu's own buttons still land.
    const close = (event: Event) => {
      const target = event.target as Element;
      if (ref.current?.contains(target) || target.closest?.("[data-menu-trigger]")) return;
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

  // Destructive items always close the menu, set apart and in red, whatever
  // order the caller built them in.
  const ordered = [...state.items.filter((item) => !item.danger), ...state.items.filter((item) => item.danger)];

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
      className={`fixed z-(--z-popover) min-w-48 origin-top-left animate-pop overflow-hidden ${popover}`}
      onContextMenu={(event) => event.preventDefault()}
    >
      {state.header ? (
        <div className="mb-1 border-b border-line px-2.5 pb-2 pt-1.5">{state.header}</div>
      ) : null}
      {ordered.map((item, at) => (
        <Fragment key={item.label}>
          {item.danger && at > 0 && !ordered[at - 1]?.danger ? (
            <hr className="-mx-1 my-1 border-0 border-t border-line" />
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            title={item.disabled ? item.disabledReason : undefined}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`${menuItem} ${menuItemTone(item.danger)} ${focusRing}`}
          >
            {item.icon ? <Icon name={item.icon} className="size-3.5 shrink-0 opacity-80" /> : null}
            {item.label}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
