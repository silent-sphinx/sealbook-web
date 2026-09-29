import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { confirmationGroups } from "../lib/pairing";

type Props = {
  busy: boolean;
  error: string | null;
  addCode: string;
  addConfirm: string | null;
  onCodeChange: (code: string) => void;
  onSubmit: (event: FormEvent) => void;
  onBackToCode: () => void;
  onClose: () => void;
};

export function AddDeviceModal({
  busy,
  error,
  addCode,
  addConfirm,
  onCodeChange,
  onSubmit,
  onBackToCode,
  onClose,
}: Props) {
  const [pasteError, setPasteError] = useState<string | null>(null);

  async function handlePaste() {
    try {
      setPasteError(null);
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        onCodeChange(text.trim());
      }
    } catch {
      setPasteError("Couldn't read from clipboard. Please paste manually.");
    }
  }

  return (
    <Modal
      title={addConfirm ? "Verify & approve device" : "Add a new device"}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="p-6 sm:p-7">
        {!addConfirm ? (
          <div>
            <p className="text-sm text-mute leading-relaxed mb-5">
              Authorize a new computer, phone, or tablet to access your encrypted vault without sharing your password.
            </p>

            <div className="rounded-xl border border-line bg-surface/30 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-xs mt-0.5">
                  1
                </span>
                <p className="text-sm text-mute leading-snug">
                  On the new device, select <strong className="text-text font-semibold">Set up device</strong> &rarr; <strong className="text-text font-semibold">Pair with an active device</strong>.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-xs mt-0.5">
                  2
                </span>
                <p className="text-sm text-mute leading-snug">
                  Type the eight-word pairing code displayed there below.
                </p>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="pairing-code-input" className="text-sm font-medium text-text">
                  Pairing code
                </label>
                <button
                  type="button"
                  onClick={handlePaste}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-accent hover:border-line-light hover:text-accent-dim transition-colors cursor-pointer"
                >
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.378 6H4.5Z" />
                    <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
                  </svg>
                  Paste from clipboard
                </button>
              </div>
              <input
                id="pairing-code-input"
                type="text"
                value={addCode}
                onChange={(e) => onCodeChange(e.target.value)}
                placeholder="e.g. river velvet ..."
                className="box-border w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 font-mono text-sm text-text outline-none transition-all duration-150 placeholder:text-mute/50 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
                autoFocus
                required
              />
              {pasteError ? (
                <p className="mt-1.5 text-xs text-danger">{pasteError}</p>
              ) : null}
            </div>

            {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}

            <div className="mt-8 flex items-center justify-end gap-3 border-t border-line pt-4">
              <button
                type="button"
                className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-medium text-mute transition-all duration-150 hover:border-line-light hover:text-text cursor-pointer"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !addCode.trim()}
                className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {busy ? "Checking…" : "Next: Verify code →"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-mute leading-relaxed mb-4">
              Verify that both devices show this exact confirmation code before approving:
            </p>

            <div className="my-6 rounded-2xl border border-accent/25 bg-surface/40 p-6 text-center shadow-lg shadow-accent/5">
              <p className="text-xs uppercase font-medium tracking-widest text-mute mb-2">
                Confirmation code
              </p>
              <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-2xl font-bold tracking-[0.2em] text-accent">
                {confirmationGroups(addConfirm ?? "").map((group, index) => (
                  <span key={`${index}-${group}`}>{group}</span>
                ))}
              </p>
            </div>

            <p className="text-xs text-mute text-center leading-relaxed">
              If the code matches the one displayed on your new device screen, click <strong className="text-text font-semibold">Approve device</strong> below to securely transfer your vault encryption keys.
            </p>

            {error ? <p role="alert" className="mt-4 text-sm text-danger text-center">{error}</p> : null}

            <div className="mt-8 flex items-center justify-end gap-3 border-t border-line pt-4">
              <button
                type="button"
                className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-medium text-mute transition-all duration-150 hover:border-line-light hover:text-text cursor-pointer"
                onClick={onBackToCode}
                disabled={busy}
              >
                Back
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                {busy ? "Approving…" : "Approve device"}
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
