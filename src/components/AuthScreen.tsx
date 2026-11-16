import { type FormEvent, type RefObject } from "react";
import { AuthCard, Brand } from "./AuthLayout";
import { LockIcon } from "./AppIcons";
import { Icon } from "./Icon";
import { PasswordField } from "./PasswordField";
import { ConfirmDialog } from "./ConfirmDialog";
import { authField, authLabel, authPrimary, authSecondary, focusRing, ghost } from "../lib/styles";
import { passwordStrength } from "../lib/appState";
import type { DeviceMetadata } from "../lib/storage";
import { queuedCount } from "../lib/localStore";
import { ErrorMessage } from "./ErrorMessage";

export type Mode = "register" | "signin";

/** Indexed by `passwordStrength` score, 1 to 4. */
const STRENGTH_TONES = ["", "bg-danger", "bg-warning", "bg-accent", "bg-success"];

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
  unlockPasswordRef: RefObject<HTMLInputElement | null>;
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
        <Brand title="Welcome back" subtitle="Your vault is sealed on this device." />
        <div className="mt-8 flex items-center gap-3 rounded-xl border border-line-light/60 bg-surface/50 p-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold uppercase text-accent ring-1 ring-accent/25"
          >
            {stored.username.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text">{stored.username}</p>
            <p className="text-xs text-mute">Signed in on this device</p>
          </div>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bg/60 text-mute">
            <LockIcon />
          </span>
        </div>
        <form onSubmit={onUnlock} className="mt-6">
          <label htmlFor="unlock-password" className={authLabel}>
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
            className={authField}
            disabled={busy}
            required
          />
          {error ? <ErrorMessage className="mt-4">{error}</ErrorMessage> : null}
          <button type="submit" disabled={busy} className={`${authPrimary} mt-6`}>
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
            body={
              queuedCount() > 0
                ? `${queuedCount()} change${queuedCount() === 1 ? "" : "s"} made on this device have not synced and will be lost. Unlock while connected to send them first. To get back in you'll need to pair from another signed-in device, or use your 24 recovery words.`
                : "This device's keys are removed from this browser. To get back in you'll need to pair from another signed-in device, or use your 24 recovery words."
            }
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
        className="relative mt-8 mb-7 grid grid-cols-2 rounded-xl border border-line-light/60 bg-surface/50 p-1 text-[13px]"
      >
        {/* One pill that slides between the halves, as the main navigation's does. */}
        <span
          aria-hidden="true"
          className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-elevated shadow-sm ring-1 ring-line-light transition-transform duration-200 ease-out ${mode === "signin" ? "translate-x-full" : "translate-x-0"}`}
        />
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
            className={`relative z-10 rounded-lg py-2 font-medium transition-colors duration-150 cursor-pointer ${focusRing} ${mode === option.id
              ? "text-text"
              : "text-mute hover:text-text"
              }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {mode === "register" ? (
        <form key="register" onSubmit={onRegister} className="animate-fade-in-up space-y-4">
          <div>
            <label htmlFor="register-username" className={authLabel}>
              Username
            </label>
            <input
              id="register-username"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              autoComplete="username"
              placeholder="Choose a username"
              className={authField}
              autoFocus
              spellCheck={false}
              required
            />
          </div>

          <div>
            <label htmlFor="register-password" className={authLabel}>
              Password
            </label>
            <PasswordField
              id="register-password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 12 characters"
              className={authField}
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
                        className={`h-1 flex-1 rounded-full transition-colors duration-300 ${segment <= strength.score ? STRENGTH_TONES[strength.score] : "bg-surface"}`}
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
            <label htmlFor="register-password-confirm" className={authLabel}>
              Confirm password
            </label>
            <PasswordField
              id="register-password-confirm"
              value={confirmPassword}
              onChange={(e) => onConfirmPasswordChange(e.target.value)}
              autoComplete="new-password"
              placeholder="Re-enter your password"
              className={authField}
              required
            />
            <p aria-live="polite" className="mt-1.5 min-h-4 text-[11px]">
              {confirmPassword ? (
                confirmPassword === password ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <Icon name="check" className="h-3 w-3" />
                    Passwords match
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-mute">
                    <Icon name="close" className="h-3 w-3" />
                    Passwords do not match yet
                  </span>
                )
              ) : null}
            </p>
          </div>

          {error ? <ErrorMessage>{error}</ErrorMessage> : null}

          <button type="submit" disabled={busy} className={authPrimary}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>
      ) : (
        <div key="signin" className="animate-fade-in-up">
          <form onSubmit={onPairJoin}>
            <label htmlFor="pair-username" className={authLabel}>
              Username
            </label>
            <input
              id="pair-username"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              autoComplete="username"
              placeholder="Enter your username"
              className={authField}
              spellCheck={false}
              required
            />

            {error ? <ErrorMessage size="xs" className="mt-3">{error}</ErrorMessage> : null}

            <button type="submit" disabled={busy} className={`${authPrimary} mt-5`}>
              {busy ? "Generating code…" : "Start pairing →"}
            </button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-mute">
              <Icon name="device" className="h-3.5 w-3.5 shrink-0" />
              Approve it from a device that is already signed in.
            </p>
          </form>

          <div className="my-6 flex items-center gap-4 text-xs text-mute">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-line-light" />
            <span>or</span>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-line-light" />
          </div>

          <button type="button" className={authSecondary} onClick={onGoToRecover}>
            <Icon name="key" className="h-4 w-4 shrink-0 text-accent" />
            Restore with recovery words →
          </button>
          <p className="mt-3 text-center text-xs text-mute">
            Use the 24 words saved when the account was created.
          </p>
        </div>
      )}
    </AuthCard>
  );
}
