import { type FormEvent } from "react";
import { AuthCard, Brand, Step } from "./AuthLayout";
import { Icon } from "./Icon";
import { PasswordField } from "./PasswordField";
import { authField, authLabel, authPrimary, btnSecondarySm, ghost } from "../lib/styles";
import { pairCodeWords } from "../lib/pairing";
import { ErrorMessage } from "./ErrorMessage";
import { QrCode } from "./QrCode";

interface PairScreenProps {
  connectionDomain: string;
  saveDomain: (value: string) => boolean;
  error: string | null;
  /** The eight words this device shows. */
  pairCode: string;
  /** The same code, as the QR code holds it. */
  pairQrText: string;
  pairApproved: boolean;
  password: string;
  busy: boolean;
  copied: boolean;
  onPasswordChange: (value: string) => void;
  onCopied: (value: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  onBack: () => void;
  onGoToRecover: () => void;
}

export function PairScreen({
  connectionDomain,
  saveDomain,
  error,
  pairCode,
  pairQrText,
  pairApproved,
  password,
  busy,
  copied,
  onPasswordChange,
  onCopied,
  onSubmit,
  onBack,
  onGoToRecover,
}: PairScreenProps) {
  const pairWords = pairCodeWords(pairCode);

  return (
    <AuthCard
      connectionDomain={connectionDomain}
      onConnectionDomainSave={saveDomain}
      domainError={error}
    >
      <Brand
        eyebrow="New device"
        title="Pair this device"
        subtitle="Connect with an active device to transfer encryption keys."
      />

      <div className="mt-8">
        <Step number={1} title="Open your signed-in device" state="done">
          <p className="text-sm leading-relaxed text-mute">
            On your signed-in device, click <strong className="font-semibold text-text">Add device</strong> at the top.
          </p>
        </Step>

        <Step number={2} title="Enter or scan this code there" state={pairApproved ? "done" : "active"}>
          {pairQrText ? (
            <QrCode
              text={pairQrText}
              label="Pairing code as a QR code"
              className="mb-3 h-40 w-40 p-1.5"
            />
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {pairWords.map((word, index) => (
              <span
                key={`${index}-${word}`}
                className="animate-scale-in select-all rounded-md border border-accent/20 bg-bg/90 px-2.5 py-1 font-mono text-sm text-accent"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {word}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(pairCode);
              onCopied(true);
              setTimeout(() => onCopied(false), 2000);
            }}
            className={`mt-2.5 ${btnSecondarySm}`}
          >
            <Icon name={copied ? "check" : "copy"} />
            {copied ? "Copied" : "Copy code"}
          </button>
        </Step>

        <Step number={3} title="Approve it there" last state={pairApproved ? "done" : "waiting"}>
          <p className="text-sm leading-relaxed text-mute">
            Your other device shows what is joining and asks before adding it. The code only
            works once, so start again here if it was mistyped.
          </p>
        </Step>
      </div>

      {error ? <ErrorMessage className="mt-2">{error}</ErrorMessage> : null}

      {pairApproved ? (
        <form onSubmit={onSubmit} className="mt-6 animate-fade-in-up">
          <div className="flex items-center gap-2.5 rounded-xl border border-success/30 bg-success/10 p-3.5 text-xs text-success">
            <Icon name="check" className="size-4 shrink-0 text-success" />
            <span>Pairing approved! Enter your password to finish unlocking your vault.</span>
          </div>
          <div className="mt-4">
            <label htmlFor="pair-password" className={authLabel}>
              Password
            </label>
            <PasswordField
              id="pair-password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              autoComplete="current-password"
              placeholder="Enter your password"
              autoFocus
              className={authField}
              required
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className={`mt-5 ${authPrimary}`}
          >
            {busy ? "Unlocking vault…" : "Finish device setup"}
          </button>
        </form>
      ) : (
        <div
          role="status"
          className="mt-6 flex items-center justify-center gap-3 rounded-xl border border-line-light/60 bg-surface/40 py-3.5 text-sm text-mute"
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
          <span>Waiting for approval on your other device…</span>
        </div>
      )}

      <div className="mt-7 flex items-center justify-between border-t border-line-light/60 pt-4 text-xs text-mute">
        <button type="button" className={ghost} onClick={onBack}>
          Cancel
        </button>
        <button
          type="button"
          className={ghost}
          onClick={onGoToRecover}
        >
          Use recovery words instead
        </button>
      </div>
    </AuthCard>
  );
}
