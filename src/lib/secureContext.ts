/**
 * Why this page cannot do the cryptography the app is made of, or null.
 *
 * Over plain HTTP from anywhere but localhost a browser withholds
 * `crypto.subtle`, so without this the app would load, let a person register,
 * and fail only when it came to store the device's keys, after the server-side
 * work had already been done.
 */
export function insecureContextReason(
  scope: { isSecureContext?: boolean; crypto?: { subtle?: unknown } } = globalThis,
): string | null {
  if (scope.isSecureContext === false || !scope.crypto?.subtle) {
    return "Sealbook needs a secure connection. Open it over https://, or from localhost.";
  }
  return null;
}
