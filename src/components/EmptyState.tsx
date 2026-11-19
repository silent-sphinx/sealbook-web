import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/** The message a list or pane shows in place of content it does not have. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className = "",
}: {
  icon?: IconName;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center px-6 py-10 text-center animate-fade-in-up ${className}`}>
      {icon ? (
        <span className="mb-3 flex size-9 items-center justify-center rounded-xl bg-surface text-mute">
          <Icon name={icon} className="size-4" />
        </span>
      ) : null}
      <p className="text-sm font-medium text-text">{title}</p>
      {body ? <p className="mt-1 max-w-xs text-xs leading-relaxed text-mute">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
