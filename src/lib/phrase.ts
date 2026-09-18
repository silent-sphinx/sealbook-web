/**
 * Utilities for formatting, parsing, and extracting 24-word BIP-39 recovery phrases.
 */

/**
 * Intelligently extracts words from raw text, whether copied from
 * sealbook-recovery-words.txt, a numbered list, comma-separated list,
 * or raw space-separated words.
 */
export function extractRecoveryWords(input: string): string[] {
  if (!input || !input.trim()) {
    return [];
  }

  // 1. If input contains "Raw phrase:", grab that if it contains 24 words
  const rawMatch = input.match(/Raw phrase(?:\s*\([^)]*\))?\s*:\s*([a-zA-Z\s]+)/i);
  if (rawMatch && rawMatch[1]) {
    const rawWords = rawMatch[1]
      .trim()
      .toLowerCase()
      .split(/\s+/u)
      .filter((w) => /^[a-z]+$/u.test(w));
    if (rawWords.length === 24) {
      return rawWords;
    }
  }

  // 2. Look for numbered list format: e.g. "1. word", " 01) word", "1: word", "1 - word"
  const numberedPattern = /(?:^|\s)\d+[-.:)]\s*([a-zA-Z]+)/gu;
  const numbered: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = numberedPattern.exec(input)) !== null) {
    if (match[1]) {
      numbered.push(match[1].toLowerCase());
    }
  }
  if (numbered.length === 24) {
    return numbered;
  }

  // 3. Remove known boilerplate headers/footers if text contains file metadata
  let cleaned = input;
  if (/sealbook/i.test(cleaned) || /keep this file/i.test(cleaned) || /recovery words/i.test(cleaned)) {
    cleaned = cleaned
      .replace(/Sealbook Recovery Words/gi, " ")
      .replace(/={3,}/g, " ")
      .replace(/Keep this file safe and secret\.?/gi, " ")
      .replace(/Raw phrase:?/gi, " ");
  }

  // Remove line number prefixes (e.g. " 1. ", "24. ", "1) ")
  cleaned = cleaned.replace(/(?:^|\s)\d+[-.:)]\s*/g, " ");

  // Extract all pure word tokens
  const words = cleaned
    .toLowerCase()
    .split(/[^a-z]+/u)
    .filter(Boolean);

  if (words.length === 24) {
    return words;
  }

  // If numbered list had items (e.g. user typed or pasted partial numbered words)
  if (numbered.length > 0 && numbered.length >= words.length / 2) {
    return numbered;
  }

  return words;
}

/**
 * Returns a normalized space-separated recovery phrase from any format.
 */
export function cleanRecoveryPhrase(input: string): string {
  const words = extractRecoveryWords(input);
  return words.join(" ");
}

/**
 * Formats 24 recovery words into a readable text document for download,
 * including numbered list and a raw phrase row for copy-paste convenience.
 */
export function formatRecoveryWordsFile(words: string[]): string {
  const lines = words.map((w, i) => `${String(i + 1).padStart(2, " ")}. ${w}`);
  return [
    "Sealbook Recovery Words",
    "========================",
    "",
    ...lines,
    "",
    "Raw phrase:",
    words.join(" "),
    "",
    "Keep this file safe and secret.",
    "",
  ].join("\n");
}
