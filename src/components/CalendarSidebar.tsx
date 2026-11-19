import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { DEFAULT_CALENDAR_ID, sortCalendars } from "../lib/calendar";
import type { Calendar } from "../lib/types";
import {
  focusRing,
  sidebarCount,
  sidebarMark,
  sidebarNameInput,
  sidebarRowAction,
  sidebarRowState,
  sidebarSectionAction,
  sidebarSubgroup,
  sidebarRow,
} from "../lib/styles";
import { ColourPalette, type PaletteState } from "./ColourPalette";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { SidebarSection } from "./SidebarDrawer";
import { isLegibleOnDark } from "../lib/colour";
import { Icon } from "./Icon";



function CalendarSwatch({ color, hidden }: { color: string; hidden: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-md border-2 transition-colors duration-150"
      style={{ borderColor: color, backgroundColor: hidden ? "transparent" : color }}
    >
      {hidden ? null : (
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" stroke={isLegibleOnDark(color) ? "var(--color-bg)" : "var(--color-text)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m1.5 5.2 2.2 2.2L8.5 2.6" />
        </svg>
      )}
    </span>
  );
}

type Props = {
  calendars: Calendar[];
  archived: Calendar[];
  isVisible: (calendar: Calendar) => boolean;
  eventCounts: ReadonlyMap<string, number>;
  readOnly: boolean;
  canArchive: boolean;
  busy: boolean;
  onToggle: (calendarId: string) => void;
  onShowAll: () => void;
  onCreate: (name: string) => Promise<unknown>;
  onRename: (calendar: Calendar, name: string) => Promise<unknown>;
  onRecolor: (calendar: Calendar, color: string) => Promise<unknown>;
  onToggleFavorite: (calendar: Calendar) => void;
  onToggleArchived: (calendar: Calendar) => void;
  onPurge: (calendar: Calendar) => void;
  onDelete: (calendar: Calendar) => void;
};

/** The calendar sections of the sidebar: favourites, the rest, then the archive. */
export function CalendarSections({
  calendars,
  archived,
  isVisible,
  eventCounts,
  readOnly,
  canArchive,
  busy,
  onToggle,
  onShowAll,
  onCreate,
  onRename,
  onRecolor,
  onToggleFavorite,
  onToggleArchived,
  onPurge,
  onDelete,
}: Props) {
  const menu = useContextMenu();
  const menuAt = useRef({ x: 0, y: 0 });
  const [palette, setPalette] = useState<PaletteState>(null);
  const recoloring = useRef<Calendar | null>(null);
  const closePalette = useCallback(() => setPalette(null), []);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);
  const committing = useRef(false);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const favourites = useMemo(() => sortCalendars(calendars.filter((calendar) => calendar.favorite === true)), [calendars]);
  const others = useMemo(() => sortCalendars(calendars.filter((calendar) => calendar.favorite !== true)), [calendars]);
  const archivedSorted = useMemo(() => sortCalendars(archived), [archived]);
  const anyHidden = calendars.some((calendar) => !isVisible(calendar));

  function startCreate() {
    setRenamingId(null);
    setDraft("");
    setCreating(true);
  }

  function startRename(calendar: Calendar) {
    setCreating(false);
    setRenamingId(calendar.id);
    setDraft(calendar.name);
  }

  function reset() {
    setCreating(false);
    setRenamingId(null);
    setDraft("");
  }

  async function commit(target: Calendar | null) {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (committing.current) return;
    const name = draft.trim();
    reset();
    if (!name || (target && name === target.name)) return;
    committing.current = true;
    try {
      if (target) await onRename(target, name);
      else await onCreate(name);
    } finally {
      committing.current = false;
    }
  }

  function itemsFor(calendar: Calendar): MenuItem[] {
    if (readOnly) return [];
    const isArchived = calendar.archived === true;
    const count = eventCounts.get(calendar.id) ?? 0;
    const items: MenuItem[] = [
      { label: "Rename calendar", onSelect: () => startRename(calendar) },
      {
        label: "Change colour",
        onSelect: () => {
          recoloring.current = calendar;
          setPalette({ ...menuAt.current, current: calendar.color });
        },
      },
    ];
    if (isArchived) {
      items.push({ label: "Restore calendar", onSelect: () => onToggleArchived(calendar) });
    } else {
      items.push(
        {
          label: calendar.favorite ? "Remove from favourites" : "Add to favourites",
          onSelect: () => onToggleFavorite(calendar),
        },
        {
          label: "Archive calendar",
          disabled: !canArchive,
          disabledReason: "Your only calendar in use cannot be archived",
          onSelect: () => onToggleArchived(calendar),
        },
      );
    }
    items.push({
      label: "Purge events",
      danger: true,
      disabled: count === 0,
      disabledReason: "This calendar has no events",
      onSelect: () => onPurge(calendar),
    });
    if (calendar.id !== DEFAULT_CALENDAR_ID) {
      items.push({ label: "Delete calendar", danger: true, onSelect: () => onDelete(calendar) });
    }
    return items;
  }

  function openMenu(event: ReactMouseEvent, calendar: Calendar, anchor: HTMLElement) {
    const box = anchor.getBoundingClientRect();
    menuAt.current =
      event.clientX === 0 && event.clientY === 0
        ? { x: box.left, y: box.bottom }
        : { x: event.clientX, y: event.clientY };
    menu.open(event, itemsFor(calendar));
  }

  function nameInput(label: string, target: Calendar | null) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void commit(target);
        }}
        autoComplete="off"
        className="-mx-2 px-2 py-1"
      >
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit(target)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              cancelled.current = true;
              reset();
            }
          }}
          placeholder="Calendar name"
          disabled={busy}
          aria-label={label}
          className={sidebarNameInput}
        />
      </form>
    );
  }

  function row(calendar: Calendar) {
    if (renamingId === calendar.id) {
      return <li key={calendar.id}>{nameInput(`Rename ${calendar.name}`, calendar)}</li>;
    }
    const shown = isVisible(calendar);
    const isArchived = calendar.archived === true;
    return (
      <li key={calendar.id}>
        <div
          onContextMenu={(event) => openMenu(event, calendar, event.currentTarget)}
          className="list-row group -mx-2 flex items-center rounded-lg pr-2 transition-colors hover:bg-surface/40"
        >
          <button
            type="button"
            onClick={() => onToggle(calendar.id)}
            aria-pressed={shown}
            title={`${shown ? "Hide" : "Show"} ${calendar.name}`}
            className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${focusRing}`}
          >
            <span className={sidebarMark}><CalendarSwatch color={calendar.color} hidden={!shown} /></span>
            <span className={`min-w-0 flex-1 truncate font-medium transition-colors ${shown ? "text-text" : "text-mute"}`}>{calendar.name}</span>
          </button>
          <span className={`relative flex h-7 shrink-0 items-center justify-end ${readOnly ? "w-4" : "list-row-slot"}`}>
            <span className={`list-row-rest absolute inset-0 flex items-center justify-end ${sidebarCount}`}>
              {eventCounts.get(calendar.id) || ""}
            </span>
            {readOnly ? null : (
              <span className="list-row-actions absolute inset-0 flex items-center justify-end gap-0.5">
                {isArchived ? (
                  <button type="button" onClick={() => onToggleArchived(calendar)} title="Restore calendar" aria-label={`Restore ${calendar.name} calendar`} className={`${sidebarRowAction} text-accent`}><Icon name="unarchive" className="h-3.5 w-3.5" /></button>
                ) : (
                  <>
                    <button type="button" onClick={() => onToggleFavorite(calendar)} aria-pressed={calendar.favorite === true} title={`${calendar.favorite ? "Unfavourite" : "Favourite"} calendar`} aria-label={`${calendar.favorite ? "Remove" : "Add"} ${calendar.name} ${calendar.favorite ? "from" : "to"} favourites`} className={`${sidebarRowAction} ${calendar.favorite ? "text-accent" : "hover:text-text"}`}><Icon name="star" className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => onToggleArchived(calendar)} disabled={!canArchive} title={canArchive ? "Archive calendar" : "Your only calendar in use cannot be archived"} aria-label={`Archive ${calendar.name} calendar`} className={`${sidebarRowAction} hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-mute`}><Icon name="archive" className="h-3.5 w-3.5" /></button>
                  </>
                )}
                <button type="button" onClick={(event) => openMenu(event, calendar, event.currentTarget)} title="More actions" aria-label={`More actions for ${calendar.name}`} className={`${sidebarRowAction} hover:text-text`}><Icon name="more" className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </span>
        </div>
      </li>
    );
  }

  // Trims the next section's top margin so the band has equal space either side.
  const archivedGroup = archivedSorted.length === 0 ? null : (
    <div className={`${sidebarSubgroup} -mb-3.5`}>
      <button type="button" onClick={() => setArchivedOpen((open) => !open)} aria-expanded={archivedOpen} className={`${sidebarRow} ${sidebarRowState(false)} ${focusRing}`}>
        <span className={sidebarMark}><Icon name="chevron" className={`h-3 w-3 transition-transform ${archivedOpen ? "rotate-90" : ""}`} /></span>
        <span className="min-w-0 flex-1 truncate font-medium">Archived calendars</span>
        <span className={`shrink-0 ${sidebarCount}`}>{archivedSorted.length}</span>
      </button>
      {archivedOpen ? <ul className="mt-0.5 space-y-0.5">{archivedSorted.map(row)}</ul> : null}
    </div>
  );

  let empty: ReactNode = null;
  if (calendars.length === 0 && !creating) {
    empty = readOnly
      ? <p className="mt-3 text-xs text-mute">{archived.length === 0 ? "No calendars yet." : "Every calendar is archived."}</p>
      : archived.length === 0
        ? <button type="button" onClick={startCreate} className={`mt-3 w-full rounded-lg border border-dashed border-line px-3 py-3 text-xs text-mute transition-colors hover:border-line-light hover:text-text ${focusRing}`}>Create your first calendar</button>
        : <p className="mt-3 text-xs text-mute">Every calendar is archived. Restore one below to use it again.</p>;
  } else if (others.length === 0 && !creating) {
    empty = <p className="mt-3 text-xs text-mute">Every calendar in use is a favourite.</p>;
  }

  return (
    <>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      {readOnly ? null : (
        <ColourPalette
          state={palette}
          label="Calendar colour"
          onPick={(hex) => {
            const target = recoloring.current;
            if (target) void onRecolor(target, hex);
          }}
          onClose={closePalette}
        />
      )}
      {favourites.length > 0 ? (
        <SidebarSection label="Favourites">
          <ul className="mt-2.5 space-y-0.5">{favourites.map(row)}</ul>
        </SidebarSection>
      ) : null}
      <SidebarSection
        label="Calendars"
        action={readOnly ? null : <button type="button" onClick={startCreate} className={sidebarSectionAction} aria-label="Add calendar"><Icon name="plus" className="h-3.5 w-3.5" /></button>}
      >
        {empty}
        {others.length > 0 ? <ul className="mt-2.5 space-y-0.5">{others.map(row)}</ul> : null}
        {creating && !readOnly ? <div className="mt-0.5">{nameInput("New calendar name", null)}</div> : null}
        {anyHidden ? <button type="button" onClick={onShowAll} className={`-ml-2 mt-2.5 rounded-md px-2 py-1 text-2xs text-mute transition-colors hover:text-accent ${focusRing}`}>Show all calendars</button> : null}
        {archivedGroup}
      </SidebarSection>
    </>
  );
}
