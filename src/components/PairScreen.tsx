import { type FormEvent } from "react";
import { AuthCard, Brand, Step } from "./AuthLayout";
import { CopyIcon, CheckIcon } from "./AppIcons";
import { PasswordField } from "./PasswordField";
import { field, ghost } from "../lib/styles";
import { confirmationGroups } from "../lib/pairing";

interface PairScreenProps {
  connectionDomain: string;
  saveDomain: (value: string) => boolean;
  error: string | null;
  pairId: string;
  pairConfirm: string;
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
  pairId,
  pairConfirm,
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
  const pairWords = pairId.split(" ").filter(Boolean);

  return (
    <AuthCard
      connectionDomain={connectionDomain}
      onConnectionDomainSave={saveDomain}
      domainError={error}
    >
      <Brand
        title="Pair this device"
        subtitle="Connect with an active device to transfer encryption keys."
      />

      <div className="mt-8">
        <Step number={1} title="Open your signed-in device">
          <p className="text-sm leading-relaxed text-mute">
            On your signed-in device, click <strong className="font-semibold text-text">Add device</strong> at the top.
          </p>
        </Step>

        <Step number={2} title="Enter this pairing code">
          <div className="flex flex-wrap gap-1.5">
            {pairWords.map((word, index) => (
              <span
                key={`${index}-${word}`}
                className="select-all rounded-md border border-line bg-bg/90 px-2.5 py-1 font-mono text-sm text-accent"
              >
                {word}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(pairId);
              onCopied(true);
              setTimeout(() => onCopied(false), 2000);
            }}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:border-line-light hover:text-accent-dim cursor-pointer"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy code"}
          </button>
        </Step>

        <Step number={3} title="Verify code" last>
          <p className="text-sm leading-relaxed text-mute">
            Confirm both devices show this code:
          </p>
          <div className="mt-3 rounded-xl border border-accent/25 bg-accent/5 px-4 py-4 text-center">
            <p className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 font-mono text-xl font-bold tracking-[0.08em] text-accent">
              {confirmationGroups(pairConfirm).map((group, index) => (
                <span key={`${index}-${group}`}>{group}</span>
              ))}
            </p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-mute">
            Check the other device, then approve the pairing there.
          </p>
        </Step>
      </div>

      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}

      {pairApproved ? (
        <form onSubmit={onSubmit} className="mt-6 animate-fade-in-up">
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300">
            <svg className="h-4 w-4 shrink-0 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
                clipRule="evenodd"
              />
            </svg>
            <span>Pairing approved! Enter your password to finish unlocking your vault.</span>
          </div>
          <div className="mt-4">
            <label htmlFor="pair-password" className="block text-sm font-medium text-text">
              Password
            </label>
            <PasswordField
              id="pair-password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              autoComplete="current-password"
              placeholder="Enter your password"
              autoFocus
              className={field}
              required
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-bg transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Unlocking vault…" : "Finish device setup"}
          </button>
        </form>
      ) : (
        <div className="mt-6 flex items-center justify-center gap-3 rounded-xl border border-line bg-surface/20 py-3.5 text-sm text-mute">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          <span>Waiting for approval on your other device…</span>
        </div>
      )}

      <div className="mt-7 flex items-center justify-between border-t border-line pt-4 text-xs text-mute">
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
