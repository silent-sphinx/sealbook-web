/**
 * Shared protocol fixtures.
 *
 * They live in the sibling sealbook checkout, under
 * `crates/sealbook-protocol/fixtures/`, so the Rust, TypeScript and Kotlin
 * tests assert against one document rather than three copies that drift. The
 * checkout is already required to build `src/pkg`, so this adds no new
 * dependency to the suite.
 */
import { readFileSync } from "node:fs";

const root = new URL(
  "../../../sealbook/crates/sealbook-protocol/fixtures/",
  import.meta.url,
);

export function readFixture(name: string): string {
  const path = new URL(name, root);
  try {
    return new TextDecoder().decode(readFileSync(path));
  } catch {
    throw new Error(
      `missing shared fixture ${name} at ${path.pathname}. Check out sealbook beside this repo.`,
    );
  }
}
