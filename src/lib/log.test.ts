import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeError,
  elapsed,
  formatFields,
  getLogLevel,
  log,
  logPath,
  serverHost,
  setLogLevel,
} from "./log";

afterEach(() => {
  setLogLevel("silent");
  vi.restoreAllMocks();
});

describe("formatFields", () => {
  it("renders scalars as key=value, in order", () => {
    expect(formatFields({ method: "GET", status: 200, ok: true })).toBe(
      " method=GET status=200 ok=true",
    );
  });

  it("drops undefined so an optional field leaves no empty pair", () => {
    expect(formatFields({ a: 1, b: undefined })).toBe(" a=1");
  });

  it("renders nothing for no fields", () => {
    expect(formatFields()).toBe("");
    expect(formatFields({})).toBe("");
  });
});

describe("logPath", () => {
  it("replaces the collection id and drops the query", () => {
    expect(
      logPath(
        "https://vault.example.com/v1/collections/8f1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d" +
          "/changes?after=0&limit=500",
      ),
    ).toBe("/v1/collections/:id/changes");
  });

  it("handles a same-origin path", () => {
    expect(logPath("/v1/opaque/login/start")).toBe("/v1/opaque/login/start");
  });

  it("replaces an opaque identifier that is not a uuid", () => {
    // Pair codes and object ids are not all uuids, and a long segment is never
    // something worth printing.
    const code = "a".repeat(48);
    expect(logPath(`/v1/pair/${code}/ready`)).toBe("/v1/pair/:id/ready");
  });
});

describe("serverHost", () => {
  it("keeps the host and port", () => {
    expect(serverHost("https://vault.example.com:8443/base")).toBe("vault.example.com:8443");
  });

  it("does not echo an unparsable address back", () => {
    expect(serverHost("not a url")).toBe("invalid");
  });
});

describe("describeError", () => {
  it("names a subclass", () => {
    const err = new Error("served nothing signed");
    err.name = "ManifestError";
    expect(describeError(err)).toBe("ManifestError: served nothing signed");
  });

  it("leaves a plain error as its message", () => {
    expect(describeError(new Error("Failed to fetch"))).toBe("Failed to fetch");
  });

  it("stringifies a thrown non-error", () => {
    expect(describeError("nope")).toBe("nope");
  });
});

describe("levels", () => {
  it("silences everything below the level in force", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const write = vi.spyOn(console, "log").mockImplementation(() => {});
    setLogLevel("warn");
    log.info("not shown");
    log.debug("not shown");
    log.warn("shown");
    expect(write).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("writes below a warning through console.log, which is not filtered by default", () => {
    const write = vi.spyOn(console, "log").mockImplementation(() => {});
    setLogLevel("debug");
    log.debug("walked the change log", { pages: 2 });
    expect(write).toHaveBeenCalledWith(
      "%csealbook%c walked the change log pages=2",
      expect.any(String),
      "",
    );
  });

  it("passes a cause through as its own argument, so the console keeps the stack", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("boom");
    setLogLevel("error");
    log.error("request did not reach the server", { method: "GET" }, cause);
    expect(error).toHaveBeenCalledWith(
      "%csealbook%c request did not reach the server method=GET",
      expect.any(String),
      "",
      cause,
    );
  });

  it("reports what is enabled, so a caller can skip assembling fields", () => {
    setLogLevel("info");
    expect(getLogLevel()).toBe("info");
    expect(log.enabled("info")).toBe(true);
    expect(log.enabled("debug")).toBe(false);
  });
});

describe("elapsed", () => {
  it("rounds to whole milliseconds", () => {
    expect(elapsed(performance.now())).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(elapsed(performance.now()))).toBe(true);
  });
});
