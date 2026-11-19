import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { iconBtnXs } from "../lib/styles";
import { Icon } from "./Icon";

const REGION_ID = "sb-toast-region";

/**
 * The one place toasts stack. It is a node of its own on `document.body` rather
 * than something `App` renders, because `UpdatePrompt` is mounted beside the app
 * and still has to share a corner with the app's own notices. Created on first
 * use; looking it up by id first keeps a second render from making another.
 */
function toastRegion(): HTMLElement {
  const found = document.getElementById(REGION_ID);
  if (found) return found;
  const region = document.createElement("div");
  region.id = REGION_ID;
  region.className = "toast-region";
  document.body.appendChild(region);
  return region;
}

/**
 * A message that appears over the work and waits to be dealt with: an update, a
 * notice, a warning that the vault is about to lock. Placement is the region's
 * job (see `.toast-region` in index.css), so toasts stack without knowing about
 * each other, and clear the phone tab bar without asking where it is.
 */
export function Toast({
  title,
  children,
  actions,
  onDismiss,
  live = "status",
}: {
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  /** How it announces itself. `false` for a toast that carries its own live region. */
  live?: "status" | "alert" | false;
}) {
  return createPortal(
    <div
      role={live || undefined}
      className="pointer-events-auto flex animate-slide-up items-start gap-3 rounded-xl border border-line-light bg-elevated px-3.5 py-3 text-sm shadow-toast"
    >
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium text-text">{title}</p> : null}
        {children ? (
          <div className={title ? "mt-1 text-xs text-mute" : "text-xs leading-relaxed text-text"}>
            {children}
          </div>
        ) : null}
        {actions ? <div className="mt-3 flex justify-end gap-2">{actions}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss"
          className={`${iconBtnXs} -mr-1.5 -mt-0.5`}
          onClick={onDismiss}
        >
          <Icon name="close" className="size-3.5" />
        </button>
      ) : null}
    </div>,
    toastRegion(),
  );
}
