export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const text = raw.toLowerCase();
  if (text.includes("username taken")) {
    return "That name is taken.";
  }
  if (text.includes("invalid credentials")) {
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