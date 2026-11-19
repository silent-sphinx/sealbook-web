import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../lib/useMediaQuery";
import { eyebrow as eyebrowClass, focusRing, iconBtn, scrim } from "../lib/styles";
import { Icon } from "./Icon";

/** Matches the `lg:` breakpoint the contacts and calendar grids switch on. */
const DESKTOP = "(min-width: 1024px)";

/**
 * One width for every view's sidebar, matching the drawer below `DESKTOP` so
 * the column does not change size as the breakpoint is crossed.
 */
const SIDEBAR_WIDTH = "16rem";

/** One key, not one per view: the collapse is a property of the shell. */
const COLLAPSE_KEY = "sealbook.sidebar-collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export type Sidebar = {
  /** Above `DESKTOP` the sidebar is a static column rather than a drawer. */
  isDesktop: boolean;
  /** The static column is collapsed out of the grid; false below `DESKTOP`. */
  collapsed: boolean;
  /** The slide-over is showing; only meaningful below `DESKTOP`. */
  open: boolean;
  /** Collapses the column, or shows the drawer, depending on the breakpoint. */
  toggle: () => void;
  /** Dismisses the drawer; a no-op once the sidebar is a column. */
  close: () => void;
  /** `--sb-sidebar-cols` for the `.sb-shell` the sidebar sits in. */
  cols: CSSProperties;
};

/**
 * Owns the sidebar's two independent states: whether the drawer is showing
 * below `DESKTOP`, and whether the static column is collapsed above it. A
 * collapse removes the column rather than narrowing it to a rail, so the
 * content takes the whole row.
 *
 * Called once, in the shell, and handed to each view: contacts, calendar and
 * notes share the one collapse, the one control in the header and the one
 * width, so neither the sidebar nor its size changes on switching tabs.
 */
export function useSidebar(): Sidebar {
  const isDesktop = useMediaQuery(DESKTOP);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  // Widening the window while the drawer is open would otherwise leave the
  // caller thinking it is still showing something dismissible.
  useEffect(() => {
    if (isDesktop) setOpen(false);
  }, [isDesktop]);

  const toggle = useCallback(() => {
    if (!isDesktop) {
      setOpen((current) => !current);
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // storage unavailable; the collapse still holds for this session
    }
  }, [collapsed, isDesktop]);

  const close = useCallback(() => setOpen(false), []);

  const cols = useMemo(
    () =>
      ({
        "--sb-sidebar-cols": collapsed
          ? "minmax(0, 1fr)"
          : `${SIDEBAR_WIDTH} minmax(0, 1fr)`,
      }) as CSSProperties,
    [collapsed],
  );

  return { isDesktop, collapsed: isDesktop && collapsed, open, toggle, close, cols };
}

type Props = {
  /** Accessible name for the drawer below the desktop breakpoint. */
  title: string;
  sidebar: Sidebar;
  children: ReactNode;
};

/**
 * Lets `SidebarHeader` draw the control that dismisses the sidebar it is in,
 * which is "hide" for the column and "close" for the drawer, without each of the
 * six views threading the sidebar state down to it.
 */
const SidebarContext = createContext<Sidebar | null>(null);

/**
 * The contacts, calendar, notes, bookmarks, tasks and settings sidebars: a
 * static column on a wide screen, a slide-over drawer on a narrow one. Swapping
 * on a media query rather than rendering both copies and toggling `lg:hidden`
 * keeps one instance of the list, so a half-typed rename and the list's own
 * focus are not duplicated.
 */
export function SidebarDrawer({ title, sidebar, children }: Props) {
  const { isDesktop, collapsed, open } = sidebar;
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers pass an inline arrow, so this is a new function every render.
  const onCloseRef = useRef(sidebar.close);
  onCloseRef.current = sidebar.close;

  const drawerOpen = open && !isDesktop;

  useEffect(() => {
    if (!drawerOpen) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCloseRef.current();
    }

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [drawerOpen]);

  if (isDesktop) {
    // `hidden` rather than a width of zero: a clipped column would still be in
    // the tab order, so collapsing it would hide a dozen reachable controls
    // behind nothing. React keeps the subtree's state either way, so a
    // half-typed rename survives a collapse.
    return (
      <aside
        hidden={collapsed}
        className="min-h-0 overflow-y-auto border-r border-line bg-panel/30 px-3 pb-4"
      >
        <SidebarContext.Provider value={sidebar}>{children}</SidebarContext.Provider>
      </aside>
    );
  }

  // Closed, there is nothing to draw: each pane header carries the control that
  // opens it, so a sidebar is never more than a tap from where the user is.
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-(--z-overlay) flex">
      <div
        className={`absolute inset-0 ${scrim} animate-fade-in`}
        onClick={sidebar.close}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ "--sb-drawer-w": SIDEBAR_WIDTH } as CSSProperties}
        className="relative flex w-full flex-col overflow-y-auto bg-panel px-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-dialog outline-none animate-slide-in-left sm:w-(--sb-drawer-w) sm:max-w-[85vw] sm:border-r sm:border-line"
      >
        <SidebarContext.Provider value={sidebar}>{children}</SidebarContext.Provider>
      </aside>
    </div>,
    document.body,
  );
}

type SidebarHeaderProps = {
  title: string;
  /** Makes the title a button, for views whose title is also their home. */
  onTitleClick?: () => void;
  /** The view's primary action, e.g. the calendar and contacts "add" buttons. */
  action?: ReactNode;
};

/**
 * The row every sidebar opens with. It is as tall as a pane's header, so the two
 * rules meet in one line across the view, and it holds the control that hides
 * the sidebar rather than leaving that to a row of its own.
 */
export function SidebarHeader({ title, onTitleClick, action }: SidebarHeaderProps) {
  const sidebar = useContext(SidebarContext);
  const dismiss = sidebar?.isDesktop ? "Hide sidebar" : "Close sidebar";
  return (
    <div className="sticky top-0 z-10 -mx-3 mb-1 flex h-(--sb-bar-h) shrink-0 items-center gap-1 border-b border-line bg-bg/70 pl-4 pr-2 backdrop-blur-md">
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            className={`rounded-md transition-colors hover:text-accent ${focusRing}`}
          >
            {title}
          </button>
        ) : (
          title
        )}
      </h2>
      {action}
      {sidebar ? (
        <button
          type="button"
          onClick={sidebar.isDesktop ? sidebar.toggle : sidebar.close}
          aria-label={dismiss}
          aria-expanded={sidebar.isDesktop ? true : undefined}
          title={dismiss}
          className={iconBtn}
        >
          <Icon name={sidebar.isDesktop ? "sidebar" : "close"} className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

type SidebarSectionProps = {
  label: string;
  /** The section's own "+" button, e.g. "Add notebook". */
  action?: ReactNode;
  children: ReactNode;
};

/**
 * A labelled sidebar section: the uppercase label row with an optional add
 * button. Sections are set apart by space rather than rules, so a sidebar reads
 * as a list of groups and not a stack of boxes.
 */
export function SidebarSection({ label, action, children }: SidebarSectionProps) {
  return (
    <div data-sidebar-section={label} className="mt-5 first:mt-3">
      {/* Held at the action's height so a section without one lines up too. */}
      <div className="flex min-h-7 items-center justify-between">
        <p className={eyebrowClass}>{label}</p>
        {action ?? null}
      </div>
      {children}
    </div>
  );
}

/**
 * Brings the sidebar back from a pane header: restores a collapsed column on a
 * wide screen and opens the drawer on a narrow one. It draws nothing while the
 * column is showing, so a header carries it unconditionally and the control
 * appears exactly when there is a sidebar to go back to.
 */
export function SidebarToggle({ sidebar }: { sidebar: Sidebar }) {
  if (sidebar.isDesktop && !sidebar.collapsed) return null;
  return (
    <button
      type="button"
      onClick={sidebar.toggle}
      aria-label="Show sidebar"
      aria-expanded={false}
      title="Show sidebar"
      className={iconBtn}
    >
      <Icon name="sidebar" className="size-4" />
    </button>
  );
}
