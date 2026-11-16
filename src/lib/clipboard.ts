/**
 * Empties the clipboard, once the tab can.
 *
 * `writeText` rejects while the page is not focused, which is the usual state
 * after a user copies words and switches away to paste them, so a clear that
 * failed is tried again the next time the window is focused. It can do nothing
 * about a clipboard history that already took a copy.
 */
export function clearClipboard(): void {
  void navigator.clipboard.writeText("").catch(() => {
    window.addEventListener(
      "focus",
      () => {
        void navigator.clipboard.writeText("").catch(() => undefined);
      },
      { once: true },
    );
  });
}
