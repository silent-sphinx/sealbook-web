import type { VaultProgress } from "../lib/client";
import { AuthStage, Logo } from "./AuthLayout";

function stageLabel(progress: VaultProgress | null): string {
  if (!progress) return "Opening your vault…";
  switch (progress.stage) {
    case "downloading":
      return "Fetching your sealed data…";
    case "verifying":
      return "Checking nothing has been tampered with…";
    case "decrypting":
      return progress.count === undefined
        ? "Decrypting…"
        : `Decrypting ${progress.count} item${progress.count === 1 ? "" : "s"}…`;
  }
}

/**
 * Shown while the first vault read of a session is in flight. That read fetches
 * and decrypts the whole collection before anything can be listed, so without
 * this the shell appears with every tab empty and reads as an emptied vault.
 */
export function DecryptingScreen({ progress }: { progress: VaultProgress | null }) {
  return (
    <AuthStage>
      <div className="animate-fade-in-up text-center">
        <div className="relative mx-auto h-20 w-20">
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-orbit rounded-full border-2 border-accent/15 border-t-accent"
          />
          <span className="absolute inset-2.5 flex items-center justify-center rounded-2xl bg-surface ring-1 ring-line-light">
            <Logo className="h-9 w-9" />
          </span>
        </div>
        <h1 className="mt-5 text-lg font-semibold tracking-tight text-text">
          Decrypting your Sealbook
        </h1>
        <div className="mt-3 flex items-center justify-center" role="status">
          <p className="text-sm text-mute">{stageLabel(progress)}</p>
        </div>
        <p className="mx-auto mt-6 max-w-xs text-xs leading-relaxed text-mute/70">
          Everything is unsealed on this device, so this takes a moment on a
          large vault.
        </p>
      </div>
    </AuthStage>
  );
}
