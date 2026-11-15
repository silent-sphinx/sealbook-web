import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import { Modal } from "./Modal";
import { PAIR_CODE_WORDS, pairCodeWords } from "../lib/pairing";
import { btnPrimary, btnSecondary } from "../lib/styles";
import { ErrorMessage } from "./ErrorMessage";
import { QrScanner, canScan } from "./QrScanner";

const WORD_COUNT = PAIR_CODE_WORDS;
const QR_PREFIX = "SEALBOOK-PAIR:";

/**
 * Where an approval has got to: the code is being entered, this device has
 * answered and waits for the new device's reply, or the reply opened and the
 * user is asked to agree.
 */
export type AddDeviceStage = "code" | "waiting" | "approve";

type Props = {
  busy: boolean;
  error: string | null;
  addCode: string;
  stage: AddDeviceStage;
  /** What the new device says it is, once its reply has opened. */
  description: string;
  onCodeChange: (code: string) => void;
  /** A code read from a QR, as words, to answer straight away. */
  onScanned: (code: string) => void;
  onSubmit: (event: FormEvent) => void;
  onBackToCode: () => void;
  onClose: () => void;
};

/** The words a scanned pairing QR holds, as the boxes show them. */
function wordsFromScan(text: string): string {
  const body = text.toUpperCase().startsWith(QR_PREFIX) ? text.slice(QR_PREFIX.length) : text;
  return pairCodeWords(body.toLowerCase()).join(" ");
}

export function AddDeviceModal({
  busy,
  error,
  addCode,
  stage,
  description,
  onCodeChange,
  onScanned,
  onSubmit,
  onBackToCode,
  onClose,
}: Props) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const codeLabelId = useId();
  const [scanning, setScanning] = useState(false);

  const rawWords = addCode.split(" ");
  const words = Array.from({ length: WORD_COUNT }, (_, i) => rawWords[i] ?? "");

  function commitWords(next: string[]) {
    onCodeChange(next.join(" ").trimEnd());
  }

  function focusBox(index: number) {
    requestAnimationFrame(() => {
      const el = inputRefs.current[index];
      if (el) { el.focus(); el.select(); }
    });
  }

  function handleChange(index: number, value: string) {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      const next = [...words];
      for (let i = 0; i < parts.length && index + i < WORD_COUNT; i++) {
        next[index + i] = parts[i];
      }
      commitWords(next);
      focusBox(Math.min(index + parts.length - 1, WORD_COUNT - 1));
    } else {
      const next = [...words];
      next[index] = value;
      commitWords(next);
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (index < WORD_COUNT - 1) focusBox(index + 1);
    } else if (e.key === "Backspace" && words[index] === "" && index > 0) {
      e.preventDefault();
      focusBox(index - 1);
    } else if (e.key === "ArrowRight" && (e.currentTarget.selectionStart ?? 0) === words[index].length) {
      e.preventDefault();
      if (index < WORD_COUNT - 1) focusBox(index + 1);
    } else if (e.key === "ArrowLeft" && (e.currentTarget.selectionStart ?? 0) === 0) {
      e.preventDefault();
      if (index > 0) focusBox(index - 1);
    }
  }

  function handleBoxPaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const parts = e.clipboardData.getData("text").trim().split(/\s+/).filter(Boolean);
    const next = [...words];
    for (let i = 0; i < parts.length && index + i < WORD_COUNT; i++) {
      next[index + i] = parts[i];
    }
    commitWords(next);
    focusBox(Math.min(index + parts.length - 1, WORD_COUNT - 1));
  }

  async function handleClipboardPaste() {
    try {
      const text = await navigator.clipboard.readText();
      const parts = text.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return;
      const next = Array.from({ length: WORD_COUNT }, (_, i) => parts[i] ?? "");
      commitWords(next);
      focusBox(Math.min(parts.length - 1, WORD_COUNT - 1));
    } catch {
      // clipboard not available; user can paste directly into a box
    }
  }

  const allFilled = words.every((w) => w.trim().length > 0);

  return (
    <Modal
      title={stage === "approve" ? "Approve device" : "Add a new device"}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="p-6 sm:p-7">
        {stage === "code" && scanning ? (
          <QrScanner
            onScan={(text) => {
              setScanning(false);
              onScanned(wordsFromScan(text));
            }}
            onCancel={() => setScanning(false)}
          />
        ) : stage === "code" ? (
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
                  Scan the code it shows, or type its eight words below.
                </p>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <span id={codeLabelId} className="text-sm font-medium text-text">Pairing code</span>
                <span className="flex items-center gap-2">
                {canScan() ? (
                  <button
                    type="button"
                    onClick={() => setScanning(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-accent hover:border-line-light hover:text-accent-dim transition-colors cursor-pointer"
                  >
                    Scan QR code
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleClipboardPaste}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-accent hover:border-line-light hover:text-accent-dim transition-colors cursor-pointer"
                >
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.378 6H4.5Z" />
                    <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
                  </svg>
                  Paste from clipboard
                </button>
                </span>
              </div>
              <div role="group" aria-labelledby={codeLabelId} className="grid grid-cols-4 gap-2">
                {words.map((word, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium text-mute/60 text-center select-none">{i + 1}</span>
                    <input
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="text"
                      aria-label={`Word ${i + 1}`}
                      value={word}
                      onChange={(e) => handleChange(i, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(i, e)}
                      onPaste={(e) => handleBoxPaste(i, e)}
                      autoFocus={i === 0}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      className="box-border w-full rounded-lg border border-line bg-bg px-2.5 py-2 font-mono text-sm text-text text-center outline-none transition-all duration-150 focus:border-accent-dim focus:ring-1 focus:ring-accent-ring"
                    />
                  </div>
                ))}
              </div>
            </div>

            {error ? <ErrorMessage className="mt-4">{error}</ErrorMessage> : null}

            <div className="mt-8 flex items-center justify-end gap-3 border-t border-line pt-4">
              <button
                type="button"
                className={btnSecondary}
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !allFilled}
                className={btnPrimary}
              >
                {busy ? "Connecting…" : "Connect →"}
              </button>
            </div>
          </div>
        ) : stage === "waiting" ? (
          <div>
            <div
              role="status"
              className="flex items-center justify-center gap-3 rounded-xl border border-line-light/60 bg-surface/40 py-6 text-sm text-mute"
            >
              <span className="flex items-center gap-1" aria-hidden="true">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="h-1.5 w-1.5 animate-dot-bounce rounded-full bg-accent"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </span>
              <span>Waiting for the new device…</span>
            </div>

            {error ? <ErrorMessage className="mt-4 text-left">{error}</ErrorMessage> : null}

            <div className="mt-8 flex items-center justify-end gap-3 border-t border-line pt-4">
              <button type="button" className={btnSecondary} onClick={onBackToCode}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-mute leading-relaxed">
              The new device matched the code. It says it is:
            </p>
            <p className="my-5 rounded-xl border border-line bg-surface/40 px-4 py-3 text-center text-base font-semibold text-text">
              {description || "A device that did not say what it is"}
            </p>
            <p className="text-xs text-mute leading-relaxed">
              Approving gives it your vault's encryption keys. Only approve if you are holding this
              device and started the pairing yourself.
            </p>

            {error ? <ErrorMessage className="mt-4 text-left">{error}</ErrorMessage> : null}

            <div className="mt-8 flex items-center justify-end gap-3 border-t border-line pt-4">
              <button
                type="button"
                className={btnSecondary}
                onClick={onBackToCode}
                disabled={busy}
              >
                Don't approve
              </button>
              <button type="submit" disabled={busy} className={btnPrimary}>
                {busy ? "Approving…" : "Approve device"}
              </button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
