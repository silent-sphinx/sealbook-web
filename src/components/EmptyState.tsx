import type { ReactNode } from "react";

/** The message a list or pane shows in place of content it does not have. */
export function EmptyState({
  title,
  body,
  action,
  className = "",
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center px-6 py-12 text-center animate-fade-in-up sm:py-16 ${className}`}>
      <p className="text-sm font-medium text-text">{title}</p>
      {body ? <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-mute">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
