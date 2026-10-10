import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors the build-time define in `vite.config.ts`.
  define: {
    __APP_VERSION__: JSON.stringify("test"),
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // No global `environment`: the lib suites run under node, and the
    // component suites opt into jsdom with a `@vitest-environment` docblock.
    // Making jsdom global would put every pure-logic suite behind a DOM it
    // does not use, and would change the globals those suites run against.

    // Date handling is a real source of bugs here, and several helpers convert
    // between a named zone and the host's local time. Pinning the host zone
    // keeps runs identical on a laptop and in CI; the suites that care about
    // cross-zone behaviour pass the zone explicitly.
    env: { TZ: "Europe/London" },
  },
});
