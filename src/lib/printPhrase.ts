/**
 * Prints recovery words from a frame the page owns.
 *
 * `window.open` with `noopener` or `noreferrer` always returns null, so a print
 * built on it never ran, and a user who pressed Print for the words that guard
 * their vault got nothing. The frame is off screen rather than `display: none`,
 * which some browsers will not print from, and goes once the dialog closes.
 */
export function printRecoveryWords(words: string[], note: string): boolean {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:480px;height:640px;border:0;visibility:hidden";
  document.body.append(frame);

  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  if (!win || !doc) {
    frame.remove();
    return false;
  }

  doc.title = "Sealbook Recovery Words";
  doc.body.style.cssText = "font-family:system-ui,sans-serif;padding:40px;max-width:480px;margin:0 auto";

  const heading = doc.createElement("h2");
  heading.style.margin = "0 0 4px";
  heading.textContent = "Sealbook Recovery Words";

  const noteLine = doc.createElement("p");
  noteLine.style.cssText = "color:#666;margin:0 0 24px;font-size:14px";
  noteLine.textContent = note;

  const table = doc.createElement("table");
  table.style.cssText = "border-collapse:collapse;font-size:15px";
  words.forEach((word, index) => {
    const row = table.insertRow();
    const number = row.insertCell();
    number.style.cssText =
      "text-align:right;padding-right:12px;color:#888;font-variant-numeric:tabular-nums";
    number.textContent = String(index + 1);
    const value = row.insertCell();
    value.style.fontFamily = "monospace";
    value.textContent = word;
  });
  doc.body.append(heading, noteLine, table);

  // The words should not outlive the dialog in the page, whichever way it ends.
  const cleanup = () => frame.remove();
  win.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(cleanup, 5 * 60 * 1000);

  win.focus();
  win.print();
  return true;
}
