import type { ReactNode } from "react";
import { Icon } from "./Icon";

/** An error from a form or dialog action, shown inline above its controls. */
export function ErrorMessage({
  children,
  size = "sm",
  className = "",
}: {
  children: ReactNode;
  size?: "sm" | "xs";
  className?: string;
}) {
  const text = size === "sm" ? "text-sm" : "text-xs";
  const icon = size === "sm" ? "mt-0.5 h-4 w-4" : "mt-px h-3.5 w-3.5";
  return (
    <p
      role="alert"
      className={`flex animate-fade-in items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 leading-snug text-danger ${text} ${className}`}
    >
      <Icon name="alert" className={`shrink-0 ${icon}`} />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

export type Notice = { type: "success" | "error" | "warning"; text: string } | null;

// Every tone carries a glyph as well as a colour: with the Rose and Amber
// accents, danger and warning sit close to the accent, so hue alone would not
// tell a confirmation from a caution.
const NOTICE_TONE = {
  success: { box: "border-line bg-surface/60 text-text", icon: "check", mark: "text-success" },
  warning: { box: "border-warning/30 bg-warning-soft text-warning", icon: "warning", mark: "" },
  error: { box: "border-danger/30 bg-danger-soft text-danger", icon: "alert", mark: "" },
} as const;

/** The outcome of an action. Errors are alerts; anything else is a status. */
export function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const tone = NOTICE_TONE[notice.type];
  return (
    <p
      role={notice.type === "error" ? "alert" : "status"}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${tone.box}`}
    >
      <Icon name={tone.icon} className={`mt-px size-3.5 shrink-0 ${tone.mark}`} />
      <span className="min-w-0">{notice.text}</span>
    </p>
  );
}

/** A standing caution, as opposed to the outcome of an action. */
export function Callout({ tone, children }: { tone: "danger" | "warning"; children: ReactNode }) {
  const style = NOTICE_TONE[tone === "danger" ? "error" : "warning"];
  return (
    <div
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-xs leading-relaxed ${style.box}`}
    >
      <Icon name={style.icon} className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
