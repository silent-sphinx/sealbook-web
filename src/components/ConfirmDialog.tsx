import type { ReactNode } from "react";
import { btnDanger, btnPrimary, btnSecondary } from "../lib/styles";
import { Modal, ModalBody, ModalFooter } from "./Modal";
import { Icon } from "./Icon";
import { ErrorMessage } from "./ErrorMessage";

type Props = {
  /** The dialog's name: what a screen reader announces and the header shows. */
  title: string;
  /** The question itself, set as the lead line of the body. */
  heading: string;
  body: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  /**
   * Required rather than defaulted: a dialog that is red when it should not be
   * teaches people to ignore red. `danger` is for what deletes or revokes.
   */
  tone: "danger" | "default";
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
  tone,
  busy = false,
  error,
  elevated = false,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Modal title={title} size="sm" onClose={busy ? () => {} : onClose} elevated={elevated}>
      <ModalBody>
        <p className="flex items-start gap-2 text-sm font-medium text-text">
          {tone === "danger" ? (
            <Icon name="warning" className="mt-0.5 size-4 shrink-0 text-danger" />
          ) : null}
          <span>{heading}</span>
        </p>
        <div className="mt-1.5 text-sm leading-relaxed text-mute">{body}</div>
        {error ? (
          <ErrorMessage size="xs" className="mt-4">{error}</ErrorMessage>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={tone === "danger" ? btnDanger : btnPrimary}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? (
            <>
              <span
                aria-hidden="true"
                className="size-3.5 animate-spin rounded-full border-2 border-bg/30 border-t-bg"
              />
              <span>{busyLabel ?? confirmLabel}</span>
            </>
          ) : (
            <span>{confirmLabel}</span>
          )}
        </button>
      </ModalFooter>
    </Modal>
  );
}
