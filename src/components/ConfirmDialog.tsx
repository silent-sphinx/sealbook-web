import type { ReactNode } from "react";
import { dangerButton, primary, secondary } from "../lib/styles";
import { Modal } from "./Modal";
import { ErrorMessage } from "./ErrorMessage";

type Props = {
  title: string;
  heading: string;
  body: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  busy?: boolean;
  error?: string | null;
  /** Passed through to `Modal`, for a confirm raised from a full-screen view. */
  elevated?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Themed replacement for `window.confirm`. The native prompt dropped OS chrome
 * into the middle of the app, could not be styled to show what was at stake,
 * and blocked the event loop while it was open.
 */
export function ConfirmDialog({
  title,
  heading,
  body,
  confirmLabel,
  busyLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  error,
  elevated = false,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose} elevated={elevated}>
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${
              tone === "danger"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-accent/30 bg-accent/10 text-accent"
            }`}
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-text">{heading}</h3>
            <div className="mt-1.5 text-sm leading-relaxed text-mute">{body}</div>
          </div>
        </div>

        {error ? (
          <ErrorMessage size="xs" className="mt-4">{error}</ErrorMessage>
        ) : null}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            className={`${secondary} flex-1 cursor-pointer`}
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`${tone === "danger" ? dangerButton : primary} flex flex-1 cursor-pointer items-center justify-center gap-2`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-bg/30 border-t-bg" />
                <span>{busyLabel ?? confirmLabel}</span>
              </>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
