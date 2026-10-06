import type { ReactNode, Ref } from "react";

import { sectionBar } from "../lib/styles";

export const labelClass = "block min-w-0 text-sm text-mute";

export function FormSection({
  title,
  first,
  action,
  className,
  ref,
  children,
}: {
  title: string;
  first?: boolean;
  action?: ReactNode;
  className?: string;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <section
      ref={ref}
      className={`${first ? "" : "mt-6 border-t border-line pt-5"} ${className ?? ""}`.trim()}
    >
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3
          className={`text-[11px] font-semibold uppercase tracking-[0.14em] text-mute ${sectionBar}`}
        >
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

export function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-mute transition-all duration-150 hover:bg-surface hover:text-text cursor-pointer"
      aria-label={label}
      onClick={onClick}
    >
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
      </svg>
    </button>
  );
}

export function AddIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 4a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 10 4Z" />
    </svg>
  );
}
