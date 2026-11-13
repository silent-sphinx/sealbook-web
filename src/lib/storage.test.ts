import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { friendlyError } from "./errors";
import { idbGetAttachment, idbPutAttachment } from "./idb";
import {
  ACCENT_HINT_KEY,
  ATTACHMENT_CACHE_SALT_KEY,
  clearDevice,
  DeviceStorageError,
  loadServerPosture,
  saveDevice,
  saveServerPosture,
} from "./storage";
import type { DeviceState } from "./types";

describe("saveDevice", () => {
  const stored: Record<string, string> = {};

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  function stubStorage(setItem: (key: string, value: string) => void) {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => stored[key] ?? null,
      setItem,
      removeItem: (key: string) => delete stored[key],
    };
  }

  const state: DeviceState = {
    server: "https://vault.example.com",
    username: "ada",
    account_id: "00000000-0000-0000-0000-0000000000a1",
    collection_id: "00000000-0000-0000-0000-0000000000c1",
    device_id: "00000000-0000-0000-0000-0000000000d1",
    session_token: "secret-token",
    kdf_salt: "AAAA",
    hpke_sk: "BBBB",
    mldsa_seed: "CCCC",
    ed25519_sk: "DDDD",
  };

  it("names the cause when the storage area refuses the write", async () => {
    stubStorage(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const err = await saveDevice(state, "pw").catch((caught: unknown) => caught);
    expect(err).toBeInstanceOf(DeviceStorageError);
    // Reaches the user as written rather than as "Something went wrong".
    expect(friendlyError(err)).toMatch(/would not store this device's key/u);
  });

  it("writes an envelope that does not hold the session token", async () => {
    let written = "";
    stubStorage((_key, value) => {
      written = value;
    });
    await saveDevice(state, "pw");
    expect(written).not.toContain("secret-token");
    expect(JSON.parse(written)).toMatchObject({ metadata: { username: "ada" } });
  });
});

describe("server posture", () => {
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

  it("has no pin for a server not seen before", () => {
    stubStorage();
    expect(loadServerPosture("https://vault.example")).toBeNull();
  });

  it("round-trips a pin and keeps servers apart", () => {
    stubStorage();
    saveServerPosture("https://a.example", {
      tls_kx_pq_required: true,
      opaque_requires_device_proof: true,
    });
    saveServerPosture("https://b.example", {
      tls_kx_pq_required: false,
      opaque_requires_device_proof: true,
    });
    expect(loadServerPosture("https://a.example")).toEqual({
      tls_kx_pq_required: true,
      opaque_requires_device_proof: true,
    });
    expect(loadServerPosture("https://b.example")?.tls_kx_pq_required).toBe(false);
    expect(loadServerPosture("https://c.example")).toBeNull();
  });

  it("does not throw when the storage area refuses the write", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("site data is blocked");
      },
      removeItem: () => undefined,
    };
    expect(() =>
      saveServerPosture("https://vault.example", {
        tls_kx_pq_required: true,
        opaque_requires_device_proof: true,
      }),
    ).not.toThrow();
  });
});

describe("clearDevice", () => {
  const stored: Record<string, string> = {};

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    globalThis.indexedDB = new IDBFactory();
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

  it("empties the attachment cache, which sign-out left on disk", async () => {
    stubStorage();
    stored["sealbook.device"] = "{}";
    stored[ATTACHMENT_CACHE_SALT_KEY] = "AAAA";
    stored[ACCENT_HINT_KEY] = "rose";
    await idbPutAttachment("a", {
      version: 1,
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(8),
      bytes: 8,
      lastUsed: 1,
    });

    await clearDevice();

    expect(await idbGetAttachment("a")).toBeNull();
    expect(stored["sealbook.device"]).toBeUndefined();
    expect(stored[ATTACHMENT_CACHE_SALT_KEY]).toBeUndefined();
    expect(stored[ACCENT_HINT_KEY]).toBeUndefined();
  });

  it("still empties the stores when the storage area throws", async () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new DOMException("site data is blocked");
      },
    };
    await idbPutAttachment("a", {
      version: 1,
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(8),
      bytes: 8,
      lastUsed: 1,
    });

    await expect(clearDevice()).resolves.toBeUndefined();
    expect(await idbGetAttachment("a")).toBeNull();
  });
});
