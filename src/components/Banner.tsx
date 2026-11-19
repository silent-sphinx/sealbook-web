import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Tone = "neutral" | "warning" | "danger";

const TONE: Record<Tone, { box: string; icon: IconName | null }> = {
  neutral: { box: "border-line bg-surface/60 text-mute", icon: null },
  warning: { box: "border-warning/25 bg-warning-soft text-warning", icon: "warning" },
  danger: { box: "border-danger/25 bg-danger-soft text-danger", icon: "alert" },
};

/**
 * A full-width strip across the top of a view or the shell: a state the user
 * should know about while they carry on working, such as being offline or an
 * error loading a pane. Left-aligned in the shell's gutter, so it reads as part
 * of the page rather than a centred notice floating above it.
 *
 * The glyph is decoration; the words carry the meaning, which is why a banner's
 * text is passed through untouched and nothing is added to it.
 */
export function Banner({
  tone = "neutral",
  role,
  icon,
  actions,
  children,
  className = "",
}: {
  tone?: Tone;
  role?: "status" | "alert";
  /** Overrides the tone's glyph; `null` draws none. */
  icon?: IconName | null;
  /** Controls at the trailing edge, such as Undo. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const style = TONE[tone];
  const glyph = icon === undefined ? style.icon : icon;
  return (
    <div
      role={role}
      className={`flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-(--sb-gutter) py-1.5 text-xs font-medium ${style.box} ${className}`}
    >
      {glyph ? <Icon name={glyph} className="size-3.5 shrink-0" /> : null}
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}
