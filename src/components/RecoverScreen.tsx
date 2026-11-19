import { type FormEvent } from "react";
import { AuthCard, Brand } from "./AuthLayout";
import { PasswordField } from "./PasswordField";
import { Icon } from "./Icon";
import { authField, authLabel, authPrimary, btnSecondarySm, ghost } from "../lib/styles";
import { extractRecoveryWords } from "../lib/phrase";
import { findInvalidBip39Words } from "../lib/bip39Words";
import { ErrorMessage } from "./ErrorMessage";

interface RecoverScreenProps {
  connectionDomain: string;
  saveDomain: (value: string) => boolean;
  error: string | null;
  username: string;
  phrase: string;
  password: string;
  busy: boolean;
  onUsernameChange: (value: string) => void;
  onPhraseChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onBack: () => void;
}

export function RecoverScreen({
  connectionDomain,
  saveDomain,
  error,
  username,
  phrase,
  password,
  busy,
  onUsernameChange,
  onPhraseChange,
  onPasswordChange,
  onSubmit,
  onBack,
}: RecoverScreenProps) {
  const enteredWords = extractRecoveryWords(phrase);
  const count = enteredWords.length;
  const invalidWords = findInvalidBip39Words(enteredWords);

  async function handlePastePhrase() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        const words = extractRecoveryWords(text);
        if (words.length > 0) {
          onPhraseChange(words.join(" "));
        } else {
          onPhraseChange(text.trim());
        }
      }
    } catch {
      // clipboard access not permitted
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === "string" && content.trim()) {
        const words = extractRecoveryWords(content);
        if (words.length > 0) {
          onPhraseChange(words.join(" "));
        }
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <AuthCard
      connectionDomain={connectionDomain}
      onConnectionDomainSave={saveDomain}
      domainError={error}
    >
      <Brand
        eyebrow="Recovery"
        title="Restore with words"
        subtitle="Set up this device using your 24 secret recovery words."
      />
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="recover-username" className={authLabel}>
            Username
          </label>
          <input
            id="recover-username"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            autoComplete="username"
            placeholder="Enter your username"
            className={authField}
            autoFocus
            spellCheck={false}
            required
          />
        </div>

        <div>
          <label htmlFor="recovery-phrase" className={`${authLabel} mb-1.5`}>
            Recovery words
          </label>
          <div className="box-border w-full overflow-hidden rounded-xl border border-line-light/70 bg-surface/70 shadow-[inset_0_1px_0_rgb(255_255_255/0.03)] transition-all hover:border-line-light focus-within:border-accent-dim focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent-ring">
            <textarea
              id="recovery-phrase"
              value={phrase}
              onChange={(e) => onPhraseChange(e.target.value)}
              onPaste={(e) => {
                const pastedText = e.clipboardData.getData("text");
                if (pastedText) {
                  const words = extractRecoveryWords(pastedText);
                  if (
                    words.length === 24 ||
                    pastedText.includes("\n") ||
                    /(?:^|\s)\d+[-.:)]/.test(pastedText)
                  ) {
                    e.preventDefault();
                    onPhraseChange(words.join(" "));
                  }
                }
              }}
              placeholder="Paste or type all 24 words separated by spaces…"
              rows={4}
              // These words open the vault, so keep them away from spellcheck
              // services, keyboard dictionaries and writing-assistant extensions.
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              data-gramm="false"
              data-gramm_editor="false"
              data-enable-grammarly="false"
              className="box-border block w-full bg-transparent px-3.5 py-2.5 font-mono text-sm leading-relaxed text-text outline-none placeholder:text-mute/50 resize-none"
              required
            />
            <div className="flex gap-0.5 px-3 pb-2" aria-hidden="true">
              {Array.from({ length: 24 }, (_, index) => (
                <span
                  key={index}
                  className={`h-1 flex-1 rounded-full transition-colors duration-200 ${index < count
                    ? invalidWords.length > 0 || count > 24
                      ? "bg-danger"
                      : "bg-accent"
                    : "bg-surface"
                    }`}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-y-2 border-t border-line-light/50 bg-bg/40 px-3 py-2">
              <span
                aria-live="polite"
                className={`inline-flex min-w-0 items-center gap-1.5 font-mono text-xs whitespace-nowrap ${invalidWords.length > 0
                    ? "text-danger font-medium"
                    : count === 24
                      ? "text-accent font-semibold"
                      : count > 24
                        ? "text-danger font-medium"
                        : "text-mute"
                  }`}
              >
                {invalidWords.length > 0 ? (
                  <span>
                    {count} / 24 words · <span className="underline">"{invalidWords[0]}"</span> invalid
                  </span>
                ) : (
                  <>
                    {count === 24 ? (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                    ) : null}
                    {count} / 24 words
                  </>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePastePhrase}
                  className={btnSecondarySm}
                >
                  <Icon name="copy" />
                  <span>Paste</span>
                </button>
                <label className={`${btnSecondarySm} focus-within:ring-2 focus-within:ring-accent-ring focus-within:ring-offset-2 focus-within:ring-offset-bg`}>
                  <Icon name="upload" />
                  <span>Upload file</span>
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    className="sr-only"
                    onChange={handleFileUpload}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="recover-password" className={authLabel}>
            New password
          </label>
          {/* Recovery sets a new password rather than asking for the old one. */}
          <p className="mt-1 text-xs text-mute">
            Your recovery words set a new password. The old one stops working.
          </p>
          <PasswordField
            id="recover-password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            autoComplete="new-password"
            placeholder="At least 12 characters"
            className={authField}
            required
          />
        </div>

        {error ? <ErrorMessage>{error}</ErrorMessage> : null}

        <button
          type="submit"
          disabled={busy}
          className={`${authPrimary} mt-7`}
        >
          {busy ? "Restoring vault…" : "Restore vault on this device"}
        </button>

        <button
          type="button"
          className={`${ghost} mx-auto mt-3 flex items-center justify-center gap-1.5 py-2`}
          onClick={onBack}
        >
          <Icon name="back" className="h-3.5 w-3.5" />
          Back to setup options
        </button>
      </form>
    </AuthCard>
  );
}
