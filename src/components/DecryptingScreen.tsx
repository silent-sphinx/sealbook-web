import type { VaultProgress } from "../lib/client";
import { Logo } from "./AuthLayout";

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
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <div className="animate-fade-in-up">
        <Logo className="mx-auto h-14 w-14" />
        <h1 className="mt-5 text-lg font-semibold tracking-tight text-text">
          Decrypting your Sealbook
        </h1>
        <div className="mt-4 flex items-center justify-center gap-2.5" role="status">
          <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent/30 border-t-accent" aria-hidden="true" />
          <p className="text-sm text-mute">{stageLabel(progress)}</p>
        </div>
        <p className="mx-auto mt-6 max-w-xs text-xs leading-relaxed text-mute/70">
          Everything is unsealed on this device, so this takes a moment on a
          large vault.
        </p>
      </div>
    </main>
  );
}
