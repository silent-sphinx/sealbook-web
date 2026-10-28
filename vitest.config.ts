import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors the build-time define in `vite.config.ts`.
  define: {
    __APP_VERSION__: JSON.stringify("test"),
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // Core is behind the note payload layer as of phase 8, so wasm has to be up
    // before any suite imports `note.ts`. See `src/test/wasm.ts`.
    setupFiles: ["src/test/wasm.ts"],
    // No global `environment`: the lib suites run under node, and the
    // component suites opt into jsdom with a `@vitest-environment` docblock.
    // Making jsdom global would put every pure-logic suite behind a DOM it
    // does not use, and would change the globals those suites run against.

    // Date handling is a real source of bugs here, and several helpers convert
    // between a named zone and the host's local time. Pinning the host zone
    // keeps runs identical on a laptop and in CI; the suites that care about
    // cross-zone behaviour pass the zone explicitly.
    env: { TZ: "Europe/London" },

    // Above the component suites' `asyncUtilTimeout` (`src/test/dom.ts`), so a
    // wait that is never going to pass is reported by the query that gave up
    // rather than by the test running out of time around it. A test that holds
    // several such waits needs the room for all of them.
    testTimeout: 20_000,
  },
});
