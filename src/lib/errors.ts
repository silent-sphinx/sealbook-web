import { coreErrorMessage } from "./wasm";

/**
 * This device unlocked with the password it was stored under, but the server
 * holds a different one, so the password was changed on another device. Named
 * so `friendlyError` can say what happened rather than "try again".
 */
export class PasswordChangedError extends Error {
  constructor() {
    super("The password was changed on another device.");
    this.name = "PasswordChangedError";
  }
}

/**
 * True when the client's own OPAQUE step rejected the typed password against
 * the server's record. That step fails locally, so it carries no HTTP status;
 * a revoked device is a 401 instead and must not be mistaken for this.
 */
export function isOpaqueMismatch(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.toLowerCase().includes("opaque error");
}

export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const text = raw.toLowerCase();
  // Matched by name, before the message branches below: the engine's own
  // wording for a failed request ("Failed to fetch", "Load failed") matches
  // none of them, and the generic fallback's "try again" is not the remedy for
  // a wrong address or a server that is down. Named in `client`.
  if (err instanceof Error && err.name === "ServerUnreachableError") {
    return "Couldn't reach the server. Check your connection, and the server address in Settings.";
  }
  if (err instanceof Error && err.name === "RequestTimeoutError") {
    return "The server didn't answer in time. It may be starting up, or the address may point somewhere else.";
  }
  if (err instanceof Error && err.name === "PasswordChangedError") {
    return "Your password was changed on another device, and this one still unlocks with the old password. Sign out of this device, then pair it again or use your 24 recovery words.";
  }
  // A pre-auth safety refusal: the message already names what is wrong with the
  // server and what to do, so it reaches the user as written.
  if (err instanceof Error && err.name === "ServerUnsafeError") {
    return raw;
  }
  // Before the message branches below: core's error is JSON, so a refusal that
  // names a device list would otherwise match the roster branch.
  const said = coreErrorMessage(raw);
  if (said !== null) {
    return said;
  }
  if (text.includes("username taken")) {
    return "That name is taken.";
  }
  // "invalid credentials" is the server's wording for a bad login; "wrong
  // password" is thrown locally when a modern device's stored keys fail to
  // decrypt under the entered password, without any server round trip.
  if (text.includes("invalid credentials") || text.includes("wrong password")) {
    return "Wrong password.";
  }
  if (text.includes("unauthorized")) {
    return "Your session expired. Lock and unlock again.";
  }
  if (text.includes("rate limited")) {
    return "Too many tries. Wait a moment.";
  }
  // Another device wrote while this one was reading. Transient, and the message
  // already says so, so it is passed through rather than flattened into the
  // generic fallback at the bottom.
  // Said by the server as often as by this app, and a server's wording is its
  // own to choose, so one that came over the wire is replaced by fixed text.
  const fromServer = err instanceof Error && err.name === "ApiError";
  if (text.includes("kept changing")) {
    return fromServer ? "The vault kept changing while it was being read. Try again." : raw;
  }
  if (text.includes("too large")) {
    return fromServer ? "That is too large for the server to accept." : raw;
  }
  // Checked before the roster branch below, which this message would otherwise
  // match: the history ran out rather than anything failing to verify, and the
  // remedy is pairing rather than alarm.
  if (err instanceof Error && err.name === "RosterTooOldError") {
    return raw;
  }
  // A roster failure means the device list served was not one this account's
  // devices signed for. Never transient, and never worth retrying.
  if (text.includes("roster")) {
    return "This device couldn't verify the account's device list, so it stopped. Nothing was changed.";
  }
  // A manifest failure is the other kind that is never the user's fault and
  // never worth retrying: the server served something no device signed for. The
  // messages are written for a person, so they are passed through under a lead
  // that says what class of problem it is. Matched on the name rather than by
  // importing `ManifestError`, which would pull the client and its wasm module
  // into every component that reports an error.
  if (err instanceof Error && err.name === "ManifestError") {
    return `The server's answer doesn't match what your devices signed for, so nothing was changed. ${raw}`;
  }
  // Written for a person already, and the cause is local rather than anything
  // the server did. Matched on the name, as above.
  if (err instanceof Error && err.name === "DeviceStorageError") {
    return raw;
  }
  // Also written for a person, and it names the remedy. The generic fallback
  // would say "try again", which offline is exactly what will not help.
  if (err instanceof Error && err.name === "OfflineUnavailableError") {
    return raw;
  }
  if (text.includes("unfinished recovery")) {
    return coreErrorMessage('{"kind":"RecoveryRotationPending"}') ?? raw;
  }
  if (text.includes("hasn't signed in") || text.includes("this browser")) {
    return "This browser isn't signed in yet. Pair it, or use your recovery words.";
  }
  if (text.includes("expired") || text.includes("not found")) {
    return "That request expired. Start again.";
  }
  if (text.includes("phrase") || text.includes("unwrap") || text.includes("aead")) {
    return "Those words didn't match.";
  }
  return "Something went wrong. Try again.";
}