import { useState, type ReactNode, type Ref } from "react";

import { fieldBase, focusRing, ghost, sectionBar, sidebarSectionAction } from "../lib/styles";
import { CHIP_TONE, type ChipTone } from "./PaneControls";
import { PartialDateInput } from "./PartialDateInput";

export const labelClass = "block min-w-0 text-sm text-mute";

export function FormSection({
  title,
  first,
  onAdd,
  addLabel,
  addDisabled,
  addDisabledReason,
  onRemoveSection,
  actions,
  className,
  ref,
  children,
}: {
  title: string;
  first?: boolean;
  onAdd?: () => void;
  /** Singular noun for the add button's accessible name, e.g. "Email". */
  addLabel?: string;
  addDisabled?: boolean;
  addDisabledReason?: string;
  onRemoveSection?: () => void;
  /** Extra header buttons, placed beside Add. */
  actions?: ReactNode;
  className?: string;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
}) {
  const hasBody = children !== undefined && children !== null && children !== false;
  return (
    <section
      ref={ref}
      className={`min-w-0 ${first ? "" : "mt-5 border-t border-line pt-4"} ${className ?? ""}`.trim()}
    >
      <div className="flex min-h-7 min-w-0 items-center justify-between gap-3">
        <h3 className={`text-[11px] font-semibold uppercase tracking-[0.14em] text-mute ${sectionBar}`}>
          {title}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              disabled={addDisabled}
              aria-label={`Add ${(addLabel ?? title).toLowerCase()}`}
              title={addDisabled ? addDisabledReason : undefined}
              className={`${ghost} inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-mute`}
            >
              <AddIcon />
              Add
            </button>
          ) : null}
          {onRemoveSection ? (
            <button
              type="button"
              onClick={onRemoveSection}
              aria-label="Remove section"
              title="Remove section"
              className={`${sidebarSectionAction} hover:text-danger`}
            >
              <TrashIcon />
            </button>
          ) : null}
        </div>
      </div>
      {hasBody ? <div className="mt-3 min-w-0">{children}</div> : null}
    </section>
  );
}

export function RemoveButton({
  label,
  onClick,
  compact,
}: {
  label: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={`flex ${compact ? "h-7 w-7 rounded-md" : "h-10 w-10 rounded-lg"} shrink-0 cursor-pointer items-center justify-center text-mute transition-all duration-150 hover:bg-surface hover:text-danger ${focusRing}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <CloseIcon className="h-4 w-4" />
    </button>
  );
}

/** One labelled value: a kind control, the value, and a remove button. */
export function ValueRow({
  kind,
  removeLabel,
  onRemove,
  children,
}: {
  kind: ReactNode;
  removeLabel: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)_2.5rem] items-start gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)_2.5rem]">
      <div className="min-w-0">{kind}</div>
      <div className="grid min-w-0 gap-2">{children}</div>
      <RemoveButton label={removeLabel} onClick={onRemove} />
    </div>
  );
}

/** A multi-field record in the form, boxed so its fields read as one entry. */
export function EntryCard({
  removeLabel,
  onRemove,
  label,
  children,
}: {
  removeLabel: string;
  onRemove: () => void;
  label?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={label ? "group" : undefined}
      aria-label={label}
      className="flex min-w-0 items-start gap-2 rounded-xl border border-line/60 bg-surface/40 p-2.5"
    >
      <div className="grid min-w-0 flex-1 gap-2">{children}</div>
      <RemoveButton compact label={removeLabel} onClick={onRemove} />
    </div>
  );
}

/** A list of entries or value rows with consistent spacing. */
export function EntryList({ children }: { children: ReactNode }) {
  return <div className="grid min-w-0 gap-2">{children}</div>;
}

/** Two fields side by side from `sm` up. */
export function FieldPair({ children }: { children: ReactNode }) {
  return <div className="grid min-w-0 gap-2 sm:grid-cols-2">{children}</div>;
}

export type DateRangeValue = { start?: string; end?: string; current?: boolean };

/**
 * A start and finish date with a current flag. A current entry has no finish
 * date, so ticking the box hides the field and clears it.
 */
export function DateRange({
  start,
  end,
  current,
  startLabel = "Date started",
  endLabel = "Date finished",
  currentLabel = "Current",
  onChange,
}: DateRangeValue & {
  startLabel?: string;
  endLabel?: string;
  currentLabel?: string;
  onChange: (range: DateRangeValue) => void;
}) {
  return (
    <div className="@container min-w-0">
      <div className="grid min-w-0 gap-2 @lg:grid-cols-2">
        <PartialDateInput
          label={startLabel}
          value={start ?? ""}
          onChange={(next) => onChange({ start: next || undefined, end, current })}
        />
        {current ? null : (
          <PartialDateInput
            label={endLabel}
            value={end ?? ""}
            onChange={(next) => onChange({ start, end: next || undefined, current })}
          />
        )}
      </div>
      <label
        className={`mt-2 inline-flex h-7 cursor-pointer select-none items-center gap-2 rounded-md border px-2 text-xs font-medium transition-colors ${
          current ? "border-accent-dim/60 bg-accent/10 text-text" : "border-line/60 text-mute hover:text-text"
        }`}
      >
        <input
          type="checkbox"
          checked={current ?? false}
          onChange={(e) =>
            onChange({
              start,
              end: e.target.checked ? undefined : end,
              current: e.target.checked || undefined,
            })
          }
          className="h-3.5 w-3.5 accent-[var(--color-accent)]"
        />
        {currentLabel}
      </label>
    </div>
  );
}

/**
 * A text field with its label as a pill inside the field on the left, so the
 * field reads without a caption row above it.
 */
export function PillInput({
  label,
  value,
  placeholder,
  ariaLabel,
  listId,
  type,
  autoFocus,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  listId?: string;
  type?: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex h-10 min-w-0 items-center rounded-lg border border-line bg-bg transition-colors focus-within:border-accent-dim focus-within:ring-1 focus-within:ring-accent-ring">
      <span className="ml-1.5 shrink-0 rounded-md bg-surface px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-mute/80">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? label}
        list={listId}
        autoFocus={autoFocus}
        className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm text-text outline-none placeholder:text-mute/70"
      />
    </div>
  );
}

/**
 * A type-and-Enter tag field: entries sit as removable chips in front of a
 * text input that commits on Enter, comma or blur.
 */
export function TagsInput({
  values,
  tone = "neutral",
  label,
  removeLabel,
  placeholder,
  disabled,
  disabledPlaceholder,
  onAdd,
  onRemove,
}: {
  values: { id: string; value: string }[];
  tone?: ChipTone;
  label: string;
  /** Prefix for each chip's remove button, e.g. "Remove interest". */
  removeLabel: string;
  placeholder: string;
  disabled?: boolean;
  disabledPlaceholder?: string;
  onAdd: (value: string) => void;
  onRemove: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const value = draft.trim();
    setDraft("");
    if (!value || disabled) return;
    onAdd(value);
  }

  return (
    <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-bg px-2 py-1.5 transition-colors duration-150 focus-within:border-accent-dim focus-within:ring-1 focus-within:ring-accent-ring">
      {values.map((row) => (
        <span
          key={row.id}
          className={`inline-flex items-center gap-1 rounded-md border py-0.5 pl-2 pr-0.5 text-xs ${CHIP_TONE[tone]}`}
        >
          {row.value}
          <button
            type="button"
            aria-label={`${removeLabel}: ${row.value}`}
            onClick={() => onRemove(row.id)}
            className={`flex h-4 w-4 items-center justify-center rounded-full text-mute transition-colors hover:bg-danger/20 hover:text-danger ${focusRing}`}
          >
            <CloseIcon className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            onRemove(values[values.length - 1]!.id);
          }
        }}
        onBlur={commit}
        placeholder={disabled ? disabledPlaceholder : placeholder}
        disabled={disabled}
        aria-label={label}
        className="h-6 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-text outline-none placeholder:text-mute/70 disabled:placeholder:text-mute/50"
      />
    </div>
  );
}

/**
 * A free-text block whose counter appears only as it fills: a counter on an
 * empty box reads as a target.
 */
export function ProseField({
  value,
  placeholder,
  max,
  rows = 3,
  ariaLabel,
  hint,
  onChange,
}: {
  value: string;
  placeholder: string;
  max: number;
  rows?: number;
  ariaLabel?: string;
  /** Shown left of the counter once the text is over `max`. */
  hint?: string;
  onChange: (value: string) => void;
}) {
  const over = value.length > max;
  return (
    <div className="grid gap-1.5">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={rows}
        className={`${fieldBase} h-auto min-h-[5.5rem] resize-y py-2.5 leading-relaxed`}
      />
      {value.length > max * 0.8 ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px]">
          {over && hint ? <span className="text-mute">{hint}</span> : <span />}
          <span className={over ? "text-danger" : "text-mute"}>
            {value.length.toLocaleString()} / {max.toLocaleString()}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function AddIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 4a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 10 4Z" />
    </svg>
  );
}

export function CloseIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
