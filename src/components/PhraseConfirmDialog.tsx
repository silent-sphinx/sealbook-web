import { useMemo, useState, type FormEvent } from "react";
import { checkMatches, chooseCheckPositions } from "../lib/phraseCheck";
import { formatRecoveryWordsFile } from "../lib/phrase";
import { printRecoveryWords } from "../lib/printPhrase";
import { btnPrimary, btnSecondary, field, fieldLabel } from "../lib/styles";
import { Icon } from "./Icon";
import { Modal, ModalBody, ModalFooter } from "./Modal";

type Props = {
  phrase: string;
  /** The words are right; the rotation may be sent. */
  onConfirmed: () => void;
  /** Closed without confirming; nothing has been sent and nothing will be. */
  onAbandon: () => void;
};

/**
 * Shows the replacement recovery phrase and asks for three of its words back,
 * before the rotation that installs it is posted.
 *
 * Closing it, by any route, abandons the rotation: the account is left exactly
 * as it was and the phrase shown here is never used.
 */
export function PhraseConfirmDialog({ phrase, onConfirmed, onAbandon }: Props) {
  const words = useMemo(() => phrase.split(/\s+/u).filter(Boolean), [phrase]);
  const positions = useMemo(() => chooseCheckPositions(words.length), [words.length]);
  const [checking, setChecking] = useState(false);
  const [typed, setTyped] = useState<string[]>(() => positions.map(() => ""));
  const [wrong, setWrong] = useState(false);

  function download() {
    const blob = new Blob([formatRecoveryWordsFile(words)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sealbook-new-recovery-words.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (checkMatches(words, positions, typed)) {
      onConfirmed();
      return;
    }
    setWrong(true);
  }

  return (
    <Modal title="Your new recovery words" onClose={onAbandon} size="md" elevated>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <ModalBody>
          {checking ? (
            <div className="space-y-4">
              <p className="text-sm text-mute">
                Type these words from the list you just saved. Nothing has been changed yet; if you
                close this now the old words keep working.
              </p>
              {positions.map((position, i) => (
                <label key={position} className={fieldLabel}>
                  Word {position + 1}
                  <input
                    className={field}
                    value={typed[i]}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) => {
                      setWrong(false);
                      setTyped(typed.map((value, j) => (j === i ? e.target.value : value)));
                    }}
                  />
                </label>
              ))}
              {wrong ? (
                <p role="alert" className="text-xs text-danger">
                  Those words do not match. Check the list and try again.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-mute">
                These replace your old recovery words. Write them down now: they are not shown
                again, and nothing is changed until you have confirmed them.
              </p>
              <ol className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                {words.map((word, index) => (
                  <li
                    key={`${index}-${word}`}
                    className="flex items-center gap-2 rounded-lg border border-line-light/60 bg-surface/50 px-2.5 py-1.5 font-mono"
                  >
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-mute">
                      {index + 1}
                    </span>
                    <span className="min-w-0 truncate text-text">{word}</span>
                  </li>
                ))}
              </ol>
              <div className="flex gap-2">
                <button type="button" className={btnSecondary} onClick={download}>
                  <Icon name="download" />
                  Download
                </button>
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() =>
                    printRecoveryWords(words, "Keep this document safe and secret. Replaces all previous phrases.")
                  }
                >
                  <Icon name="print" />
                  Print
                </button>
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <button type="button" className={btnSecondary} onClick={onAbandon}>
            Cancel
          </button>
          {checking ? (
            <button type="submit" className={btnPrimary} disabled={typed.some((word) => !word.trim())}>
              Confirm and continue
            </button>
          ) : (
            <button type="button" className={btnPrimary} onClick={() => setChecking(true)}>
              I have written them down
            </button>
          )}
        </ModalFooter>
      </form>
    </Modal>
  );
}
