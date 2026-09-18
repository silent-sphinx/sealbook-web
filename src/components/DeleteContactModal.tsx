import { dangerButton, secondary } from "../lib/styles";
import type { Contact } from "../lib/types";
import { Modal } from "./Modal";

type Props = {
  contact: Contact;
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

export function DeleteContactModal({
  contact,
  busy,
  error,
  onConfirm,
  onClose,
}: Props) {
  return (
    <Modal title="Delete contact" onClose={busy ? () => {} : onClose}>
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-danger/30 bg-danger/10 text-danger">
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-text">
              Delete &ldquo;{contact.name}&rdquo;?
            </h3>
            <p className="mt-1.5 text-sm text-mute leading-relaxed">
              This contact will be permanently deleted from your encrypted vault across all paired devices. This action cannot be undone.
            </p>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            className={`${secondary} flex-1 cursor-pointer`}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${dangerButton} flex-1 flex items-center justify-center gap-2 cursor-pointer`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-bg/30 border-t-bg" />
                <span>Deleting…</span>
              </>
            ) : (
              <span>Delete contact</span>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
