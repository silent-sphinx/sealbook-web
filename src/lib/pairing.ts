/**
 * Helpers for pairing confirmation codes.
 *
 * Protocol v2 raised these from 13 to 26 base-32 characters (65 to 130 bits),
 * so a malicious server cannot search for a second preimage that would let it
 * substitute its own device keys. At that length the code has to be grouped to
 * stay comparable by eye.
 */

/** Characters per display group. Matches the Sealbook CLI. */
const GROUP_SIZE = 4;

/** Splits a confirmation code into groups for display. */
export function confirmationGroups(code: string): string[] {
  const normalized = normalizeConfirmation(code);
  const groups: string[] = [];
  for (let i = 0; i < normalized.length; i += GROUP_SIZE) {
    groups.push(normalized.slice(i, i + GROUP_SIZE));
  }
  return groups;
}

/** Formats a confirmation code as space-separated groups. */
export function formatConfirmation(code: string): string {
  return confirmationGroups(code).join(" ");
}

/**
 * Strips spacing and case differences, so a code can be compared or entered
 * exactly as it is displayed.
 */
export function normalizeConfirmation(entered: string): string {
  return entered.replace(/[\s-]/gu, "").toUpperCase();
}
