import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { iconBtn, scrim } from "../lib/styles";
import { Icon } from "./Icon";

type Props = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** Above a full-screen overlay of its own, such as the attachment lightbox. */
  elevated?: boolean;
  /** `md` is what every dialog was before sizes existed, so nothing reflows. */
  size?: "sm" | "md" | "lg";
  /**
   * False for a dialog that reports work in progress and has nothing to cancel:
   * no Close button, and neither Escape nor a click on the backdrop dismisses it.
   */
  dismissible?: boolean;
  /** `top` sits the panel near the top edge, for a palette whose list grows. */
  align?: "center" | "top";
};

const SIZE = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-2xl" } as const;

// Open dialogs, outermost first. Only the topmost reacts to Escape and traps
// Tab, so dismissing a confirm stacked on a form does not also close the form.
const stack: object[] = [];

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Modal({
  title,
  children,
  onClose,
  elevated = false,
  size = "md",
  dismissible = true,
  align = "center",
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef({});
  // Callers pass an inline arrow, so onClose is a new function every render.
  // Keeping it in a ref lets the setup effect run once on mount; keying it on
  // onClose instead would re-run the focus logic on every keystroke.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  // Stacked dialogs would otherwise both render id="modal-title".
  const titleId = useId();

  useEffect(() => {
    const token = tokenRef.current;
    stack.push(token);
    const isTopmost = () => stack[stack.length - 1] === token;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Return focus to whatever opened the dialog, rather than dropping the
    // caret on <body> where the next Tab restarts from the top of the page.
    const opener = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    // Respect an explicit autoFocus inside the dialog; otherwise focus the
    // panel so screen readers announce it and Tab starts from inside.
    if (panel && !panel.contains(document.activeElement)) {
      const first = panel.querySelector<HTMLElement>("[autofocus]");
      (first ?? panel).focus();
    }

    function onKey(event: KeyboardEvent) {
      if (!isTopmost()) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        if (dismissibleRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      // Trap Tab inside the dialog; without this it walks into the page behind.
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((node) => node.offsetParent !== null || node === document.activeElement);
      if (items.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      const index = stack.indexOf(token);
      if (index !== -1) stack.splice(index, 1);
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      if (opener && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  return createPortal(
    // Closing on a backdrop click has no keyboard equivalent of its own, by
    // design: Escape is the keyboard path, handled in the effect above.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={`fixed inset-0 ${elevated ? "z-(--z-modal-top)" : "z-(--z-modal)"} flex justify-center ${
        align === "top" ? "items-start pt-[8vh]" : "items-center"
      } ${scrim} p-4 sm:p-6 animate-fade-in`}
      onClick={(event) => {
        // Only a click that landed on the backdrop itself. Testing the target
        // rather than stopping propagation on the panel leaves clicks inside
        // the dialog visible to anything else listening on the document.
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`glow-edge relative flex max-h-[min(92dvh,42rem)] w-full min-w-0 ${SIZE[size]} flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-dialog outline-none animate-dialog`}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line pl-5 pr-3">
          <h2
            id={titleId}
            className="min-w-0 truncate text-base font-semibold tracking-tight text-text"
          >
            {title}
          </h2>
          {dismissible ? (
            <button type="button" className={iconBtn} aria-label="Close" onClick={onClose}>
              <Icon name="close" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The scrolling body and the footer are slots, not props, so a form can wrap
 * both and its submit button stays inside it.
 */
export function ModalBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`min-h-0 flex-1 overflow-y-auto p-5 ${className}`}>{children}</div>;
}

/** Cancel first, the action last, right-aligned. */
export function ModalFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3 ${className}`}
    >
      {children}
    </div>
  );
}
