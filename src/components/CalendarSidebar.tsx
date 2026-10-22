import { useMemo, useState } from "react";
import type { Calendar } from "../lib/types";
import { focusRing } from "../lib/styles";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";

function Icon({ name, className = "h-4 w-4" }: { name: "chevron" | "pencil" | "star" | "archive" | "unarchive"; className?: string }) {
  const content = {
    chevron: <path d="m6.5 3.5 5 5-5 5" />,
    pencil: <><path d="m10.75 2.75 2.5 2.5M3 13l1.5-3.75 6.25-6.25a1.77 1.77 0 0 1 2.5 2.5L7 11.75 3 13Z" /></>,
    star: <path d="m8 1.75 1.9 3.85 4.25.62-3.08 3 .73 4.23L8 11.45l-3.8 2 .73-4.23-3.08-3 4.25-.62L8 1.75Z" fill="currentColor" />,
    archive: <><path d="M2 3.5h12v3H2z" /><path d="M3.5 6.5v6h9v-6" /><path d="M6.5 9h3" /></>,
    unarchive: <><path d="M2 3.5h12v3H2z" /><path d="M3.5 6.5v6h9v-6" /><path d="M8 11.5V8m-1.5 1.5L8 8l1.5 1.5" /></>,
  }[name];
  return <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{content}</svg>;
}

function isLegibleOnDark(hex: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return true;
  const value = Number.parseInt(match[1], 16);
  const channel = (raw: number) => {
    const scaled = raw / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255);
  return luminance > 0.18;
}

function CalendarSwatch({ color, hidden }: { color: string; hidden: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors duration-150"
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

type CalendarListProps = {
  calendars: Calendar[];
  archived: Calendar[];
  isVisible: (calendar: Calendar) => boolean;
  readOnly: boolean;
  canArchive: boolean;
  onToggle: (calendarId: string) => void;
  onShowAll: () => void;
  onToggleFavorite: (calendar: Calendar) => void;
  onToggleArchived: (calendar: Calendar) => void;
  onEdit: (calendar: Calendar) => void;
  onCreate: () => void;
};

export function CalendarList({ calendars, archived, isVisible, readOnly, canArchive, onToggle, onShowAll, onToggleFavorite, onToggleArchived, onEdit, onCreate }: CalendarListProps) {
  const menu = useContextMenu();

  function itemsFor(calendar: Calendar, isArchived: boolean): MenuItem[] {
    if (readOnly) return [];
    if (isArchived) {
      return [
        { label: "Restore calendar", onSelect: () => onToggleArchived(calendar) },
        { label: "Edit calendar", onSelect: () => onEdit(calendar) },
      ];
    }
    return [
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
      { label: "Edit calendar", onSelect: () => onEdit(calendar) },
    ];
  }

  const [archivedOpen, setArchivedOpen] = useState(false);
  const ordered = useMemo(
    () => [...calendars].sort((a, b) => Number(b.favorite === true) - Number(a.favorite === true)),
    [calendars],
  );
  const anyHidden = calendars.some((calendar) => !isVisible(calendar));

  const archivedGroup = archived.length === 0 ? null : (
    <div className="mt-3 border-t border-line pt-2">
      <button type="button" onClick={() => setArchivedOpen((open) => !open)} aria-expanded={archivedOpen} className={`-ml-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute transition-colors hover:text-text ${focusRing}`}>
        <Icon name="chevron" className={`h-3 w-3 transition-transform ${archivedOpen ? "rotate-90" : ""}`} />
        Archived ({archived.length})
      </button>
      {archivedOpen ? (
        <div className="mt-1 space-y-0.5">
          {archived.map((calendar) => {
            const shown = isVisible(calendar);
            return (
              <div key={calendar.id} className="group -mx-2 flex items-center rounded-lg pr-2 transition-colors hover:bg-surface/40" onContextMenu={(event) => menu.open(event, itemsFor(calendar, true))}>
                <button type="button" onClick={() => onToggle(calendar.id)} aria-pressed={shown} title={`${shown ? "Hide" : "Show"} ${calendar.name}`} className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${focusRing}`}>
                  <CalendarSwatch color={calendar.color} hidden={!shown} />
                  <span className={`min-w-0 flex-1 truncate font-medium transition-colors ${shown ? "text-text" : "text-mute"}`}>{calendar.name}</span>
                </button>
                {readOnly ? null : (
                  <>
                    <button type="button" onClick={() => onToggleArchived(calendar)} title="Restore calendar" aria-label={`Restore ${calendar.name} calendar`} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-accent transition-colors hover:bg-elevated ${focusRing}`}><Icon name="unarchive" className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => onEdit(calendar)} title="Edit calendar" aria-label={`Edit ${calendar.name} calendar`} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated hover:text-text ${focusRing}`}><Icon name="pencil" className="h-3.5 w-3.5" /></button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );

  if (calendars.length === 0) {
    return (
      <>
        {readOnly
          ? <p className="mt-3 text-xs text-mute">{archived.length === 0 ? "No calendars yet." : "Every calendar is archived."}</p>
          : archived.length === 0
            ? <button type="button" onClick={onCreate} className={`mt-3 w-full rounded-lg border border-dashed border-line px-3 py-3 text-xs text-mute transition-colors hover:border-line-light hover:text-text ${focusRing}`}>Create your first calendar</button>
            : <p className="mt-3 text-xs text-mute">Every calendar is archived. Restore one below to use it again.</p>}
        {archivedGroup}
      </>
    );
  }

  return (
    <>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      <div className="mt-2.5 space-y-0.5">
        {ordered.map((calendar) => {
          const hidden = !isVisible(calendar);
          return (
            <div key={calendar.id} className="list-row group -mx-2 flex items-center rounded-lg pr-2 transition-colors hover:bg-surface/40" onContextMenu={(event) => menu.open(event, itemsFor(calendar, false))}>
              <button type="button" onClick={() => onToggle(calendar.id)} aria-pressed={!hidden} title={`${hidden ? "Show" : "Hide"} ${calendar.name}`} className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs transition-colors ${focusRing}`}>
                <CalendarSwatch color={calendar.color} hidden={hidden} />
                <span className={`min-w-0 flex-1 truncate font-medium transition-colors ${hidden ? "text-mute" : "text-text"}`}>{calendar.name}</span>
              </button>
              <span className={`relative flex h-7 shrink-0 items-center justify-end ${readOnly ? "w-4" : "list-row-slot"}`}>
                <span className="list-row-rest absolute inset-0 flex items-center justify-end pr-1">{calendar.favorite ? <Icon name="star" className="h-3 w-3 text-accent" /> : null}</span>
                {readOnly ? null : (
                  <span className="list-row-actions absolute inset-0 flex items-center justify-end gap-0.5">
                    <button type="button" onClick={() => onToggleFavorite(calendar)} aria-pressed={calendar.favorite === true} title={`${calendar.favorite ? "Unfavourite" : "Favourite"} calendar`} aria-label={`${calendar.favorite ? "Remove" : "Add"} ${calendar.name} ${calendar.favorite ? "from" : "to"} favourites`} className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-elevated ${calendar.favorite ? "text-accent" : "text-mute hover:text-text"} ${focusRing}`}><Icon name="star" className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => onToggleArchived(calendar)} disabled={!canArchive} title={canArchive ? "Archive calendar" : "Your only calendar in use cannot be archived"} aria-label={`Archive ${calendar.name} calendar`} className={`flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-mute ${focusRing}`}><Icon name="archive" className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => onEdit(calendar)} title="Edit calendar" aria-label={`Edit ${calendar.name} calendar`} className={`flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-elevated hover:text-text ${focusRing}`}><Icon name="pencil" className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {anyHidden ? <button type="button" onClick={onShowAll} className={`-ml-2 mt-2.5 rounded-md px-2 py-1 text-[11px] text-mute transition-colors hover:text-accent ${focusRing}`}>Show all calendars</button> : null}
      {archivedGroup}
    </>
  );
}
