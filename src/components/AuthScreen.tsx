import { type FormEvent, type RefObject } from "react";
import { AuthCard, Brand } from "./AuthLayout";
import { LockIcon } from "./AppIcons";
import { Icon, type IconName } from "./Icon";
import { PasswordField } from "./PasswordField";
import { ConfirmDialog } from "./ConfirmDialog";
import { field, focusRing, ghost, primary, btnPrimary, btnSecondary } from "../lib/styles";
import { passwordStrength } from "../lib/appState";
import type { DeviceMetadata } from "../lib/storage";
import { queuedCount } from "../lib/localStore";

export type Mode = "register" | "signin";

/** Indexed by `passwordStrength` score, 1 to 4. */
const STRENGTH_TONES = ["", "bg-danger", "bg-warning", "bg-accent", "bg-success"];

const optionCard =
  "rounded-xl border border-line bg-surface/30 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-line-light hover:bg-surface/50";

function OptionHeading({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div className="flex gap-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-mute">{body}</p>
      </div>
    </div>
  );
}

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
        <div className="mt-7 flex items-center gap-3 rounded-xl border border-line bg-surface/40 p-3">
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
        className="relative mt-8 mb-6 grid grid-cols-2 rounded-xl border border-line bg-surface/80 p-1 text-sm"
      >
        {/* One pill that slides between the halves, as the main navigation's does. */}
        <span
          aria-hidden="true"
          className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-accent shadow-sm transition-transform duration-200 ease-out ${mode === "signin" ? "translate-x-full" : "translate-x-0"}`}
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
            className={`relative z-10 rounded-lg py-1.5 font-semibold transition-colors duration-150 cursor-pointer ${focusRing} ${mode === option.id
              ? "text-bg"
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

          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

          <button type="submit" disabled={busy} className={`${primary} mt-6`}>
            {busy ? "Creating account…" : "Create account"}
          </button>
          <p className="flex items-center justify-center gap-1.5 text-[11px] text-mute">
            <Icon name="shield" className="h-3 w-3" />
            Your password never leaves this device.
          </p>
        </form>
      ) : (
        <div key="signin" className="animate-fade-in-up space-y-4">
          <form onSubmit={onPairJoin} className={optionCard}>
            <OptionHeading
              icon="device"
              title="Pair with an active device"
              body="Log in to your account using an already logged-in device."
            />
            <div className="mt-4">
              <label htmlFor="pair-username" className="block text-sm font-medium text-text">
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

          <div className={`${optionCard} [animation-delay:60ms]`}>
            <OptionHeading
              icon="key"
              title="Use 24 recovery words"
              body="Recover your account using the 24 recovery words generated at account creation."
            />

            <button
              type="button"
              className={`${btnSecondary} mt-4`}
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
