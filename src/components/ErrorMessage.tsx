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
