/**
 * The wire protocol generation this build speaks.
 *
 * Mirrors `PROTOCOL_VERSION` and `SUPPORTED_PROTOCOL_VERSIONS` in
 * `sealbook/crates/sealbook-protocol/src/version.rs`. There is no codegen
 * between the two, so the pairing is covered by a test rather than by the
 * compiler.
 */
export const PROTOCOL_VERSION = "sealbook-v1";

/** The generations this build can talk to. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [PROTOCOL_VERSION];

export function speaksProtocol(reported: unknown): boolean {
  return typeof reported === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(reported);
}
