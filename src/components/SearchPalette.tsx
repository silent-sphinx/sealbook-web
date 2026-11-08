import { useDeferredValue, useId, useMemo, useState, type ReactNode } from "react";
import { BookmarksIcon, CalendarIcon, ContactsIcon, NotesIcon, TasksIcon } from "./AppIcons";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { Modal } from "./Modal";
import { eyebrow, searchClear, searchField, searchIcon } from "../lib/styles";
import type { SearchHit, SearchKind } from "../lib/vaultSearch";
import type { VaultSearchIndex } from "../lib/wasm";

/** Results shown per kind. */
const PER_KIND = 5;

const KIND_LABEL: Record<SearchKind, string> = {
  contact: "Contacts",
  event: "Calendar",
  note: "Notes",
  bookmark: "Bookmarks",
  task: "Tasks",
};

const KIND_ICON: Record<SearchKind, ReactNode> = {
  contact: <ContactsIcon />,
  event: <CalendarIcon />,
  note: <NotesIcon />,
  bookmark: <BookmarksIcon />,
  task: <TasksIcon />,
};

type Props = {
  /** Null while the index is being built. */
  index: VaultSearchIndex | null;
  /** A date for an event row, which core leaves to the host's zone. */
  eventLabel: (id: string) => string | null;
  onPick: (hit: SearchHit) => void;
  onClose: () => void;
};

export function SearchPalette({ index, eventLabel, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const listId = useId();

  const hits = useMemo(
    () => (index && deferred.trim() ? index.search(deferred, PER_KIND) : []),
    [index, deferred],
  );

  const [cursor, setCursor] = useState(0);
  const [cursorFor, setCursorFor] = useState(hits);
  if (cursorFor !== hits) {
    setCursorFor(hits);
    setCursor(0);
  }

  const groups = useMemo(() => {
    const out: { kind: SearchKind; rows: { hit: SearchHit; place: number }[] }[] = [];
    hits.forEach((hit, place) => {
      const last = out[out.length - 1];
      if (last?.kind === hit.kind) last.rows.push({ hit, place });
      else out.push({ kind: hit.kind, rows: [{ hit, place }] });
    });
    return out;
  }, [hits]);

  const optionId = (place: number) => `${listId}-${place}`;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (hits.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[cursor];
      if (hit) onPick(hit);
    }
  }

  const searching = deferred.trim() !== "";

  return (
    <Modal title="Search" onClose={onClose}>
      <div className="border-b border-line px-4 py-3">
        <div className="relative">
          <Icon name="search" className={searchIcon} />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search contacts, events, notes, bookmarks and tasks"
            aria-label="Search everything"
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits.length > 0 ? optionId(cursor) : undefined}
            className={`${searchField} h-9 text-sm`}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className={searchClear}
              aria-label="Clear search"
              title="Clear search"
            >
              <Icon name="close" className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        {!searching ? (
          <EmptyState
            title="Search the whole vault"
            body="Type to search. Use the arrow keys to move and Enter to open."
          />
        ) : hits.length === 0 ? (
          index ? <EmptyState title={`Nothing matches “${deferred.trim()}”`} /> : null
        ) : (
          <div id={listId} role="listbox" aria-label="Search results">
            {groups.map((group) => (
              <div key={group.kind} role="group" aria-label={KIND_LABEL[group.kind]} className="pb-1">
                <p className={`${eyebrow} px-4 pb-1 pt-2`}>{KIND_LABEL[group.kind]}</p>
                {group.rows.map(({ hit, place }) => {
                  const detail = hit.kind === "event" ? eventLabel(hit.id) : null;
                  return (
                    // Picked with the pointer here; the keyboard path is the
                    // combobox above, which owns focus.
                    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                    <div
                      key={`${hit.kind}-${hit.id}`}
                      id={optionId(place)}
                      role="option"
                      tabIndex={-1}
                      aria-selected={place === cursor}
                      onPointerMove={() => setCursor(place)}
                      onClick={() => onPick(hit)}
                      className={`mx-2 flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${place === cursor ? "bg-surface" : ""}`}
                    >
                      <span className="mt-0.5 shrink-0 text-mute" aria-hidden="true">
                        {KIND_ICON[hit.kind]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-text">{hit.title}</span>
                        {hit.snippet ? (
                          <span className="block truncate text-xs text-mute">{hit.snippet}</span>
                        ) : null}
                      </span>
                      {detail || hit.context ? (
                        <span className="shrink-0 pt-0.5 text-right text-[11px] text-mute">
                          {detail ?? hit.context}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
