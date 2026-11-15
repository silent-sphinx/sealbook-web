/**
 * Display helpers for pairing codes.
 *
 * Presentation only, and deliberately not through core: these run in components
 * that otherwise never load the wasm module. Whether a code is one is core's
 * decision, made when the code is used (`corePairLookupPath`).
 */

/** Words in a pairing code. Mirrors `PAIR_CODE_WORDS` in sealbook-crypto. */
export const PAIR_CODE_WORDS = 8;

/** The words of a code, for a screen that shows them one by one. */
export function pairCodeWords(code: string): string[] {
  return code.trim().split(/\s+/u).filter(Boolean);
}
