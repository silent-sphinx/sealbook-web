import { AuthCard, Brand } from "./AuthLayout";
import { authPrimary, authSecondary } from "../lib/styles";
import { formatRecoveryWordsFile } from "../lib/phrase";
import { Icon } from "./Icon";

interface PhraseScreenProps {
  phrase: string;
  connectionDomain: string;
  saveDomain: (value: string) => boolean;
  error: string | null;
  onDone: () => void;
}

export function PhraseScreen({
  phrase,
  connectionDomain,
  saveDomain,
  error,
  onDone,
}: PhraseScreenProps) {
  const words = phrase.split(/\s+/u).filter(Boolean);

  function downloadWords() {
    const text = formatRecoveryWordsFile(words);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sealbook-recovery-words.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function printWords() {
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) return;
    const doc = win.document;
    doc.title = "Sealbook Recovery Words";
    doc.body.style.cssText =
      "font-family:system-ui,sans-serif;padding:40px;max-width:480px;margin:0 auto";

    const heading = doc.createElement("h2");
    heading.style.margin = "0 0 4px";
    heading.textContent = "Sealbook Recovery Words";

    const note = doc.createElement("p");
    note.style.cssText = "color:#666;margin:0 0 24px;font-size:14px";
    note.textContent = "Keep this document safe and secret.";

    const table = doc.createElement("table");
    table.style.cssText = "border-collapse:collapse;font-size:15px";
    words.forEach((word, index) => {
      const row = table.insertRow();
      const numCell = row.insertCell();
      numCell.style.cssText =
        "text-align:right;padding-right:12px;color:#888;font-variant-numeric:tabular-nums";
      numCell.textContent = String(index + 1);
      const wordCell = row.insertCell();
      wordCell.style.fontFamily = "monospace";
      wordCell.textContent = word;
    });

    doc.body.append(heading, note, table);
    win.focus();
    win.print();
  }

  return (
    <AuthCard
      connectionDomain={connectionDomain}
      onConnectionDomainSave={saveDomain}
      domainError={error}
    >
      <Brand
        eyebrow="Recovery words"
        title="Write these down"
        subtitle="They are shown once. You will need them on a new browser."
      />
      <div className="mt-6 flex gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-xs leading-relaxed text-warning">
        <Icon name="shield" className="mt-px h-4 w-4 shrink-0" />
        <span>
          Anyone with these words can open your vault, and nobody can recover them for you.
          Keep them somewhere safe and offline.
        </span>
      </div>
      <ol className="mt-5 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {words.map((word, index) => (
          <li
            key={`${index}-${word}`}
            className="flex animate-fade-in-up items-center gap-2 rounded-lg border border-line-light/60 bg-surface/50 px-2.5 py-1.5 font-mono"
            style={{ animationDelay: `${index * 25}ms` }}
          >
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-mute">{index + 1}</span>
            <span className="min-w-0 truncate text-text">{word}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex gap-3">
        <button type="button" className={authSecondary} onClick={downloadWords}>
          <Icon name="download" />
          Download
        </button>
        <button type="button" className={authSecondary} onClick={printWords}>
          <Icon name="print" />
          Print
        </button>
      </div>
      <button
        type="button"
        className={`${authPrimary} mt-4`}
        onClick={onDone}
      >
        I've written them down
      </button>
    </AuthCard>
  );
}
