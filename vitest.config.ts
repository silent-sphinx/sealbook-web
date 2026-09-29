import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Date handling is a real source of bugs here, and several helpers convert
    // between a named zone and the host's local time. Pinning the host zone
    // keeps runs identical on a laptop and in CI; the suites that care about
    // cross-zone behaviour pass the zone explicitly.
    env: { TZ: "Europe/London" },
  },
});
