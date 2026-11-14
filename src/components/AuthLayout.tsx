import { useId, useState, type FormEvent } from "react";
import logo from "../assets/sealbook-white-192.png";
import { Modal } from "./Modal";
import {
  authField,
  authLabel,
  authPrimary,
  btnPrimary,
  btnSecondary,
  eyebrow,
  field,
  focusRing,
} from "../lib/styles";
import { Icon } from "./Icon";
import { ErrorMessage } from "./ErrorMessage";

export function Logo({ className }: { className: string }) {
  return <img src={logo} alt="" className={className} />;
}

const DIAL_TICKS = Array.from({ length: 60 }, (_, index) => index * 6);

/**
 * The logo set in a combination dial. The tick ring turns slowly; the index
 * notch in the bezel stays put, as a real dial's does.
 */
export function VaultMark() {
  const id = useId();
  return (
    <div className="relative mx-auto h-[104px] w-[104px]">
      <span aria-hidden="true" className="vault-glow absolute -inset-3 rounded-full" />
      <svg aria-hidden="true" viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.55" />
            <stop offset="0.45" stopColor="var(--color-line-light)" />
            <stop offset="1" stopColor="var(--color-line)" />
          </linearGradient>
          <radialGradient id={`${id}-face`} cx="0.5" cy="0.3" r="0.75">
            <stop offset="0" stopColor="var(--color-elevated)" />
            <stop offset="1" stopColor="var(--color-bg)" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="49" fill={`url(#${id}-face)`} stroke={`url(#${id}-rim)`} strokeWidth="1" />
        <g className="vault-dial">
          {DIAL_TICKS.map((angle) => {
            const major = angle % 30 === 0;
            return (
              <line
                key={angle}
                x1="50"
                y1={major ? 8 : 9.5}
                x2="50"
                y2="13"
                transform={`rotate(${angle} 50 50)`}
                strokeLinecap="round"
                strokeWidth={major ? 1.1 : 0.6}
                className={major ? "stroke-text/45" : "stroke-mute/30"}
              />
            );
          })}
        </g>
        <circle cx="50" cy="50" r="34.5" className="fill-bg/70 stroke-line" strokeWidth="0.75" />
        <path d="M47.6 2.6h4.8L50 6.6Z" className="fill-accent" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        <Logo className="h-11 w-11 drop-shadow-[0_2px_6px_rgb(0_0_0/0.6)]" />
      </span>
    </div>
  );
}

export function Brand({
  title,
  subtitle,
  eyebrow: eyebrowText,
}: {
  title: string;
  subtitle: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="text-center">
      <VaultMark />
      {eyebrowText ? <p className={`${eyebrow} mt-6 text-accent/90`}>{eyebrowText}</p> : null}
      <h1
        className={`${eyebrowText ? "mt-2" : "mt-6"} text-[28px] leading-tight font-bold tracking-tight text-text`}
      >
        {title}
      </h1>
      <p className="mx-auto mt-2 max-w-[36ch] text-sm leading-relaxed text-mute">{subtitle}</p>
    </div>
  );
}

/** One entry in a vertical numbered stepper, connected to the next by a line. */
export function Step({
  number,
  title,
  last = false,
  state = "active",
  children,
}: {
  number: number;
  title: string;
  last?: boolean;
  /** `done` fills the dot, `waiting` pulses it while the step is outstanding. */
  state?: "done" | "active" | "waiting";
  children?: React.ReactNode;
}) {
  const dot =
    state === "done"
      ? "bg-accent text-bg ring-accent"
      : `bg-accent/15 text-accent ring-accent/25 ${state === "waiting" ? "animate-pulse-ring" : ""}`;
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-semibold text-xs ring-1 transition-colors ${dot}`}>
          {state === "done" ? <Icon name="check" className="h-3.5 w-3.5" /> : number}
        </span>
        {!last ? (
          <span
            className={`mt-1 w-px flex-1 ${state === "done" ? "bg-accent/40" : "bg-line"}`}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-6"}`}>
        <p className="text-sm font-semibold text-text">{title}</p>
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </div>
  );
}

function serverLabel(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

/**
 * First-run gate. Sealbook is self-hosted, so nothing else on the auth screens
 * can work until an instance is chosen.
 */
export function ServerSetupScreen({
  onSave,
  error,
}: {
  onSave: (value: string) => boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave(draft);
  }

  return (
    <>
      <Brand
        eyebrow="First run"
        title="Connect to Sealbook"
        subtitle="Enter the URL of your Sealbook server."
      />

      <form onSubmit={submit} className="mt-8">
        <label htmlFor="setup-domain" className={authLabel}>
          Server address
        </label>
        <input
          id="setup-domain"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="sealbook.example.com"
          className={authField}
          autoComplete="url"
          inputMode="url"
          autoFocus
          spellCheck={false}
          required
        />
        <p className="mt-2 text-xs leading-relaxed text-mute">
          A sealbook server is required to continue, visit <a className="text-accent underline underline-offset-2 hover:brightness-110" href="https://github.com/silent-sphinx/sealbook" target="_blank" rel="noreferrer">GitHub.</a>
        </p>

        {error ? (
          <ErrorMessage className="mt-4">{error}</ErrorMessage>
        ) : null}

        <button type="submit" className={`${authPrimary} mt-6`}>
          Continue
        </button>
      </form>
    </>
  );
}

/** Changes an already-configured server. */
export function DomainSettings({
  value,
  onSave,
}: {
  value: string;
  onSave: (value: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saveError, setSaveError] = useState<string | null>(null);

  function openSettings() {
    setDraft(value);
    setSaveError(null);
    setOpen(true);
  }

  function save() {
    if (onSave(draft)) {
      setOpen(false);
      setSaveError(null);
    } else {
      setSaveError("Enter a valid server address.");
    }
  }

  return (
    <>
      <div className="mt-4 flex justify-center">
        <div className="flex max-w-full items-center gap-2 rounded-full border border-line bg-surface/40 py-1 pr-1 pl-3 text-xs text-mute backdrop-blur-sm">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
          <Icon name="lock" className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate">
            <span className="sr-only">Server </span>
            <span className="text-text/80">{serverLabel(value)}</span>
          </span>
          <button
            type="button"
            onClick={openSettings}
            className={`shrink-0 rounded-full px-2.5 py-1 font-medium text-mute transition-colors hover:bg-elevated hover:text-accent ${focusRing}`}
          >
            Change
          </button>
        </div>
      </div>

      {open && (
        <Modal title="Change server" onClose={() => setOpen(false)}>
          <div className="space-y-4 p-6">
            <div>
              <label
                htmlFor="auth-connection-domain"
                className="block text-sm font-medium text-text"
              >
                Server address
              </label>
              <input
                id="auth-connection-domain"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="sealbook.example.com"
                className={field}
                autoComplete="url"
                inputMode="url"
                spellCheck={false}
                autoFocus
              />
              {saveError ? (
                <ErrorMessage size="xs" className="mt-2">{saveError}</ErrorMessage>
              ) : null}
              <p className="mt-1.5 text-xs text-mute">
                Signing in sends your credentials to this server, so check it carefully.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className={btnSecondary} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} onClick={save}>
                Save server
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** The full-page frame every signed-out screen sits in. */
export function AuthStage({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-stage mx-auto flex min-h-dvh w-full max-w-full flex-col justify-center px-4 py-12 sm:px-5">
      <span aria-hidden="true" className="auth-hairline" />
      <span aria-hidden="true" className="auth-beam" />
      {children}
    </main>
  );
}

export function AuthCard({
  children,
  connectionDomain,
  onConnectionDomainSave,
  domainError,
}: {
  children: React.ReactNode;
  connectionDomain?: string;
  onConnectionDomainSave?: (value: string) => boolean;
  domainError?: string | null;
}) {
  const managesDomain = connectionDomain !== undefined && onConnectionDomainSave !== undefined;
  const domainConfigured = connectionDomain === undefined || connectionDomain.trim() !== "";

  return (
    <AuthStage>
      <div className="mx-auto w-full min-w-0 max-w-[400px] animate-fade-in-up">
        {domainConfigured ? (
          children
        ) : managesDomain ? (
          <ServerSetupScreen
            onSave={onConnectionDomainSave!}
            error={domainError ?? null}
          />
        ) : null}

        <p className="mt-10 flex items-center justify-center gap-1.5 text-center text-[11px] text-mute/80">
          <Icon name="lock" className="h-3 w-3 shrink-0" />
          End-to-end encrypted. Your password never leaves this device.
        </p>

        {managesDomain && domainConfigured ? (
          <DomainSettings value={connectionDomain!} onSave={onConnectionDomainSave!} />
        ) : null}
      </div>
    </AuthStage>
  );
}
