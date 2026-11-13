import { useState, type FormEvent } from "react";
import logo from "../assets/sealbook-white-192.png";
import { Modal } from "./Modal";
import { btnPrimary, btnSecondary, eyebrow, field, focusRing, primary } from "../lib/styles";
import { Icon } from "./Icon";

export function Logo({ className }: { className: string }) {
  return <img src={logo} alt="" className={className} />;
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
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <span
          aria-hidden="true"
          className="absolute -inset-2 rounded-2xl bg-accent/20 blur-xl"
        />
        <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-surface ring-1 ring-line-light">
          <Logo className="h-9 w-9" />
        </span>
      </div>
      <div className="min-w-0">
        {eyebrowText ? <p className={`${eyebrow} mb-1 text-accent/90`}>{eyebrowText}</p> : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-mute">{subtitle}</p>
      </div>
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

      <form onSubmit={submit} className="mt-7">
        <label htmlFor="setup-domain" className="block text-sm font-medium text-text">
          Server address
        </label>
        <input
          id="setup-domain"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="sealbook.example.com"
          className={field}
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
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <button type="submit" className={`${primary} mt-6`}>
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
      <div className="mt-5 flex justify-center">
        <div className="flex max-w-full items-center gap-2 rounded-full border border-line bg-surface/60 py-1 pr-1 pl-3 text-xs text-mute backdrop-blur-sm">
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
                <p role="alert" className="mt-2 text-xs text-danger">
                  {saveError}
                </p>
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
    <main className="auth-stage mx-auto flex min-h-dvh w-full max-w-full flex-col justify-center px-4 py-8 sm:px-5">
      <span aria-hidden="true" className="auth-hairline" />
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
      <div className="mx-auto w-full min-w-0 max-w-[460px] animate-fade-in-up">
        <div className="glow-edge relative rounded-2xl border border-line bg-panel/80 p-6 shadow-[0_30px_80px_-24px_var(--color-accent-ring)] backdrop-blur-md sm:p-9">
          {domainConfigured ? (
            children
          ) : managesDomain ? (
            <ServerSetupScreen
              onSave={onConnectionDomainSave!}
              error={domainError ?? null}
            />
          ) : null}
        </div>

        {managesDomain && domainConfigured ? (
          <DomainSettings value={connectionDomain!} onSave={onConnectionDomainSave!} />
        ) : null}
      </div>
    </AuthStage>
  );
}
