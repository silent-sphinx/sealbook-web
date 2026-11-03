import type { ReactNode } from "react";

import { focusRing } from "../lib/styles";

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
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

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
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface disabled:opacity-50 ${
        active ? "text-accent" : "text-mute"
      } ${danger ? "hover:text-danger" : "hover:text-text"} ${focusRing}`}
    >
      {children}
    </button>
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
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-mute/70">
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
  badge,
  trailingMeta,
  subtitle,
  note,
  action,
}: {
  leading?: ReactNode;
  title: ReactNode;
  inlineMeta?: string;
  badge?: string;
  trailingMeta?: string;
  subtitle?: ReactNode;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3 border-b border-line/60 px-5 py-3 text-sm">
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="min-w-0 truncate font-medium text-text">{title}</span>
            {inlineMeta ? <span className="text-xs text-mute">{inlineMeta}</span> : null}
            {badge ? (
              <span className="self-center rounded-full border border-accent-dim/40 bg-accent/10 px-2 text-[10px] font-medium uppercase leading-[18px] tracking-wider text-accent">
                {badge}
              </span>
            ) : null}
          </div>
          {trailingMeta ? (
            <span className="shrink-0 text-[11px] uppercase tracking-wider text-mute/80">
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
  like: "border-note-new/30 bg-note-new/10 text-note-new",
  dislike: "border-danger/30 bg-danger/10 text-danger",
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
