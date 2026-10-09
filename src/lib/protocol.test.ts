import { afterEach, describe, expect, it, vi } from "vitest";

import { pairJoin } from "./client";
import { PROTOCOL_VERSION, speaksProtocol } from "./protocol";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers `/health/crypto` with `protocol`, and refuses every other route. */
function serverSpeaking(protocol: unknown) {
  const reached: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const { pathname } = new URL(input);
      reached.push(pathname);
      if (!pathname.endsWith("/health/crypto")) {
        throw new Error(`should not have been reached: ${pathname}`);
      }
      return new Response(JSON.stringify(protocol === undefined ? {} : { protocol }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return reached;
}

describe("speaksProtocol", () => {
  it("accepts this build's own generation", () => {
    expect(speaksProtocol(PROTOCOL_VERSION)).toBe(true);
  });

  it("refuses anything else, including a missing version", () => {
    expect(speaksProtocol("sealbook-v2")).toBe(false);
    expect(speaksProtocol("")).toBe(false);
    expect(speaksProtocol(undefined)).toBe(false);
    expect(speaksProtocol(null)).toBe(false);
    expect(speaksProtocol(1)).toBe(false);
  });
});

describe("a flow that reaches a server speaking another generation", () => {
  it("stops before sending anything, naming both versions", async () => {
    const reached = serverSpeaking("sealbook-v2");
    await expect(pairJoin("https://vault.example", "ada")).rejects.toThrow(
      /sealbook-v2.*sealbook-v1|sealbook-v1.*sealbook-v2/u,
    );
    // The point of checking first: no device key, username or enrollment has
    // left this machine by the time the mismatch is known.
    expect(reached).toEqual(["/health/crypto"]);
  });

  it("stops when the server reports no version at all", async () => {
    serverSpeaking(undefined);
    await expect(pairJoin("https://vault.example", "ada")).rejects.toThrow(/unknown version/u);
  });
});
