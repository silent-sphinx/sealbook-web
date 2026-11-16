import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ATTACHMENT_CACHE_BUDGET,
  closeAttachmentCache,
  forgetCachedAttachment,
  MAX_CACHED_ATTACHMENT_SIZE,
  primeAttachmentCache,
  readCachedAttachment,
  staleEntries,
  writeCachedAttachment,
} from "./attachmentCache";
import { idbAttachmentIndex, idbGetAttachment, idbPutAttachment } from "./idb";
import { ATTACHMENT_CACHE_SALT_KEY, DEVICE_STORAGE_KEY } from "./storage";
import type { NoteAttachment } from "./types";

function reference(id: string): NoteAttachment {
  return {
    id,
    filename: `${id}.jpg`,
    mimeType: "image/jpeg",
    byteSize: 8,
    adk: "k",
    contentHash: "h",
    chunkSize: 4,
    chunkCount: 1,
  };
}

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
  // The cache only writes for an enrolled device.
  stored[DEVICE_STORAGE_KEY] = "{}";
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  closeAttachmentCache();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("the attachment cache", () => {
  it("gives back what was cached", async () => {
    primeAttachmentCache("correct horse");
    await writeCachedAttachment("a", new Blob(["a photo"], { type: "image/jpeg" }));
    const cached = await readCachedAttachment(reference("a"));
    expect(await cached?.text()).toBe("a photo");
    // Rebuilt from the reference, so the store holds no mime type of its own.
    expect(cached?.type).toBe("image/jpeg");
  });

  it("writes nothing readable to the store", async () => {
    // The fault this cache replaces: plaintext blobs left on disk after
    // sign-out. The bytes at rest must not hold the file.
    primeAttachmentCache("correct horse");
    await writeCachedAttachment("a", new Blob(["a secret photo"]));
    const record = await idbGetAttachment("a");
    expect(record).not.toBeNull();
    const atRest = new TextDecoder().decode(record!.ciphertext);
    expect(atRest).not.toContain("secret");
    expect(record!.bytes).toBe("a secret photo".length);
  });

  it("caches the download that follows a miss", async () => {
    // The key is started by the miss rather than waited on, so the write after
    // the download has to find it ready.
    primeAttachmentCache("correct horse");
    expect(await readCachedAttachment(reference("a"))).toBeNull();
    await writeCachedAttachment("a", new Blob(["a photo"]));
    expect(await (await readCachedAttachment(reference("a")))?.text()).toBe("a photo");
  });

  it("caches nothing once another tab has signed this device out", async () => {
    primeAttachmentCache("correct horse");
    delete stored[DEVICE_STORAGE_KEY];
    await writeCachedAttachment("a", new Blob(["a photo"]));
    expect(await idbGetAttachment("a")).toBeNull();
    expect(stored[ATTACHMENT_CACHE_SALT_KEY]).toBeUndefined();
  });

  it("reads nothing while the cache is closed", async () => {
    primeAttachmentCache("correct horse");
    await writeCachedAttachment("a", new Blob(["a photo"]));
    closeAttachmentCache();
    expect(await readCachedAttachment(reference("a"))).toBeNull();
  });

  it("caches nothing while the cache is closed", async () => {
    closeAttachmentCache();
    await writeCachedAttachment("a", new Blob(["a photo"]));
    expect(await idbGetAttachment("a")).toBeNull();
  });

  it("drops an entry it can no longer decrypt", async () => {
    // What a changed password leaves behind. The entry is dead weight against
    // the budget, so the read that finds it removes it.
    primeAttachmentCache("correct horse");
    await writeCachedAttachment("a", new Blob(["a photo"]));
    primeAttachmentCache("another password");
    expect(await readCachedAttachment(reference("a"))).toBeNull();
    expect(await idbGetAttachment("a")).toBeNull();
    expect(await idbAttachmentIndex()).toEqual([]);
  });

  it("refuses an entry bound to another attachment id", async () => {
    primeAttachmentCache("correct horse");
    await writeCachedAttachment("a", new Blob(["a photo"]));
    const record = await idbGetAttachment("a");
    await idbPutAttachment("b", record!);
    expect(await readCachedAttachment(reference("b"))).toBeNull();
  });

  it("does not cache a file larger than one entry may be", async () => {
    primeAttachmentCache("correct horse");
    const big = new Blob([new Uint8Array(MAX_CACHED_ATTACHMENT_SIZE + 1)]);
    await writeCachedAttachment("big", big);
    expect(await idbGetAttachment("big")).toBeNull();
  });

  it("forgets one entry without touching the others", async () => {
    primeAttachmentCache("correct horse");
    await writeCachedAttachment("a", new Blob(["one"]));
    await writeCachedAttachment("b", new Blob(["two"]));
    await forgetCachedAttachment("a");
    expect(await idbGetAttachment("a")).toBeNull();
    expect(await idbGetAttachment("b")).not.toBeNull();
    expect((await idbAttachmentIndex()).map((row) => row.id)).toEqual(["b"]);
  });

  it("keeps the cache key across a reload, since the salt is stored", async () => {
    primeAttachmentCache("correct horse");
    await writeCachedAttachment("a", new Blob(["a photo"]));
    closeAttachmentCache();
    // A later session derives the same key from the same password and salt.
    primeAttachmentCache("correct horse");
    expect(await (await readCachedAttachment(reference("a")))?.text()).toBe("a photo");
  });
});

describe("the cache budget", () => {
  // The pure half of eviction, so the order can be asserted without writing
  // tens of megabytes through AES-GCM.
  const mb = 1024 * 1024;

  it("keeps everything while the budget is not reached", () => {
    const index = [
      { id: "a", bytes: mb, lastUsed: 1 },
      { id: "b", bytes: mb, lastUsed: 2 },
    ];
    expect(staleEntries(index, "c", mb)).toEqual([]);
  });

  it("drops the least recently used first, and only as many as it must", () => {
    const index = [
      { id: "old", bytes: 4, lastUsed: 1 },
      { id: "older", bytes: 4, lastUsed: 0 },
      { id: "new", bytes: 4, lastUsed: 9 },
    ];
    expect(staleEntries(index, "next", 4, 12)).toEqual(["older"]);
    expect(staleEntries(index, "next", 8, 12)).toEqual(["older", "old"]);
  });

  it("does not count the entry being replaced against the budget", () => {
    const index = [
      { id: "a", bytes: 8, lastUsed: 1 },
      { id: "b", bytes: 4, lastUsed: 2 },
    ];
    expect(staleEntries(index, "a", 8, 12)).toEqual([]);
  });

  it("is a budget a single entry cannot fill", () => {
    expect(MAX_CACHED_ATTACHMENT_SIZE).toBeLessThan(ATTACHMENT_CACHE_BUDGET);
  });
});
