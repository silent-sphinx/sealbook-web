import { useEffect, useRef, useState, type FormEvent } from "react";
import { ALL_ADDRESS_BOOKS } from "../lib/addressBook";
import { field, ghost, primary } from "../lib/styles";
import type { AddressBook } from "../lib/types";

type Props = {
  books: AddressBook[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<void> | void;
  busy?: boolean;
};

export function AddressBookMenu({
  books,
  selectedId,
  onSelect,
  onCreate,
  busy = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel =
    selectedId === ALL_ADDRESS_BOOKS
      ? "All"
      : (books.find((book) => book.id === selectedId)?.name ?? "All");

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setCreating(false);
      }
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (creating) {
      inputRef.current?.focus();
    }
  }, [creating]);

  async function submitNew(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) {
      return;
    }
    await onCreate(trimmed);
    setName("");
    setCreating(false);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        className="flex h-[42px] w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-line bg-panel px-3.5 text-sm text-text outline-none transition-colors duration-150 hover:border-line-light focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setCreating(false);
        }}
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-mute transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 12 8"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M1.5 1.75 6 6.25 10.5 1.75"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute z-50 mt-2 w-full min-w-[16rem] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/40 animate-scale-in"
        >
          <MenuItem
            label="All"
            selected={selectedId === ALL_ADDRESS_BOOKS}
            onClick={() => {
              onSelect(ALL_ADDRESS_BOOKS);
              setOpen(false);
              setCreating(false);
            }}
          />
          <div className="my-1 border-t border-line" />
          {books.map((book) => (
            <MenuItem
              key={book.id}
              label={book.name}
              selected={selectedId === book.id}
              onClick={() => {
                onSelect(book.id);
                setOpen(false);
                setCreating(false);
              }}
            />
          ))}
          <div className="my-1 border-t border-line" />
          {creating ? (
            <form onSubmit={submitNew} className="px-3 py-3">
              <label className="block text-sm text-mute">
                Address book name
                <input
                  ref={inputRef}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={field}
                  placeholder="Friends"
                  required
                />
              </label>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  className={ghost}
                  onClick={() => {
                    setCreating(false);
                    setName("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !name.trim()}
                  className={`${primary} w-auto px-4 py-1.5`}
                >
                  {busy ? "Please wait…" : "Create"}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-accent transition-colors duration-150 hover:bg-surface"
              onClick={() => {
                setCreating(true);
                setName("");
              }}
            >
              <span className="text-base leading-none">+</span>
              New address book
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm transition-colors duration-150 hover:bg-surface ${
        selected ? "text-accent" : "text-text"
      }`}
      onClick={onClick}
    >
      <span className="min-w-0 truncate">{label}</span>
      {selected ? (
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
            clipRule="evenodd"
          />
        </svg>
      ) : null}
    </button>
  );
}
