import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeLocalStore,
  emptyVault,
  EMPTY_OUTBOX,
  loadLocalVault,
  openLocalStore,
  rekeyLocalStore,
  OutboxStorageError,
  saveLocalVault,
  saveOutbox,
} from "./localStore";
import { idbGet, idbPut } from "./idb";
import { b64encode } from "./bytes";
import { coreLocalVaultWrite } from "./wasm";
import { DEVICE_STORAGE_KEY, deriveStorageKey, STORE_SALT_KEY } from "./storage";

const stored: Record<string, string> = {};

beforeEach(() => {
  for (const key of Object.keys(stored)) delete stored[key];
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => {
      stored[key] = value;
    },
    removeItem: (key: string) => delete stored[key],
  };
  globalThis.indexedDB = new IDBFactory();
  stored[DEVICE_STORAGE_KEY] = "{}";
});

afterEach(() => {
  closeLocalStore();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("the local store after another tab signed out", () => {
  it("stores the vault copy and the outbox while the device is enrolled", async () => {
    openLocalStore("correct horse");
    expect(await saveLocalVault(emptyVault())).toBe(true);
    await saveOutbox(EMPTY_OUTBOX);
    expect(await loadLocalVault()).not.toBeNull();
  });

  it("writes neither once the device record is gone", async () => {
    openLocalStore("correct horse");
    delete stored[DEVICE_STORAGE_KEY];
    expect(await saveLocalVault(emptyVault())).toBe(false);
    await expect(saveOutbox(EMPTY_OUTBOX)).rejects.toBeInstanceOf(OutboxStorageError);
    expect(await loadLocalVault()).toBeNull();
  });
});

describe("the local store's key stretching", () => {
  it("reads a copy sealed under PBKDF2 and writes the next one under Argon2id", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await deriveStorageKey("correct horse", salt),
      new TextEncoder().encode(coreLocalVaultWrite(emptyVault())),
    );
    await idbPut("local-vault", {
      version: 1,
      salt: b64encode(salt),
      iv: b64encode(iv),
      ciphertext: b64encode(new Uint8Array(ciphertext)),
    });

    openLocalStore("correct horse");
    expect(await loadLocalVault()).not.toBeNull();

    expect(await saveLocalVault(emptyVault())).toBe(true);
    const rewritten = await idbGet<{ kdf?: string }>("local-vault");
    expect(rewritten?.kdf).toMatch(/^argon2id-/u);
    expect(await loadLocalVault()).not.toBeNull();
  });
});

async function reopen(password: string) {
  closeLocalStore();
  openLocalStore(password);
}

describe("the local store without the password", () => {
  it("opens again under the same password and not under another", async () => {
    openLocalStore("correct horse");
    expect(await saveLocalVault(emptyVault())).toBe(true);

    await reopen("correct horse");
    expect(await loadLocalVault()).not.toBeNull();

    await reopen("wrong horse");
    expect(await loadLocalVault()).toBeNull();
  });

  it("writes under one salt that its tabs share, rather than one each", async () => {
    openLocalStore("correct horse");
    await saveLocalVault(emptyVault());
    const first = stored[STORE_SALT_KEY];
    expect(first).toBeDefined();

    await reopen("correct horse");
    await saveLocalVault(emptyVault());
    expect(stored[STORE_SALT_KEY]).toBe(first);
    expect((await idbGet<{ salt: string }>("local-vault"))?.salt).toBe(first);
  });

  it("does not write a record nothing can open when the vault locks mid-save", async () => {
    openLocalStore("correct horse");
    await saveLocalVault(emptyVault());

    const saving = saveOutbox(EMPTY_OUTBOX);
    closeLocalStore();
    await saving.catch(() => undefined);

    const record = await idbGet<{ salt?: string | null }>("outbox");
    if (record) expect(typeof record.salt).toBe("string");
  });

  it("re-seals the copy for a changed password, which then opens and the old one does not", async () => {
    openLocalStore("old password!!");
    await saveLocalVault(emptyVault());
    await saveOutbox(EMPTY_OUTBOX);

    await rekeyLocalStore("new password!!");
    await reopen("new password!!");
    expect(await loadLocalVault()).not.toBeNull();

    await reopen("old password!!");
    expect(await loadLocalVault()).toBeNull();
  });
});
