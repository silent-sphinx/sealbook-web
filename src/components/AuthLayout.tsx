import { useState, type FormEvent } from "react";
import logo from "../assets/sealbook-white-192.png";
import { Modal } from "./Modal";
import { btnPrimary, btnSecondary, field, ghost, primary } from "../lib/styles";

export function Logo({ className }: { className: string }) {
  return <img src={logo} alt="" className={className} />;
}

export function Brand({ title, subtitle }: { title: string; subtitle: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Logo className="h-12 w-12 shrink-0" />
      <div>
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
  children,
}: {
  number: number;
  title: string;
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-xs ring-1 ring-accent/25">
          {number}
        </span>
        {!last ? <span className="mt-1 w-px flex-1 bg-line" aria-hidden="true" /> : null}
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
      <Brand title="Connect to Sealbook" subtitle="Enter the URL of your Sealbook server." />

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
          A sealbook server is required to continue, visit <a className="text-danger" href="https://github.com/silent-sphinx/sealbook" target="_blank">GitHub.</a>
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
      <div className="mt-5 flex items-center justify-center gap-2 text-xs text-mute">
        <span className="min-w-0 truncate">
          Server <span className="text-text/80">{serverLabel(value)}</span>
        </span>
        <span aria-hidden="true" className="text-mute/50">
          ·
        </span>
        <button type="button" onClick={openSettings} className={ghost}>
          Change
        </button>
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

export function AuthCard({
  children,
  connectionDomain,
  onConnectionDomainSave,
  domainError,
  wide = false,
}: {
  children: React.ReactNode;
  connectionDomain?: string;
  onConnectionDomainSave?: (value: string) => boolean;
  domainError?: string | null;
  wide?: boolean;
}) {
  const managesDomain = connectionDomain !== undefined && onConnectionDomainSave !== undefined;
  const domainConfigured = connectionDomain === undefined || connectionDomain.trim() !== "";
  const showWide = wide && domainConfigured;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-full flex-col justify-center px-5 py-8">
      <div
        className={`mx-auto w-full min-w-0 ${showWide ? "max-w-[900px]" : "max-w-[460px]"} animate-fade-in-up`}
      >
        <div className="rounded-2xl border border-line bg-panel/75 p-7 shadow-2xl shadow-black/40 backdrop-blur-md sm:p-9">
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
    </main>
  );
}
