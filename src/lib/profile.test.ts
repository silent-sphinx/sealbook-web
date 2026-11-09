import { afterEach, describe, expect, it, vi } from "vitest";

import { pairJoin } from "./client";
import { checkProtocol } from "./clientCore";
import {
  evaluateCryptoProfile,
  hasFatal,
  HPKE_CIPHERSUITE,
  OBJECT_AEAD,
  OPAQUE_KSF,
  PHRASE_SCHEME,
  RECOVERY_CIPHERSUITE,
  SIGNATURE_ALGORITHMS,
  TLS_KX,
  TLS_VERSION,
  type CryptoProfile,
} from "./profile";
import { PROTOCOL_VERSION } from "./protocol";
import { saveServerPosture } from "./storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The profile the server actually serves: every check passes. */
function good(): CryptoProfile {
  return {
    protocol: PROTOCOL_VERSION,
    tls_version: TLS_VERSION,
    tls_kx_preferred: TLS_KX,
    tls_kx_pq_required: true,
    hpke_ciphersuite: HPKE_CIPHERSUITE,
    signature_algorithms: [...SIGNATURE_ALGORITHMS],
    object_aead: OBJECT_AEAD,
    phrase_recovery_scheme: PHRASE_SCHEME,
    recovery_ciphersuite: RECOVERY_CIPHERSUITE,
    opaque_ksf: OPAQUE_KSF,
    opaque_requires_device_proof: true,
  };
}

describe("evaluateCryptoProfile", () => {
  it("passes the real profile on every client", () => {
    expect(evaluateCryptoProfile(good(), "browser")).toEqual([]);
    expect(evaluateCryptoProfile(good(), "native")).toEqual([]);
  });

  it("is fatal on a different object AEAD", () => {
    const p = { ...good(), object_aead: "AES-256-GCM" };
    expect(hasFatal(evaluateCryptoProfile(p, "browser"))).toBe(true);
  });

  it("is fatal on a weaker password KDF", () => {
    const p = { ...good(), opaque_ksf: "argon2id-m16384-t1-p1" };
    expect(hasFatal(evaluateCryptoProfile(p, "browser"))).toBe(true);
  });

  it("blocks a missing post-quantum requirement on native but only warns in the browser", () => {
    const p = { ...good(), tls_kx_pq_required: false };
    expect(hasFatal(evaluateCryptoProfile(p, "native"))).toBe(true);
    const browser = evaluateCryptoProfile(p, "browser");
    expect(hasFatal(browser)).toBe(false);
    expect(browser.some((f) => f.field === "pq_required")).toBe(true);
  });

  it("is fatal when a pinned post-quantum requirement is dropped, even in the browser", () => {
    const p = { ...good(), tls_kx_pq_required: false };
    const pinned = { tls_kx_pq_required: true, opaque_requires_device_proof: true };
    expect(hasFatal(evaluateCryptoProfile(p, "browser", pinned))).toBe(true);
  });

  it("warns on a looser device-proof policy and a missing field", () => {
    const loose = { ...good(), opaque_requires_device_proof: false };
    const v = evaluateCryptoProfile(loose, "browser");
    expect(hasFatal(v)).toBe(false);
    expect(v.some((f) => f.field === "device_proof")).toBe(true);

    const missing = { ...good(), opaque_ksf: undefined };
    const w = evaluateCryptoProfile(missing, "browser");
    expect(hasFatal(w)).toBe(false);
    expect(w.some((f) => f.field === "opaque_ksf" && f.reported === "absent")).toBe(true);
  });
});

/** Serves `profile` at `/health/crypto`, and refuses every other route. */
function serverWithProfile(profile: CryptoProfile) {
  const reached: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const { pathname } = new URL(input);
      reached.push(pathname);
      if (!pathname.endsWith("/health/crypto")) {
        throw new Error(`should not have been reached: ${pathname}`);
      }
      return new Response(JSON.stringify(profile), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return reached;
}

describe("a flow that reaches a server with a weakened profile", () => {
  it("stops before sending anything", async () => {
    const reached = serverWithProfile({ ...good(), object_aead: "AES-256-GCM" });
    await expect(pairJoin("https://vault.example", "ada")).rejects.toThrow(/XChaCha20-Poly1305/u);
    // Refused on the profile alone: no device key or username has left the machine.
    expect(reached).toEqual(["/health/crypto"]);
  });
});

describe("checkProtocol against a pinned posture", () => {
  const stored: Record<string, string> = {};

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    for (const key of Object.keys(stored)) delete stored[key];
  });

  function stubStorage() {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => stored[key] ?? null,
      setItem: (key: string, value: string) => {
        stored[key] = value;
      },
      removeItem: (key: string) => delete stored[key],
    };
  }

  const root = "https://vault.example";

  it("warns but does not block a looser device proof on a first visit", async () => {
    stubStorage();
    serverWithProfile({ ...good(), opaque_requires_device_proof: false });
    const posture = await checkProtocol(root);
    expect(posture.opaque_requires_device_proof).toBe(false);
  });

  it("refuses the same looser profile once the stronger one is pinned", async () => {
    stubStorage();
    saveServerPosture(root, { tls_kx_pq_required: true, opaque_requires_device_proof: true });
    const reached = serverWithProfile({ ...good(), opaque_requires_device_proof: false });
    await expect(checkProtocol(root)).rejects.toThrow(/previously required/u);
    // The profile fetch is all that happened: the sign-in never started.
    expect(reached).toEqual(["/health/crypto"]);
  });

  it("re-accepts a profile that matches the pin", async () => {
    stubStorage();
    saveServerPosture(root, { tls_kx_pq_required: true, opaque_requires_device_proof: true });
    serverWithProfile(good());
    const posture = await checkProtocol(root);
    expect(posture).toEqual({ tls_kx_pq_required: true, opaque_requires_device_proof: true });
  });
});
