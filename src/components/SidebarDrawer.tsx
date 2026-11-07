import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../lib/useMediaQuery";
import { eyebrow as eyebrowClass, focusRing } from "../lib/styles";
import { Icon } from "./Icon";

/** Matches the `lg:` breakpoint the contacts and calendar grids switch on. */
const DESKTOP = "(min-width: 1024px)";

/**
 * One width for every view's sidebar, matching the drawer below `DESKTOP` so
 * the column does not change size as the breakpoint is crossed.
 */
const SIDEBAR_WIDTH = "17.5rem";

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
 * The contacts, calendar and notes sidebars: a static column on a wide screen,
 * a slide-over drawer on a narrow one. Previously the column simply reflowed
 * below the list on a phone, which buried the address books under a screenful
 * of content. Swapping on a media query rather than rendering both copies and
 * toggling `lg:hidden` keeps one instance of the list, so a half-typed rename
 * and the list's own focus are not duplicated.
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
      <>
        <aside
          hidden={collapsed}
          className="border-r border-line bg-panel/25 px-6 py-7 lg:overflow-y-auto"
        >
          {/* Its own row rather than a corner of the title row, which the
              contacts and calendar sidebars already end with a `+` button. */}
          <div className="-mr-1.5 -mt-2.5 mb-1 flex justify-end">
            <ToggleButton sidebar={sidebar} />
          </div>
          {children}
        </aside>
        {collapsed ? <EdgeHandle sidebar={sidebar} /> : null}
      </>
    );
  }

  if (!open) return <EdgeHandle sidebar={sidebar} />;

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
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
        className="relative flex w-full flex-col overflow-y-auto bg-panel sm:w-(--sb-drawer-w) sm:max-w-[85vw] sm:border-r sm:border-line px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl shadow-black/50 outline-none animate-slide-in-left"
      >
        <div className="-mr-1.5 mb-2 flex justify-end">
          <button
            type="button"
            onClick={sidebar.close}
            aria-label="Close sidebar"
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

type SidebarHeaderProps = {
  eyebrow: string;
  title: string;
  /** Makes the title a button, for views whose title is also their home. */
  onTitleClick?: () => void;
  /** The view's primary action, e.g. the calendar and contacts "add" buttons. */
  action?: ReactNode;
};

/** The eyebrow and title every sidebar opens with, shared so the two stay the same size everywhere. */
export function SidebarHeader({ eyebrow, title, onTitleClick, action }: SidebarHeaderProps) {
  const heading = (
    <div>
      <p className={eyebrowClass}>{eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold">
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            className={`rounded transition-colors hover:text-accent ${focusRing}`}
          >
            {title}
          </button>
        ) : (
          title
        )}
      </h2>
    </div>
  );
  if (!action) return heading;
  return (
    <div className="flex items-center justify-between">
      {heading}
      {action}
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
 * button, set off from whatever precedes it (the header, a search box, a
 * mini month) by the same divider in every view.
 */
export function SidebarSection({ label, action, children }: SidebarSectionProps) {
  return (
    <div className="mt-6 border-t border-line pt-4">
      {/* Held at the action's height so a section without one lines up too. */}
      <div className="flex min-h-7 items-center justify-between">
        <p className={eyebrowClass}>{label}</p>
        {action ?? null}
      </div>
      {children}
    </div>
  );
}

function Chevron({ back }: { back: boolean }) {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={back ? "M9.75 3.5 5.25 8l4.5 4.5" : "M6.25 3.5 10.75 8l-4.5 4.5"} />
    </svg>
  );
}

/** Collapses the column, from inside the column itself. */
function ToggleButton({ sidebar }: { sidebar: Sidebar }) {
  return (
    <button
      type="button"
      onClick={sidebar.toggle}
      aria-label="Hide sidebar"
      aria-expanded={true}
      title="Hide sidebar"
      className={`flex h-7 w-7 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
    >
      <Chevron back />
    </button>
  );
}

/**
 * What brings the sidebar back: a handle on the content's leading edge, drawn
 * whenever the sidebar is not showing. It is the one affordance for both
 * breakpoints, restoring the column on a wide screen and opening the drawer on
 * a narrow one, and it is always drawn rather than revealed on hover, since a
 * sidebar you cannot find is a sidebar you have lost. It is pinned to the
 * middle of the viewport below the header, not of the view, so it sits at the
 * same height in every tab whatever the view's own height or banners.
 */
function EdgeHandle({ sidebar }: { sidebar: Sidebar }) {
  return (
    <button
      type="button"
      onClick={sidebar.toggle}
      aria-label="Show sidebar"
      aria-expanded={false}
      title="Show sidebar"
      className={`fixed left-0 top-[calc(50dvh+var(--sb-header-h,74px)/2)] z-30 flex h-16 w-5 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-line bg-panel text-mute shadow-lg shadow-black/30 transition-colors hover:bg-surface hover:text-text ${focusRing}`}
    >
      <Chevron back={false} />
    </button>
  );
}
