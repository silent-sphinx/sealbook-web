import { type FormEvent, type RefObject } from "react";
import { AuthCard, Brand } from "./AuthLayout";
import { LockIcon } from "./AppIcons";
import { PasswordField } from "./PasswordField";
import { ConfirmDialog } from "./ConfirmDialog";
import { field, focusRing, ghost, primary, btnPrimary, btnSecondary } from "../lib/styles";
import { passwordStrength } from "../lib/appState";
import type { DeviceMetadata } from "../lib/storage";

export type Mode = "register" | "signin";

interface AuthScreenProps {
  connectionDomain: string;
  saveDomain: (value: string) => boolean;
  error: string | null;
  mode: Mode;
  stored: DeviceMetadata | null;
  locked: boolean;
  username: string;
  password: string;
  confirmPassword: string;
  busy: boolean;
  signingOut: boolean;
  unlockPasswordRef: RefObject<HTMLInputElement>;
  onModeChange: (mode: Mode) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onUnlock: (event: FormEvent) => void;
  onRegister: (event: FormEvent) => void;
  onPairJoin: (event: FormEvent) => void;
  onConfirmSignOut: () => void;
  onSignOut: () => void;
  onCloseSignOut: () => void;
  onGoToRecover: () => void;
}

export function AuthScreen({
  connectionDomain,
  saveDomain,
  error,
  mode,
  stored,
  locked,
  username,
  password,
  confirmPassword,
  busy,
  signingOut,
  unlockPasswordRef,
  onModeChange,
  onUsernameChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onUnlock,
  onRegister,
  onPairJoin,
  onConfirmSignOut,
  onSignOut,
  onCloseSignOut,
  onGoToRecover,
}: AuthScreenProps) {
  if (locked && stored) {
    return (
      <AuthCard
        connectionDomain={connectionDomain}
        onConnectionDomainSave={saveDomain}
        domainError={error}
      >
        <Brand
          title="Sealbook"
          subtitle={
            <span className="inline-flex items-center gap-1">
              <LockIcon />
              {stored.username}
            </span>
          }
        />
        <form onSubmit={onUnlock} className="mt-8">
          <label htmlFor="unlock-password" className="block text-sm font-medium text-text">
            Password
          </label>
          <PasswordField
            id="unlock-password"
            ref={unlockPasswordRef}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            autoComplete="current-password"
            placeholder="Enter your password"
            autoFocus
            className={field}
            disabled={busy}
            required
          />
          {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
          <button type="submit" disabled={busy} className={`${primary} mt-6`}>
            {busy ? "Please wait…" : "Unlock"}
          </button>
        </form>
        <button
          type="button"
          className={`${ghost} mt-4 block w-full py-2 text-center`}
          onClick={onConfirmSignOut}
        >
          Sign out
        </button>
        {signingOut ? (
          <ConfirmDialog
            title="Sign out"
            heading="Sign out of this device?"
            body="This device's keys are removed from this browser. To get back in you'll need to pair from another signed-in device, or use your 24 recovery words."
            confirmLabel="Sign out"
            busyLabel="Signing out…"
            onConfirm={() => {
              onCloseSignOut();
              onSignOut();
            }}
            onClose={onCloseSignOut}
          />
        ) : null}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      connectionDomain={connectionDomain}
      onConnectionDomainSave={saveDomain}
      domainError={error}
    >
      <Brand
        title="Sealbook"
        subtitle={
          mode === "signin"
            ? "Set up this device with your existing account."
            : "Welcome, to continue create an account."
        }
      />
      <div
        role="tablist"
        aria-label="Account setup method"
        className="mt-8 mb-5 grid grid-cols-2 gap-1 rounded-lg border border-line/60 bg-bg/60 p-1 text-sm"
      >
        {([
          { id: "register", label: "Create account" },
          { id: "signin", label: "Set up device" },
        ] as const).map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={mode === option.id}
            onClick={() => onModeChange(option.id)}
            className={`rounded-md py-1.5 transition-colors duration-150 cursor-pointer ${focusRing} ${mode === option.id
              ? "bg-surface text-text font-medium"
              : "text-mute hover:text-text"
              }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {mode === "register" ? (
        <form onSubmit={onRegister} className="space-y-4">
          <div>
            <label htmlFor="register-username" className="block text-sm font-medium text-text">
              Username
            </label>
            <input
              id="register-username"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              autoComplete="username"
              placeholder="Choose a username"
              className={field}
              autoFocus
              spellCheck={false}
              required
            />
          </div>

          <div>
            <label htmlFor="register-password" className="block text-sm font-medium text-text">
              Password
            </label>
            <PasswordField
              id="register-password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              autoComplete="new-password"
              placeholder="Choose a password"
              className={field}
              required
            />
            {password ? (() => {
              const strength = passwordStrength(password);
              return (
                <div className="mt-2">
                  <div className="flex gap-1" aria-hidden="true">
                    {[1, 2, 3, 4].map((segment) => (
                      <span
                        key={segment}
                        className={`h-1 flex-1 rounded-full transition-colors ${segment <= strength.score ? "bg-accent" : "bg-surface"}`}
                      />
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-mute" aria-live="polite">
                    Password strength: {strength.label}
                  </p>
                </div>
              );
            })() : null}
          </div>

          <div>
            <label htmlFor="register-password-confirm" className="block text-sm font-medium text-text">
              Confirm password
            </label>
            <PasswordField
              id="register-password-confirm"
              value={confirmPassword}
              onChange={(e) => onConfirmPasswordChange(e.target.value)}
              autoComplete="new-password"
              placeholder="Re-enter your password"
              className={field}
              required
            />
          </div>

          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

          <button type="submit" disabled={busy} className={`${primary} mt-6`}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <form
            onSubmit={onPairJoin}
            className="rounded-xl border border-line bg-surface/30 p-5 transition-colors hover:border-line-light"
          >
            <h3 className="text-sm font-semibold text-text">Pair with an active device</h3>
            <p className="mt-1 text-xs text-mute leading-relaxed">
              Login to your account using an already logged-in device.
            </p>
            <div className="mt-3.5">
              <label htmlFor="pair-username" className="block text-xs font-medium text-text">
                Username
              </label>
              <input
                id="pair-username"
                value={username}
                onChange={(e) => onUsernameChange(e.target.value)}
                autoComplete="username"
                placeholder="Enter your username"
                className={field}
                spellCheck={false}
                required
              />
            </div>

            {error ? <p role="alert" className="mt-3 text-xs text-danger">{error}</p> : null}

            <button
              type="submit"
              disabled={busy}
              className={`${btnPrimary} mt-4`}
            >
              {busy ? "Generating code…" : "Start pairing →"}
            </button>
          </form>

          <div className="flex items-center gap-3 text-xs text-mute">
            <div className="h-px flex-1 bg-line" />
            <span>or</span>
            <div className="h-px flex-1 bg-line" />
          </div>

          <div className="rounded-xl border border-line bg-surface/30 p-5 transition-colors hover:border-line-light">
            <h3 className="text-sm font-semibold text-text">Use 24 recovery words</h3>
            <p className="mt-1 text-xs text-mute leading-relaxed">
              Recover your account using your 24 recovery words generated at account creation.
            </p>

            <button
              type="button"
              className={`${btnSecondary} mt-3.5`}
              onClick={onGoToRecover}
            >
              Restore with recovery words →
            </button>
          </div>
        </div>
      )}
    </AuthCard>
  );
}
