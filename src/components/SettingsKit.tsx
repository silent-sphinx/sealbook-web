import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { fieldLabel, focusRing, selectField, field, textAction } from "../lib/styles";
import type { SettingsPage } from "../lib/settingsModel";

export type Notice = { type: "success" | "error" | "warning"; text: string } | null;

export type DeviceMark = "device-web" | "device-firefox" | "device-android" | "device-cli";

const MARK_PATHS: Record<SettingsPage | "upload" | "menu" | DeviceMark, string> = {
  username: "M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8Zm-5 5.5a5 5 0 0 1 10 0",
  password: "M10 9.5a3.5 3.5 0 1 0-3.4-2.7L2.5 10.9v2.6h2.6v-1.5h1.5v-1.5h1.3l.4-.4c.5.3 1.1.4 1.7.4Zm1-5h.01",
  devices: "M2.5 3.5h8v6h-8zM1.5 12.5h10M12.5 6h2v7.5h-2z",
  recovery: "M8 2 3 4v3.5c0 3 2.1 5.6 5 6.5 2.9-.9 5-3.5 5-6.5V4L8 2Zm-2 6 1.5 1.5L10.5 6.5",
  data: "M2.5 4.5h11M3.5 4.5v8h9v-8M2.5 2.5h11v2h-11zM6.5 7.5h3",
  signout: "M6.5 13.5h-3v-11h3M10.5 11l3-3-3-3M13.5 8h-7",
  delete: "M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8",
  features: "M5.5 4.5h5a3.5 3.5 0 0 1 0 7h-5a3.5 3.5 0 0 1 0-7Zm0 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  appearance: "M8 13.5a5.5 5.5 0 1 1 5.5-5.5c0 1.5-1.2 2.25-2.5 2.25H9.75a1.25 1.25 0 0 0-.9 2.1A.75.75 0 0 1 8 13.5ZM5 8h.01M6.5 5h.01M9.5 5h.01M11 8h.01",
  contacts: "M6 7.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM2 13a4 4 0 0 1 8 0M10.5 3.25a2.25 2.25 0 0 1 0 4.25M12 9.5a4 4 0 0 1 2 3.5",
  calendar: "M3 3.5h10v9.5H3zM3 6.5h10M5.5 2v2.5M10.5 2v2.5",
  notes: "M4 2.5h5.5l2.5 2.5v8.5H4zM9.5 2.5V5H12M6 8h4M6 10.5h4",
  bookmarks: "M4.5 2.5h7v11L8 10.75 4.5 13.5v-11Z",
  tasks: "m2.75 4.5 1.25 1.25 2.25-2.5M2.75 10.5l1.25 1.25 2.25-2.5M8.75 4.75h4.5M8.75 10.75h4.5",
  upload: "M8 10.5v-8M5 5.5l3-3 3 3M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2",
  menu: "M2.5 4h11M2.5 8h11M2.5 12h11",
  "device-web": "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2.5 8h11M8 2.5c1.5 1.6 2.25 3.4 2.25 5.5S9.5 11.9 8 13.5M8 2.5C6.5 4.1 5.75 5.9 5.75 8S6.5 11.9 8 13.5",
  "device-firefox": "M3 5.5h2.25a1.5 1.5 0 1 1 3 0h2.25v2.25a1.5 1.5 0 1 1 0 3V13H3z",
  "device-android": "M5 1.75h6v12.5H5zM7.25 12h1.5",
  "device-cli": "M2.5 3h11v10h-11zM5 6.25 6.75 8 5 9.75M8.25 10h2.75",
};

export function SettingsMark({
  name,
  className = "h-4 w-4",
}: {
  name: keyof typeof MARK_PATHS;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={MARK_PATHS[name]} />
    </svg>
  );
}

/** A titled block of a settings page, divided from the one before it by a hairline. */
export function SettingsGroup({
  title,
  meta,
  description,
  tone,
  children,
}: {
  title: string;
  meta?: ReactNode;
  description?: ReactNode;
  tone?: "danger";
  children?: ReactNode;
}) {
  return (
    <section className="border-t border-line py-7 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={`text-sm font-semibold ${tone === "danger" ? "text-danger" : "text-text"}`}>
          {title}
        </h2>
        {meta ? <span className="shrink-0 font-mono text-[11px] text-mute">{meta}</span> : null}
      </div>
      {description ? (
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-mute">{description}</p>
      ) : null}
      {children ? <div className="mt-4 space-y-4">{children}</div> : null}
    </section>
  );
}

/** The bordered list a group's rows sit in. */
export function SettingsList({
  children,
  role,
  label,
}: {
  children: ReactNode;
  role?: "radiogroup";
  label?: string;
}) {
  return (
    <div
      role={role}
      aria-label={label}
      className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel/40"
    >
      {children}
    </div>
  );
}

/** A label and description on the left, its control on the right. */
export function SettingsRow({
  label,
  description,
  lead,
  control,
}: {
  label: ReactNode;
  description?: ReactNode;
  lead?: ReactNode;
  control?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {lead ?? null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[11px] leading-relaxed text-mute">{description}</div>
        ) : null}
      </div>
      {control ?? null}
    </div>
  );
}

/** A row of a `SettingsList` that is itself one choice of a radio group. */
export function SettingsOption({
  checked,
  disabled,
  onSelect,
  lead,
  label,
  description,
}: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  lead?: ReactNode;
  label: string;
  description?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${
        checked ? "bg-surface" : "hover:bg-surface/40"
      }`}
    >
      {lead ?? null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-text">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-mute">{description}</span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
          checked ? "border-accent bg-accent" : "border-line-light"
        }`}
      >
        {checked ? <span className="h-1.5 w-1.5 rounded-full bg-bg" /> : null}
      </span>
    </button>
  );
}

export function Switch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing} ${
        checked ? "border-accent bg-accent" : "border-line-light bg-surface"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-3.5 w-3.5 rounded-full transition-transform duration-150 ${
          checked ? "translate-x-[17px] bg-bg" : "translate-x-[2px] bg-mute"
        }`}
      />
    </button>
  );
}

const NOTICE_TONE = {
  success: "border-line bg-surface/60 text-mute",
  warning: "border-accent/30 bg-accent/10 text-accent",
  error: "border-danger/30 bg-danger/10 text-danger",
} as const;

/** The outcome of an action. Errors are alerts; anything else is a status. */
export function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      role={notice.type === "error" ? "alert" : "status"}
      className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${NOTICE_TONE[notice.type]}`}
    >
      {notice.text}
    </p>
  );
}

/** A standing caution, as opposed to the outcome of an action. */
export function Callout({ tone, children }: { tone: "danger" | "warning"; children: ReactNode }) {
  return (
    <div className={`rounded-lg border px-3.5 py-3 text-xs leading-relaxed ${NOTICE_TONE[tone === "danger" ? "error" : "warning"]}`}>
      {children}
    </div>
  );
}

/**
 * Picks one file by click, keyboard or drop. The input is `display: none`, so
 * the zone carries the button semantics and the keyboard activation itself.
 */
export function FileDrop({
  label,
  accept,
  formats,
  hint,
  inputLabel,
  onFile,
}: {
  label: string;
  accept: string;
  formats: string;
  hint: string;
  inputLabel?: string;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [active, setActive] = useState(false);

  function onDrag(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setActive(event.type === "dragenter" || event.type === "dragover");
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onDragEnter={onDrag}
      onDragLeave={onDrag}
      onDragOver={onDrag}
      onDrop={(event) => {
        onDrag(event);
        setActive(false);
        const file = event.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      onClick={() => input.current?.click()}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        input.current?.click();
      }}
      className={`flex cursor-pointer items-center gap-3.5 rounded-xl border border-dashed px-4 py-4 transition-colors ${focusRing} ${
        active ? "border-accent bg-accent/10" : "border-line-light hover:bg-surface/40"
      }`}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        aria-label={inputLabel}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
        className="hidden"
      />
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-mute">
        <SettingsMark name="upload" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-text">Choose a file or drop it here</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-mute">{hint}</span>
      </span>
      <span className="hidden shrink-0 font-mono text-[11px] text-mute sm:block">{formats}</span>
    </div>
  );
}

/** The picked file and what was read from it, ahead of the controls to import it. */
export function ImportReview({
  fileName,
  summary,
  busy,
  onChangeFile,
  children,
}: {
  fileName: string;
  summary: ReactNode;
  busy: boolean;
  onChangeFile: () => void;
  children: ReactNode;
}) {
  return (
    <div className="animate-fade-in overflow-hidden rounded-xl border border-line bg-panel/40">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-text">{fileName}</p>
          <p className="mt-0.5 text-[11px] text-mute">{summary}</p>
        </div>
        <button type="button" disabled={busy} onClick={onChangeFile} className={`${textAction} shrink-0`}>
          Change file
        </button>
      </div>
      <div className="space-y-4 px-4 py-4">{children}</div>
    </div>
  );
}

/**
 * Where an import lands: an existing container, or a new one named here. The
 * name field takes over once there is nothing to pick from.
 */
export function TargetPicker({
  id,
  label,
  noun,
  creating,
  canCreate,
  onToggle,
  disabled,
  name,
  onName,
  placeholder,
  value,
  onValue,
  options,
}: {
  id: string;
  label: string;
  noun: string;
  creating: boolean;
  canCreate: boolean;
  onToggle: () => void;
  disabled: boolean;
  name: string;
  onName: (name: string) => void;
  placeholder: string;
  value: string;
  onValue: (value: string) => void;
  options: { id: string; name: string }[];
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className={fieldLabel}>
          {label}
        </label>
        {canCreate && options.length > 0 ? (
          <button type="button" disabled={disabled} onClick={onToggle} className={textAction}>
            {creating ? `Use an existing ${noun}` : `New ${noun}`}
          </button>
        ) : null}
      </div>
      {creating ? (
        <input
          id={id}
          type="text"
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder={placeholder}
          className={field}
          disabled={disabled}
          autoFocus
        />
      ) : (
        <select
          id={id}
          value={value}
          onChange={(event) => onValue(event.target.value)}
          disabled={disabled}
          className={`${selectField} mt-1.5`}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** The first few parsed entries, so the file can be recognised before it is written. */
export function ImportPreview({
  rows,
  total,
}: {
  rows: { primary: string; secondary?: string }[];
  total: number;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
        Preview · first {rows.length} of {total}
      </p>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-bg/60 text-xs">
        {rows.map((row, index) => (
          <li key={index} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-medium text-text">{row.primary}</span>
            {row.secondary ? (
              <span className="min-w-0 truncate font-mono text-[11px] text-mute">{row.secondary}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImportProgress({
  label,
  progress,
}: {
  label: string;
  progress: { current: number; total: number } | null;
}) {
  if (!progress) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[11px] text-mute">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-text">
          {progress.current} / {progress.total}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div
          className="h-full bg-accent transition-all duration-150"
          style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

/** Trailing buttons of a form or review. */
export const actionRow = "flex flex-wrap items-center justify-end gap-2";
