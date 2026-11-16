import { AuthCard, Brand } from "./AuthLayout";
import { authPrimary, authSecondary } from "../lib/styles";
import { formatRecoveryWordsFile } from "../lib/phrase";
import { printRecoveryWords } from "../lib/printPhrase";
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
    printRecoveryWords(words, "Keep this document safe and secret.");
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
      <p className="mt-2 text-[11px] leading-relaxed text-mute">
        The download is a plain text file in your Downloads folder, which may be synced or
        indexed. Delete it once the words are somewhere safe.
      </p>
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
