import { useId, useState, type ReactNode } from "react";

import { loadDevice } from "../lib/storage";
import { field, fieldLabel } from "../lib/styles";
import { PasswordField } from "./PasswordField";

type ExportPasswordConfirm = {
  field: ReactNode;
  /** False until something is typed, for disabling the export button. */
  hasPassword: boolean;
  /** Resolves to a message to show when the password is missing or wrong, or null once it is right. */
  confirm: () => Promise<string | null>;
};

/**
 * The step revoking a device or changing the password asks for, shared by
 * every export that writes decrypted data to a file: it should not take one
 * click on a session someone else is sitting at. Checked against this device's
 * own record, so it needs no round trip.
 */
export function useExportPasswordConfirm(): ExportPasswordConfirm {
  const [password, setPassword] = useState("");
  const id = useId();

  async function confirm(): Promise<string | null> {
    if (!password) return "Enter your password to confirm.";
    if ((await loadDevice(password)) === null) return "Wrong password.";
    setPassword("");
    return null;
  }

  return {
    field: (
      <div>
        <label htmlFor={id} className={fieldLabel}>
          Password
        </label>
        <PasswordField
          id={id}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
          autoComplete="current-password"
          placeholder="Confirm with your password"
        />
      </div>
    ),
    hasPassword: password !== "",
    confirm,
  };
}
