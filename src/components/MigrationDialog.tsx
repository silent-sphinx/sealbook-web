import { useEffect, useMemo, useState, type FormEvent } from "react";
import { deviceEntries, listDevices } from "../lib/client";
import type { DeviceLabel, Session } from "../lib/client";
import { coreErrorMessage } from "../lib/wasm";
import { btnPrimary, btnSecondary, field, fieldLabel } from "../lib/styles";
import { ErrorMessage } from "./ErrorMessage";
import { Modal, ModalBody, ModalFooter } from "./Modal";
import { PasswordField } from "./PasswordField";

type Props = {
  session: Session;
  deviceLabels: DeviceLabel[];
  busy: boolean;
  error: string | null;
  progress: { done: number; total: number };
  /** `revokeIds` is every other device when the box is ticked, none when not. */
  onRun: (password: string, revokeIds: string[]) => void;
  onLater: () => void;
};

/**
 * What the one rotation an account owes is, who keeps access through it, and
 * how far it has got.
 *
 * Used for a migration to the current protocol and for finishing an interrupted
 * recovery, which owe the same thing: a new vault key, a new recovery phrase and
 * every object re-encrypted. Revoking every other device is the default, because
 * the rotation is the one moment doing so costs nothing extra.
 */
export function MigrationDialog({ session, deviceLabels, busy, error, progress, onRun, onLater }: Props) {
  const owed = session.rotationOwed === "recovery" ? "RecoveryRotationPending" : "UpgradeRotationPending";
  const message = useMemo(() => coreErrorMessage(JSON.stringify({ kind: owed })) ?? "", [owed]);
  const [password, setPassword] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [others, setOthers] = useState<{ device_id: string; name: string; detail: string }[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listDevices(session)
      .then((devices) => {
        if (cancelled) return;
        setOthers(deviceEntries(session, devices, deviceLabels).filter((device) => !device.is_current));
      })
      .catch((err: unknown) => {
        if (!cancelled) setListError(err instanceof Error ? err.message : "The device list could not be read.");
      });
    return () => {
      cancelled = true;
    };
  }, [session, deviceLabels]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onRun(password, revokeOthers && others ? others.map((device) => device.device_id) : []);
  }

  return (
    <Modal title="Replace your vault key" onClose={onLater} size="md" dismissible={!busy} elevated>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <ModalBody>
          <div className="space-y-4">
            <p className="text-sm text-text">{message}</p>
            {listError ? <p className="text-xs text-danger">{listError}</p> : null}
            {others && others.length > 0 ? (
              <fieldset className="space-y-2">
                <legend className={fieldLabel}>Other devices on this account</legend>
                <ul className="space-y-1.5 text-sm">
                  {others.map((device) => (
                    <li key={device.device_id} className="rounded-lg border border-line px-3 py-2">
                      <span className="block font-medium text-text">{device.name}</span>
                      <span className="block text-xs text-mute">{device.detail}</span>
                    </li>
                  ))}
                </ul>
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={revokeOthers}
                    disabled={busy}
                    onChange={(event) => setRevokeOthers(event.target.checked)}
                  />
                  Revoke all other devices
                </label>
                <p className="text-xs text-mute">
                  A revoked device is signed out and cannot read the vault again. Pair it again
                  from this device to bring it back.
                </p>
              </fieldset>
            ) : null}
            <label className={fieldLabel}>
              Confirm your password
              <PasswordField
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={busy}
                className={field}
                required
              />
            </label>
            <p className="text-xs text-mute">
              You will be shown a new set of recovery words next, and asked to type a few of them
              back before anything is changed.
            </p>
            {busy && progress.total > 0 ? (
              <p role="status" className="text-xs text-mute">
                Re-encrypting {progress.done} of {progress.total}...
              </p>
            ) : null}
            {error ? <ErrorMessage>{error}</ErrorMessage> : null}
          </div>
        </ModalBody>
        <ModalFooter>
          <button type="button" className={btnSecondary} onClick={onLater} disabled={busy}>
            Later
          </button>
          <button type="submit" className={btnPrimary} disabled={busy || !password}>
            {busy ? "Replacing..." : "Replace the key"}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
