import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { iconButton } from "../lib/styles";
import { Icon } from "./Icon";

type Props = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** Above a full-screen overlay of its own, such as the attachment lightbox. */
  elevated?: boolean;
};

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

export function Modal({ title, children, onClose, elevated = false }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef({});
  // Callers pass an inline arrow, so onClose is a new function every render.
  // Keeping it in a ref lets the setup effect run once on mount; keying it on
  // onClose instead would re-run the focus logic on every keystroke.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
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
        onCloseRef.current();
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
      className={`fixed inset-0 ${elevated ? "z-[110]" : "z-50"} flex items-center justify-center bg-black/70 backdrop-blur-md p-4 sm:p-6 animate-fade-in`}
      onClick={(event) => {
        // Only a click that landed on the backdrop itself. Testing the target
        // rather than stopping propagation on the panel leaves clicks inside
        // the dialog visible to anything else listening on the document.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[min(92dvh,42rem)] w-full min-w-0 max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/50 outline-none animate-scale-in"
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4.5">
          <h2
            id={titleId}
            className="min-w-0 truncate text-lg font-semibold tracking-tight text-text"
          >
            {title}
          </h2>
          <button
            type="button"
            className={`${iconButton} -mr-1`}
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
