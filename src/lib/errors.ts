/**
 * This client's wording for each rotation core refused.
 *
 * Core names the condition rather than carrying a sentence, so the three
 * clients refuse the same rotations and each says it in its own words.
 */
const ROTATION_REFUSALS: Record<string, string> = {
  RevokingSelf: "You can't revoke the device you're signed in on.",
  NotInRoster: "That device has already been removed.",
  LastDevice: "You can't revoke the last device.",
  NotEnrolled: "This device isn't in the account's device list. Sign in again.",
  // Counting the row would leave it sealed under the key the rotation retires,
  // which drops the object from the vault for good, so nothing was written.
  Unreadable:
    "One object in this vault can't be re-encrypted, so the key wasn't rotated and nothing " +
    "was changed. Sign in on a device that can read it.",
};

/**
 * This client's wording for each pairing core refused.
 *
 * As above, core names the condition. A refusal whose sentence needs numbers
 * out of the refusal itself is built in `pairingRefusal`.
 */
const PAIR_REFUSALS: Record<string, string> = {
  NoAnchor:
    "The server sent no device list for this account to anchor on, so there is nothing to " +
    "pair against.",
  // Either the device list moved under the pairing or the keys on offer are not
  // the ones the other device is holding; neither is safe to approve.
  ServerCode:
    "This device and the new one don't agree on the account's devices. Start the pairing again.",
  Expired: "That pairing code has expired. Start the pairing again on the new device.",
  TypedCode: "That code doesn't match the one for this pairing.",
};

/**
 * Parsed here rather than through the client's own `coreErrorOf`, which would
 * pull the wasm module into every component that reports an error.
 */
function coreRefusal(raw: string, kind: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const error = parsed as { kind?: unknown; refusal?: Record<string, unknown> };
  if (error.kind !== kind || typeof error.refusal?.refusal !== "string") return null;
  return error.refusal;
}

function rotationRefusal(raw: string): string | null {
  const refusal = coreRefusal(raw, "Rotation");
  return refusal === null ? null : ROTATION_REFUSALS[refusal.refusal as string] ?? null;
}

function pairingRefusal(raw: string): string | null {
  const refusal = coreRefusal(raw, "Pair");
  if (refusal === null) {
    return null;
  }
  switch (refusal.refusal) {
    case "KeyRotated":
      return (
        "The vault key has been rotated since this device fetched it. Sign in again and " +
        "approve the new device after that."
      );
    case "AlreadyEnrolled":
      return "That device is already enrolled.";
    case "RosterMoved":
      return (
        `The new device started pairing against device list ${String(refusal.joined_at)} but ` +
        `this account is now on ${String(refusal.now)}. Start the pairing again.`
      );
    default:
      return PAIR_REFUSALS[refusal.refusal as string] ?? null;
  }
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
  // Before the message branches below: core's error is JSON, so a refusal that
  // names a device list would otherwise match the roster branch.
  const refusal = rotationRefusal(raw) ?? pairingRefusal(raw);
  if (refusal !== null) {
    return refusal;
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
  if (text.includes("kept changing")) {
    return raw;
  }
  if (text.includes("too large")) {
    return raw;
  }
  // Checked before the roster branch below, which this message would otherwise
  // match: the history ran out rather than anything failing to verify, and the
  // remedy is pairing rather than alarm.
  if (err instanceof Error && err.name === "RosterTooOldError") {
    return "This device has been away too long to check the account's device list. Pair it again to carry on.";
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
  if (text.includes("confirmation")) {
    return "The two devices don't show the same code. Start the pairing again.";
  }
  if (text.includes("unfinished recovery")) {
    return "Finish the interrupted recovery first: use the banner at the top of the app.";
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