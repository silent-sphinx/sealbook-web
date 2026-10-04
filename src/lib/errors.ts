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
  // A roster failure means the device list served was not one this account's
  // devices signed for. Never transient, and never worth retrying.
  if (text.includes("roster")) {
    return "This device couldn't verify the account's device list, so it stopped. Nothing was changed.";
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