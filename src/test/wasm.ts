/**
 * Instantiates the wasm module for every suite, before any of them run.
 *
 * Registered as a vitest `setupFiles` entry rather than called per suite. Until
 * phase 8 of the client unification only the parity suites reached into core, so
 * each did its own `beforeAll`. Now `note.ts` writes and reads a payload through
 * core, which puts wasm behind the note helpers, the note tree, the export and
 * import paths, the offline vault and the component suites that drive any of
 * them. Initialising once here is cheaper than a `beforeAll` in each, and it
 * means a suite that starts using a core function does not fail on a missing
 * module with nothing to point at.
 *
 * The browser build fetches the module over HTTP; there is no fetch for a file
 * URL here, so the bytes are read off disk and passed in. The path is resolved
 * from the working directory rather than from `import.meta.url`, because under
 * the jsdom environment that URL is an `http:` one and `readFileSync` refuses
 * it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import init from "../pkg/sealbook_wasm.js";

await init({
  module_or_path: readFileSync(resolve(process.cwd(), "src/pkg/sealbook_wasm_bg.wasm")),
});
