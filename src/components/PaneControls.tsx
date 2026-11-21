import { useRef, type ReactNode } from "react";

import {
  btnDangerGhostSm,
  btnGhostSm,
  bulkBar,
  bulkPrimary,
  checkbox,
  eyebrow,
  focusRing,
  iconBtn,
  iconBtnActive,
  iconBtnDanger,
  iconBtnXs,
  paneCount,
  paneHeader,
  paneTitle,
  segment,
  segmented,
} from "../lib/styles";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { Icon, type IconName } from "./Icon";
import { PickerMenu, type PickerOption } from "./PickerMenu";
import { SidebarToggle, type Sidebar } from "./SidebarDrawer";

/** A detail pane's section: a sticky band heading over full-bleed rows. */
export function PaneSection({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`min-w-0 ${className ?? ""}`.trim()}>
      <div className="sticky top-0 z-10 flex min-h-8 items-center justify-between gap-3 border-b border-line/60 bg-surface/80 px-5 py-1.5 backdrop-blur-sm">
        <h4 className={eyebrow}>{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * An icon-only control for a header or toolbar. The name goes on both
 * `aria-label` and `title`, since there is no text to fall back on.
 */
export function IconButton({
  label,
  icon,
  onClick,
  disabled,
  tone = "default",
  active = false,
  size = "sm",
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
  /** For a toggle that is on. */
  active?: boolean;
  /** `xs` is for an action inside a row. */
  size?: "sm" | "xs";
}) {
  const style =
    size === "xs" ? iconBtnXs : tone === "danger" ? iconBtnDanger : active ? iconBtnActive : iconBtn;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={style}
    >
      <Icon name={icon} className={size === "xs" ? "size-3.5" : "size-4"} />
    </button>
  );
}

/** `IconButton` for a glyph that is not in the shared set, passed as children. */
export function HeaderButton({
  label,
  onClick,
  disabled,
  danger,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={danger ? iconBtnDanger : active ? iconBtnActive : iconBtn}
    >
      {children}
    </button>
  );
}

/**
 * The bar above a view's list: sidebar toggle, title and count on the left,
 * the view's controls on the right. The heading and the count share one parent,
 * which the bookmark count's `title` is read through.
 */
export function PaneHeader({
  title,
  count,
  countLabel,
  compactTitle = false,
  titleClassName = "",
  sidebar,
  children,
  className = "",
}: {
  title: string;
  count?: number;
  /** The count's tooltip, for a count that needs a unit ("3 bookmarks"). */
  countLabel?: string;
  /** Visually hidden on a phone, where the controls need the room. */
  compactTitle?: boolean;
  /** Appended to the heading, for a page that colours it. */
  titleClassName?: string;
  sidebar?: Sidebar;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`${paneHeader} ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        {sidebar ? <SidebarToggle sidebar={sidebar} /> : null}
        <div className={`flex min-w-0 items-center ${compactTitle ? "max-sm:sr-only" : ""}`}>
          <h1 className={`${paneTitle} ${titleClassName}`}>{title}</h1>
          {count !== undefined ? (
            <span className={paneCount} title={countLabel}>
              {count}
            </span>
          ) : null}
        </div>
      </div>
      {children ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">{children}</div>
      ) : null}
    </header>
  );
}

/**
 * One choice from a few, always visible. The arrow keys move the choice, as they
 * do in any radio group, and only the chosen option is in the tab order.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "",
}: {
  label: string;
  options: { value: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const group = useRef<HTMLDivElement | null>(null);

  function move(from: number, step: number) {
    const next = options[(from + step + options.length) % options.length]!;
    onChange(next.value);
    group.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[options.indexOf(next)]?.focus();
  }

  return (
    <div ref={group} role="radiogroup" aria-label={label} className={`${segmented} ${className}`}>
      {options.map((option, at) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(at, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(at, -1);
              }
            }}
            className={segment(active)}
          >
            {option.icon ? <Icon name={option.icon} className="size-3.5" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export type BulkMoveSpec = {
  /** The picker's name, such as "Move selected tasks to". */
  label: string;
  /** What the targets are called, singular, such as "notebook". */
  noun: string;
  options: PickerOption[];
  icon?: IconName;
  /** Makes a new target and resolves to its id. Leave it out when the user cannot add one. */
  onCreate?: (name: string) => Promise<string | undefined>;
  onMove: (id: string) => void;
};

/**
 * The strip under a pane's header while items are selected. Every list has the
 * same things here in the same order: a select-all, the count, then "Move to",
 * the pane's own controls, Delete and a "More" menu, and a way out. The lists
 * differ only in what they hand it.
 */
export function BulkBar({
  label,
  noun,
  selected,
  total,
  onToggleAll,
  onClear,
  move,
  onDelete,
  more,
  disabled,
  children,
}: {
  /** The toolbar's name, such as "Bulk edit contacts". */
  label: string;
  /** Plural, for "Select all contacts". */
  noun: string;
  selected: number;
  total: number;
  onToggleAll: () => void;
  onClear: () => void;
  move?: BulkMoveSpec;
  onDelete?: () => void;
  /** Everything else that can be done to the selection; the button is left out when empty. */
  more?: MenuItem[];
  disabled?: boolean;
  /** The pane's own controls, between "Move to" and Delete. */
  children?: ReactNode;
}) {
  const menu = useContextMenu();
  const hasControls = Boolean(move || children || onDelete || (more && more.length > 0));
  return (
    <div role="toolbar" aria-label={label} className={bulkBar}>
      <input
        type="checkbox"
        ref={(node) => {
          if (node) node.indeterminate = selected > 0 && selected < total;
        }}
        checked={total > 0 && selected === total}
        onChange={onToggleAll}
        aria-label={`Select all ${noun}`}
        className={checkbox}
      />
      <span className="grow whitespace-nowrap text-xs font-medium tabular-nums text-text" aria-live="polite">
        {selected} selected
      </span>
      {/* On a narrow pane the controls drop to a line of their own, keeping the count and the close together above. */}
      {hasControls ? (
        <>
          <div className="flex flex-wrap items-center gap-2 max-sm:order-last max-sm:w-full">
            {move ? <BulkMove spec={move} disabled={disabled} /> : null}
            {children}
            {onDelete ? (
              <button type="button" onClick={onDelete} disabled={disabled} className={btnDangerGhostSm}>
                <Icon name="trash" className="size-3.5" />
                Delete
              </button>
            ) : null}
            {more && more.length > 0 ? (
              <button
                type="button"
                onClick={(event) => menu.open(event, more)}
                disabled={disabled}
                aria-haspopup="menu"
                className={btnGhostSm}
              >
                <span>More</span>
                <Icon name="chevron" className="h-3 w-3 rotate-90" />
              </button>
            ) : null}
          </div>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-accent-line max-sm:hidden" />
        </>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        title="Clear selection"
        className={iconBtn}
      >
        <Icon name="close" className="size-3.5" />
      </button>
      <ContextMenu state={menu.menu} onClose={menu.close} />
    </div>
  );
}

/** The "Move to" picker every bulk bar offers, which acts the moment a target is chosen. */
function BulkMove({ spec, disabled }: { spec: BulkMoveSpec; disabled?: boolean }) {
  const { label, noun, options, icon, onCreate, onMove } = spec;
  return (
    <PickerMenu
      title={label}
      searchLabel={`Find a ${noun}`}
      emptyNoun={`${noun}s`}
      options={icon ? options.map((option) => ({ ...option, glyph: <Icon name={icon} className="size-3.5" /> })) : options}
      onPick={onMove}
      create={onCreate ? { label: `New ${noun}`, placeholder: `${noun[0]!.toUpperCase()}${noun.slice(1)} name`, onCreate } : undefined}
      disabled={disabled}
      triggerClassName={bulkPrimary}
      trigger={
        <>
          <span>Move to…</span>
          <Icon name="chevron" className="h-3 w-3 rotate-90" />
        </>
      }
    />
  );
}

export function HeaderDivider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />;
}

const rowBase = "flex min-w-0 items-center gap-3 border-b border-line/60 px-5 py-2.5 text-sm";

/** A single value with a leading icon and its kind as a trailing tag. */
export function FieldRow({
  icon,
  label,
  value,
  href,
  external,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  href?: string;
  external?: boolean;
}) {
  const body = (
    <>
      {icon ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-mute/60 transition-colors group-hover:text-accent">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate font-medium text-text transition-colors group-hover:text-accent">
        {value}
      </span>
      <span className="shrink-0 text-2xs font-medium uppercase tracking-wider text-mute/70">
        {label}
      </span>
    </>
  );
  if (!href) return <div className={rowBase}>{body}</div>;
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={`group ${rowBase} transition-colors hover:bg-surface/40 ${focusRing}`}
    >
      {body}
    </a>
  );
}

/** A multi-field record: title line, optional subtitle lines and a note. */
export function EntryRow({
  leading,
  title,
  inlineMeta,
  trailingMeta,
  subtitle,
  note,
  action,
}: {
  leading?: ReactNode;
  title: ReactNode;
  inlineMeta?: string;
  trailingMeta?: string;
  subtitle?: ReactNode;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 border-b border-line/60 px-5 py-3 text-sm">
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className={`min-w-0 flex-1 ${leading ? "flex min-h-7 flex-col justify-center" : ""}`}>
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="min-w-0 truncate font-medium text-text">{title}</span>
            {inlineMeta ? <span className="text-xs text-mute">{inlineMeta}</span> : null}
          </div>
          {trailingMeta ? (
            <span className="shrink-0 text-2xs uppercase tracking-wider text-mute/80">
              {trailingMeta}
            </span>
          ) : null}
        </div>
        {subtitle ? <div className="mt-0.5 text-xs leading-relaxed text-mute">{subtitle}</div> : null}
        {note ? (
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-mute">{note}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

export type ChipTone = "neutral" | "like" | "dislike";

export const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "border-line bg-bg/50 text-text",
  like: "border-success/30 bg-success-soft text-success",
  dislike: "border-danger/30 bg-danger-soft text-danger",
};

export function ChipList({ groups }: { groups: { tone: ChipTone; values: string[] }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-line/60 px-5 py-3">
      {groups.flatMap(({ tone, values }) =>
        values.map((value, index) => (
          <span
            key={`${tone}-${value}-${index}`}
            className={`rounded-md border px-2.5 py-1 text-xs ${CHIP_TONE[tone]}`}
          >
            {value}
          </span>
        )),
      )}
    </div>
  );
}

export function ProseBlock({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap border-b border-line/60 px-5 py-3 text-sm leading-relaxed text-text">
      {text}
    </p>
  );
}

/** A full-width quiet action row at the foot of a list, such as "Link a contact". */
export function RowAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 border-b border-line/60 px-5 py-2.5 text-xs text-mute transition-colors hover:bg-surface/40 hover:text-accent ${focusRing}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
