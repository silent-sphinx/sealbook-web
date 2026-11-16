import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { b64encode } from "./bytes";
import { DEVICE_STORAGE_KEY, deriveStorageKey, loadDevice, saveDevice } from "./storage";
import type { DeviceState } from "./types";
import { localStorageKdf } from "./wasm";

const stored: Record<string, string> = {};

const state: DeviceState = {
  server: "https://vault.example.com",
  username: "ada",
  account_id: "00000000-0000-0000-0000-0000000000a1",
  collection_id: "00000000-0000-0000-0000-0000000000c1",
  device_id: "00000000-0000-0000-0000-0000000000d1",
  kdf_salt: "AAAA",
  hpke_sk: "BBBB",
  mldsa_seed: "CCCC",
  ed25519_sk: "DDDD",
};

beforeEach(() => {
  for (const key of Object.keys(stored)) delete stored[key];
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => {
      stored[key] = value;
    },
    removeItem: (key: string) => delete stored[key],
  };
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

/** A record as a build before Argon2id wrote it: PBKDF2, no suite, no binding. */
async function writeLegacyRecord(password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveStorageKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(state)),
  );
  const { server, username, account_id, collection_id, device_id } = state;
  stored[DEVICE_STORAGE_KEY] = JSON.stringify({
    version: 1,
    metadata: { server, username, account_id, collection_id, device_id },
    salt: b64encode(salt),
    iv: b64encode(iv),
    ciphertext: b64encode(new Uint8Array(ciphertext)),
  });
}

describe("the device record's key stretching", () => {
  it("is written under Argon2id and opens with the right password only", async () => {
    await saveDevice(state, "correct horse battery");
    expect(JSON.parse(stored[DEVICE_STORAGE_KEY]).kdf).toBe(localStorageKdf());

    expect(await loadDevice("correct horse battery")).toEqual(state);
    expect(await loadDevice("wrong horse battery")).toBeNull();
  });

  it("still opens a record made under PBKDF2, and re-saves it under Argon2id", async () => {
    await writeLegacyRecord("correct horse battery");
    expect(JSON.parse(stored[DEVICE_STORAGE_KEY]).kdf).toBeUndefined();

    expect(await loadDevice("correct horse battery")).toEqual(state);

    expect(JSON.parse(stored[DEVICE_STORAGE_KEY]).kdf).toBe(localStorageKdf());
    expect(await loadDevice("correct horse battery")).toEqual(state);
  });

  it("leaves an older record alone when the password is wrong", async () => {
    await writeLegacyRecord("correct horse battery");
    const before = stored[DEVICE_STORAGE_KEY];
    expect(await loadDevice("wrong horse battery")).toBeNull();
    expect(stored[DEVICE_STORAGE_KEY]).toBe(before);
  });

  it("refuses a record whose metadata was swapped for another server's", async () => {
    await saveDevice(state, "correct horse battery");
    const envelope = JSON.parse(stored[DEVICE_STORAGE_KEY]);
    envelope.metadata.server = "https://evil.example.com";
    stored[DEVICE_STORAGE_KEY] = JSON.stringify(envelope);

    expect(await loadDevice("correct horse battery")).toBeNull();
  });

  it("refuses a record that had its suite stripped to force the old key", async () => {
    await saveDevice(state, "correct horse battery");
    const envelope = JSON.parse(stored[DEVICE_STORAGE_KEY]);
    delete envelope.kdf;
    stored[DEVICE_STORAGE_KEY] = JSON.stringify(envelope);

    expect(await loadDevice("correct horse battery")).toBeNull();
  });
});
