const MAX_TAGS = 32;

/**
 * Trimmed, de-duplicated case-insensitively, and capped.
 *
 * Anything that is not an array of strings reads as no tags: the field is the
 * one place a payload carries a container, so a malformed one must not reach the
 * renderer as an object.
 */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

export type TagEntry = { key: string; name: string; count: number };

/**
 * Every tag across `tagSets`, keyed by lowercase so "Rust" and "rust" are one
 * tag, as `normalizeTags` treats them. The first spelling seen wins.
 */
export function tagVocabulary(tagSets: Iterable<readonly string[] | undefined>): TagEntry[] {
  const found = new Map<string, TagEntry>();
  for (const tags of tagSets) {
    for (const tag of tags ?? []) {
      const key = tag.toLowerCase();
      const entry = found.get(key);
      if (entry) entry.count += 1;
      else found.set(key, { key, name: tag, count: 1 });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The spelling a tag was first saved with, so "Rust" never sits beside "rust". */
export function canonicalTag(vocabulary: readonly TagEntry[], tag: string): string {
  const trimmed = tag.trim();
  return vocabulary.find((known) => known.key === trimmed.toLowerCase())?.name ?? trimmed;
}

/** Whether `tags` holds the tag with this lowercase `key`. */
export function hasTag(tags: readonly string[] | undefined, key: string): boolean {
  return tags?.some((tag) => tag.toLowerCase() === key) ?? false;
}
