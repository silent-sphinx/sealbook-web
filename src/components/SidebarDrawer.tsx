import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../lib/useMediaQuery";
import { focusRing } from "../lib/styles";

/** Matches the `lg:` breakpoint the contacts and calendar grids switch on. */
const DESKTOP = "(min-width: 1024px)";

type Props = {
  /** Accessible name for the drawer below the desktop breakpoint. */
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

/**
 * The contacts and calendar sidebars: a static column on a wide screen, a
 * slide-over drawer on a narrow one. Previously the column simply reflowed
 * below the list on a phone, which buried the address books under a screenful
 * of content. Swapping on a media query rather than rendering both copies and
 * toggling `lg:hidden` keeps one instance of the list, so a half-typed rename
 * and the list's own focus are not duplicated.
 */
export function SidebarDrawer({ title, open, onClose, children }: Props) {
  const isDesktop = useMediaQuery(DESKTOP);
  const panelRef = useRef<HTMLDivElement>(null);
  // Callers pass an inline arrow, so this is a new function every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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

  // Widening the window while the drawer is open would otherwise leave the
  // caller thinking it is still showing something dismissible.
  useEffect(() => {
    if (isDesktop && open) onCloseRef.current();
  }, [isDesktop, open]);

  if (isDesktop) {
    return (
      <aside className="border-r border-line bg-panel/25 px-6 py-7 lg:overflow-y-auto">
        {children}
      </aside>
    );
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex w-[17.5rem] max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-panel px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl shadow-black/50 outline-none animate-slide-in-left"
      >
        <div className="-mr-1.5 mb-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors hover:bg-surface hover:text-text ${focusRing}`}
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
        {children}
      </aside>
    </div>,
    document.body,
  );
}

/** Toolbar button that opens the sidebar; hidden once the column is visible. */
export function SidebarTrigger({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-mute transition-colors hover:border-line-light hover:bg-surface hover:text-text lg:hidden ${focusRing}`}
    >
      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
      </svg>
    </button>
  );
}
