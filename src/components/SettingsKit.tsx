import { useRef, useState, type DragEvent, type ReactNode } from "react";

import {
  eyebrow,
  field,
  fieldLabel,
  focusRing,
  selectField,
  linkAction,
} from "../lib/styles";
import type { SettingsPage } from "../lib/settingsModel";
import { Icon, type IconName } from "./Icon";

export { Callout, NoticeLine, type Notice } from "./ErrorMessage";
export { Switch } from "./FieldControls";

export type DeviceMark = "device-web" | "device-firefox" | "device-android" | "device-cli";

const MARK_ICONS: Record<SettingsPage | "upload" | "menu" | DeviceMark, IconName> = {
  username: "user",
  password: "key",
  devices: "device",
  recovery: "shield",
  data: "database",
  signout: "signOut",
  delete: "trash",
  features: "toggle",
  appearance: "palette",
  lock: "lock",
  contacts: "user",
  calendar: "calendar",
  notes: "page",
  bookmarks: "bookmark",
  tasks: "tasks",
  upload: "upload",
  menu: "menu",
  "device-web": "globe",
  "device-firefox": "puzzle",
  "device-android": "smartphone",
  "device-cli": "terminal",
};

export function SettingsMark({
  name,
  className = "h-4 w-4",
}: {
  name: keyof typeof MARK_ICONS;
  className?: string;
}) {
  return <Icon name={MARK_ICONS[name]} className={className} />;
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
        {meta ? <span className="shrink-0 font-mono text-2xs text-mute">{meta}</span> : null}
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
          <div className="mt-0.5 text-2xs leading-relaxed text-mute">{description}</div>
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
          <span className="mt-0.5 block text-2xs leading-relaxed text-mute">{description}</span>
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
        <span className="mt-0.5 block text-2xs leading-relaxed text-mute">{hint}</span>
      </span>
      <span className="hidden shrink-0 font-mono text-2xs text-mute sm:block">{formats}</span>
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
          <p className="mt-0.5 text-2xs text-mute">{summary}</p>
        </div>
        <button type="button" disabled={busy} onClick={onChangeFile} className={`${linkAction} shrink-0`}>
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
          <button type="button" disabled={disabled} onClick={onToggle} className={linkAction}>
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
      <p className={eyebrow}>
        Preview · first {rows.length} of {total}
      </p>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-bg/60 text-xs">
        {rows.map((row, index) => (
          <li key={index} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-medium text-text">{row.primary}</span>
            {row.secondary ? (
              <span className="min-w-0 truncate font-mono text-2xs text-mute">{row.secondary}</span>
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
      <div className="flex justify-between text-2xs text-mute">
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
