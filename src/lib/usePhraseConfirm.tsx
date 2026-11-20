import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PhraseConfirmDialog } from "../components/PhraseConfirmDialog";
import type { PhraseConfirm } from "./clientRotation";

/** Raised into the rotation when the user closes the phrase dialog. */
export class RotationAbandoned extends Error {
  constructor() {
    super("The key change was cancelled before anything was sent.");
    this.name = "RotationAbandoned";
  }
}

/**
 * A `PhraseConfirm` backed by `PhraseConfirmDialog`, and the element to render
 * it in. Unmounting while the dialog is open abandons the rotation too, so a
 * navigation away cannot leave a rotation waiting on a dialog nobody can see.
 */
export function usePhraseConfirm(): { confirm: PhraseConfirm; dialog: ReactNode } {
  const [pending, setPending] = useState<{ phrase: string } | null>(null);
  const settle = useRef<{ resolve: () => void; reject: (err: Error) => void } | null>(null);

  useEffect(
    () => () => {
      settle.current?.reject(new RotationAbandoned());
      settle.current = null;
    },
    [],
  );

  const confirm = useCallback<PhraseConfirm>(
    (phrase) =>
      new Promise<void>((resolve, reject) => {
        settle.current = { resolve, reject };
        setPending({ phrase });
      }),
    [],
  );

  function finish(outcome: "confirmed" | "abandoned") {
    const current = settle.current;
    settle.current = null;
    setPending(null);
    if (outcome === "confirmed") current?.resolve();
    else current?.reject(new RotationAbandoned());
  }

  const dialog = pending ? (
    <PhraseConfirmDialog
      phrase={pending.phrase}
      onConfirmed={() => finish("confirmed")}
      onAbandon={() => finish("abandoned")}
    />
  ) : null;
  return { confirm, dialog };
}
