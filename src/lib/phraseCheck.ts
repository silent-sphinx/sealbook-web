/**
 * The check that stands between a new recovery phrase and the rotation that
 * installs it.
 *
 * A rotation replaces every phrase, and one shown only after the server has
 * committed is lost if the tab closes on that screen, leaving a wrap for a
 * phrase nobody holds. So the phrase is shown first and the user re-enters a few
 * words of it, chosen at random so a glance and a click cannot pass it.
 */

/** How many words the user types back. */
export const CHECK_WORD_COUNT = 3;

/**
 * Distinct 0-based positions, ascending, drawn uniformly. `random` is
 * injectable so a test can fix the draw; it must return values in `[0, 1)`.
 */
export function chooseCheckPositions(
  wordCount: number,
  count: number = CHECK_WORD_COUNT,
  random: () => number = cryptoRandom,
): number[] {
  const wanted = Math.min(count, wordCount);
  const chosen = new Set<number>();
  while (chosen.size < wanted) {
    chosen.add(Math.floor(random() * wordCount));
  }
  return [...chosen].sort((a, b) => a - b);
}

/** Whether `typed` holds, in order, exactly the words at `positions`. */
export function checkMatches(words: string[], positions: number[], typed: string[]): boolean {
  return (
    typed.length === positions.length &&
    positions.every((position, i) => typed[i]?.trim().toLowerCase() === words[position])
  );
}

function cryptoRandom(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0]! / 2 ** 32;
}
