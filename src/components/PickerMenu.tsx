import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placeAt } from "../lib/placement";
import { btnSecondarySm, eyebrow, focusRing, popoverSurface, searchField, searchIcon } from "../lib/styles";
import { Icon } from "./Icon";

/** Past this many options the list gets a filter box, so a long list stays reachable. */
const FILTER_FROM = 8;

export type PickerOption = {
  id: string;
  name: string;
  /** Nesting level in a tree such as collections or task lists. */
  depth?: number;
  count?: number;
  /** Shown in the leading slot when the row is not the current one. */
  glyph?: ReactNode;
};

export type PickerCreate = {
  /** The footer row's text, such as "New notebook". */
  label: string;
  placeholder?: string;
  /** Resolves to the new item's id, or `undefined` when it could not be made. */
  onCreate: (name: string) => Promise<string | undefined>;
};

type Props = {
  options: PickerOption[];
  /** The current option. Leave it out for a picker that acts, such as "Move to". */
  value?: string | null;
  onPick: (id: string) => void;
  /** Adds a "Clear" action to the header. */
  onClear?: () => void;
  /** The panel's name, and the eyebrow over it. */
  title: string;
  searchLabel: string;
  /** Plural, for "No tags match". */
  emptyNoun: string;
  create?: PickerCreate;
  trigger: ReactNode;
  /** Replaces the default secondary small button look. */
  triggerClassName?: string;
  /** Names the trigger when its content alone would not, such as a bare current value. */
  triggerLabel?: string;
  disabled?: boolean;
};

/**
 * A button that opens a scrollable, searchable list to pick one thing from,
 * optionally with a row at the foot to make a new one. It is not a
 * `ContextMenu` because that menu closes on any scroll and cannot scroll itself.
 */
export function PickerMenu({
  options,
  value,
  onPick,
  onClear,
  title,
  searchLabel,
  emptyNoun,
  create,
  trigger,
  triggerClassName = btnSecondarySm,
  triggerLabel,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const close = () => {
    setOpen(false);
    setQuery("");
    setCreating(false);
    setDraft("");
    setFailed(null);
    setPlaced(null);
  };

  useLayoutEffect(() => {
    if (!open || !button.current || !panel.current) return;
    const anchor = button.current.getBoundingClientRect();
    const size = { width: panel.current.offsetWidth, height: panel.current.offsetHeight };
    // Opened from the button's left edge, flipped by `placeAt` when it would overrun.
    setPlaced(placeAt({ x: anchor.left, y: anchor.bottom + 4 }, size, { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);

  const isPlaced = placed !== null;
  useEffect(() => {
    if (!open || !isPlaced) return;
    panel.current?.querySelector<HTMLElement>("input, [data-picker-row]")?.focus();
  }, [open, isPlaced]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || button.current?.contains(target)) return;
      close();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        if (panel.current?.contains(event.target as Node)) moveFocus(event);
        return;
      }
      event.stopPropagation();
      if (creating) {
        setCreating(false);
        setDraft("");
        setFailed(null);
        return;
      }
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
  }, [open, creating]);

  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((option) => option.name.toLowerCase().includes(needle)) : options;
  const typed = query.trim();
  const exact = typed !== "" && options.some((option) => option.name.toLowerCase() === typed.toLowerCase());
  // A search that names nothing that exists offers to make it, so the box doubles as the name field.
  const createFromQuery = create !== undefined && typed !== "" && !exact;

  function pick(id: string) {
    onPick(id);
    close();
  }

  async function make(name: string) {
    if (!create || busy) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setFailed(null);
    let id: string | undefined;
    try {
      id = await create.onCreate(trimmed);
    } catch {
      id = undefined;
    }
    setBusy(false);
    if (id) pick(id);
    else setFailed(`Couldn't create "${trimmed}".`);
  }

  function moveFocus(event: globalThis.KeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const rows = Array.from(panel.current?.querySelectorAll<HTMLElement>("input, [data-picker-row]") ?? []);
    if (rows.length === 0) return;
    // Home and End belong to a text field's caret.
    if ((event.key === "Home" || event.key === "End") && event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    const at = rows.indexOf(event.target as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : (at + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus();
  }

  const rowClass = `flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm outline-none transition-colors focus-visible:bg-hover ${focusRing}`;

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              role="dialog"
              aria-label={title}
              style={{ left: placed?.left ?? 0, top: placed?.top ?? 0, visibility: placed ? "visible" : "hidden" }}
              className={`fixed z-(--z-popover) flex w-72 origin-top-left animate-pop flex-col overflow-hidden ${popoverSurface}`}
            >
              <div className="flex h-9 items-center justify-between px-3.5 pt-1">
                <p className={eyebrow}>{title}</p>
                {onClear && value ? (
                  <button
                    type="button"
                    onClick={() => {
                      onClear();
                      close();
                    }}
                    className={`-mr-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-accent hover:underline ${focusRing}`}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              {options.length > FILTER_FROM ? (
                <div className="relative px-2.5 pb-2 pt-1">
                  <Icon name="search" className={`${searchIcon} left-5`} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      if (shown[0]) pick(shown[0].id);
                      else if (createFromQuery) void make(typed);
                    }}
                    placeholder={searchLabel}
                    aria-label={searchLabel}
                    className={`${searchField} h-8`}
                  />
                </div>
              ) : null}
              <ul className="max-h-[min(20rem,60vh)] space-y-0.5 overflow-y-auto overscroll-contain border-t border-line p-1.5">
                {shown.map((option) => {
                  const on = value !== undefined && option.id === value;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        data-picker-row
                        aria-pressed={value === undefined ? undefined : on}
                        onClick={() => pick(option.id)}
                        className={`${rowClass} ${on ? "bg-accent-soft font-medium text-text" : "text-text hover:bg-hover"}`}
                        style={option.depth ? { paddingLeft: `${0.5 + option.depth * 0.875}rem` } : undefined}
                      >
                        <span className="flex size-4 shrink-0 items-center justify-center text-accent">
                          {on ? <Icon name="check" className="size-3.5" /> : <span className="text-mute">{option.glyph}</span>}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{option.name}</span>
                        {option.count !== undefined ? (
                          <span className="rounded-full bg-surface px-1.5 text-2xs tabular-nums text-mute">{option.count}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
                {shown.length === 0 && !createFromQuery ? (
                  <li className="px-2 py-3 text-center text-xs text-mute">
                    No {emptyNoun} match "{typed}"
                  </li>
                ) : null}
              </ul>
              {create ? (
                <div className="border-t border-line p-1.5">
                  {creating ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void make(draft);
                      }}
                      className="px-1 py-0.5"
                    >
                      <input
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder={create.placeholder ?? create.label}
                        aria-label={create.label}
                        disabled={busy}
                        className={`${searchField} h-8 pl-2.5`}
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      data-picker-row
                      disabled={busy}
                      onClick={() => (createFromQuery ? void make(typed) : setCreating(true))}
                      className={`${rowClass} text-accent hover:bg-hover disabled:opacity-60`}
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        <Icon name="plus" className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{createFromQuery ? `Create "${typed}"` : create.label}</span>
                    </button>
                  )}
                  {failed ? (
                    <p role="alert" className="px-2 pb-1 pt-0.5 text-xs text-danger">
                      {failed}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
