/**
 * Payload schema versioning, and carrying unrecognised fields through an edit.
 *
 * Mirrors `version` in `sealbook/crates/sealbook-protocol/src/version.rs`. There
 * is no codegen between the two, so the pairing is covered by a test.
 */

export const PAYLOAD_SCHEMA_VERSION = "1.0";

/**
 * Whether a payload declaring `version` can be read by this build.
 *
 * Any minor within this major is readable, since a minor bump may only add a
 * field an older reader can leave alone. A missing or unparsable version is
 * readable too: every field is optional, so the parse degrades rather than
 * refusing. A newer major is not, because that is the case where a field this
 * build does understand may have changed meaning.
 */
export function payloadSchemaReadable(declared: unknown): boolean {
  if (typeof declared !== "string") return true;
  const major = Number.parseInt(declared.split(".")[0] ?? "", 10);
  if (Number.isNaN(major)) return true;
  return major <= Number.parseInt(PAYLOAD_SCHEMA_VERSION.split(".")[0], 10);
}

/**
 * Serialises a payload, carrying through any field of `previousRaw` that this
 * build does not own.
 *
 * `owned` is every key this build manages, not just the ones it is writing this
 * time. The difference matters: a serialiser omits an empty optional field
 * rather than writing null, so deriving the set from `fields` would carry the
 * previous value of a field the user has just cleared back in and resurrect it.
 *
 * Without this, a field written by a newer client is destroyed the first time an
 * older one saves over it, which is silent data loss rather than a version
 * error anyone would see.
 */
export function mergePayload(
  previousRaw: string | undefined,
  fields: Record<string, unknown>,
  owned: readonly string[],
): string {
  return JSON.stringify({ ...carriedFields(previousRaw, owned), ...fields });
}

function carriedFields(
  previousRaw: string | undefined,
  owned: readonly string[],
): Record<string, unknown> {
  if (!previousRaw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(previousRaw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const ours = new Set(owned);
  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!ours.has(key)) carried[key] = value;
  }
  return carried;
}
