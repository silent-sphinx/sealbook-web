import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import {
  idbAttachmentIndex,
  idbClearAttachments,
  idbDelete,
  idbDeleteAttachments,
  idbGet,
  idbGetAttachment,
  idbPut,
  idbPutAttachment,
  idbTouchAttachment,
  type CachedAttachment,
} from "./idb";

afterEach(() => {
  // A fresh database per test, so one test's rows are never another's.
  globalThis.indexedDB = new IDBFactory();
});

/**
 * An open request that reports the given outcome and nothing else.
 *
 * The handlers are assigned synchronously by `idb.ts` inside its promise
 * executor, so the event is queued as a microtask to land after them.
 */
type FakeRequest = {
  onupgradeneeded: (() => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
  error: DOMException | null;
};

function factoryFiring(event: "onerror" | "onblocked"): IDBFactory {
  return {
    open: () => {
      const request: FakeRequest = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        error: new DOMException("unavailable"),
      };
      queueMicrotask(() => request[event]?.());
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

describe("the offline store", () => {
  it("gives back what was put in", async () => {
    expect(await idbPut("vault", { contacts: ["ada"] })).toBe(true);
    expect(await idbGet("vault")).toEqual({ contacts: ["ada"] });
  });

  it("reports no value for a key that was never written", async () => {
    // Null rather than undefined: the callers test it directly.
    expect(await idbGet("missing")).toBeNull();
  });

  it("replaces a value rather than keeping both", async () => {
    await idbPut("vault", { revision: 1 });
    await idbPut("vault", { revision: 2 });
    expect(await idbGet("vault")).toEqual({ revision: 2 });
  });

  it("forgets a deleted key", async () => {
    await idbPut("vault", { contacts: [] });
    await idbDelete("vault");
    expect(await idbGet("vault")).toBeNull();
  });

  it("is untroubled by deleting a key that is not there", async () => {
    await expect(idbDelete("missing")).resolves.toBeUndefined();
  });

  it("keeps the keys apart", async () => {
    await idbPut("a", 1);
    await idbPut("b", 2);
    expect(await idbGet("a")).toBe(1);
    expect(await idbGet("b")).toBe(2);
  });

  it("declines a value it cannot store instead of throwing", async () => {
    // A function cannot be structured-cloned. The snapshot is written for its
    // side effect, so the caller needs a false, not an exception.
    expect(await idbPut("vault", () => "not cloneable")).toBe(false);
  });
});

describe("the attachment store", () => {
  function record(bytes: number, lastUsed: number): CachedAttachment {
    return {
      version: 1,
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(bytes),
      bytes,
      lastUsed,
    };
  }

  it("gives back the record that was put in", async () => {
    expect(await idbPutAttachment("a", record(8, 5))).toBe(true);
    expect(await idbGetAttachment("a")).toMatchObject({ bytes: 8, lastUsed: 5 });
  });

  it("indexes what it holds, without reading the ciphertext back", async () => {
    await idbPutAttachment("a", record(8, 5));
    await idbPutAttachment("b", record(16, 6));
    expect(await idbAttachmentIndex()).toEqual([
      { id: "a", bytes: 8, lastUsed: 5 },
      { id: "b", bytes: 16, lastUsed: 6 },
    ]);
  });

  it("moves a touched entry to the recent end of the order", async () => {
    await idbPutAttachment("a", record(8, 5));
    await idbTouchAttachment("a", 99);
    expect(await idbAttachmentIndex()).toEqual([{ id: "a", bytes: 8, lastUsed: 99 }]);
    // The record itself is untouched, so a touch never rewrites a ciphertext.
    expect((await idbGetAttachment("a"))?.lastUsed).toBe(5);
  });

  it("is untroubled by touching an entry that is not there", async () => {
    await expect(idbTouchAttachment("missing")).resolves.toBeUndefined();
    expect(await idbAttachmentIndex()).toEqual([]);
  });

  it("removes a record and its index row together", async () => {
    await idbPutAttachment("a", record(8, 5));
    await idbPutAttachment("b", record(8, 6));
    await idbDeleteAttachments(["a"]);
    expect(await idbGetAttachment("a")).toBeNull();
    expect(await idbAttachmentIndex()).toEqual([{ id: "b", bytes: 8, lastUsed: 6 }]);
  });

  it("empties itself, which is what sign-out needs", async () => {
    await idbPutAttachment("a", record(8, 5));
    await idbPutAttachment("b", record(8, 6));
    await idbClearAttachments();
    expect(await idbGetAttachment("a")).toBeNull();
    expect(await idbGetAttachment("b")).toBeNull();
    expect(await idbAttachmentIndex()).toEqual([]);
  });

  it("keeps the vault snapshot out of the way of a cache clear", async () => {
    await idbPut("snapshot", { ciphertext: "..." });
    await idbPutAttachment("a", record(8, 5));
    await idbClearAttachments();
    expect(await idbGet("snapshot")).toEqual({ ciphertext: "..." });
  });

  it("drops the plaintext blobs an older database version held", async () => {
    // Version 2 wrote decrypted blobs here. Opening at version 3 must not
    // carry them forward: they are the plaintext at rest that the encrypted
    // records replace, and nothing can re-encrypt them without the password.
    await new Promise<void>((resolve) => {
      const request = indexedDB.open("sealbook", 2);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("vault");
        request.result.createObjectStore("attachments");
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("attachments", "readwrite");
        tx.objectStore("attachments").put(new Blob(["a decrypted photo"]), "a");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });

    expect(await idbGetAttachment("a")).toBeNull();
    expect(await idbAttachmentIndex()).toEqual([]);
  });

  it("declines a record it cannot store instead of throwing", async () => {
    const unstorable = { ...record(8, 5), iv: () => "not cloneable" };
    expect(await idbPutAttachment("a", unstorable as unknown as CachedAttachment)).toBe(false);
  });
});

describe("when the database is unavailable", () => {
  // The whole point of the wrapper: in a private window, under storage
  // pressure, or with site data blocked, the right outcome is no offline
  // snapshot rather than an unlock that fails.

  it("degrades when opening throws outright", async () => {
    globalThis.indexedDB = {
      open: () => {
        throw new DOMException("site data is blocked");
      },
    } as unknown as IDBFactory;

    expect(await idbGet("vault")).toBeNull();
    expect(await idbPut("vault", { contacts: [] })).toBe(false);
    await expect(idbDelete("vault")).resolves.toBeUndefined();
    expect(await idbGetAttachment("a")).toBeNull();
    expect(await idbAttachmentIndex()).toEqual([]);
    await expect(idbClearAttachments()).resolves.toBeUndefined();
  });

  it("degrades when the open request reports an error", async () => {
    globalThis.indexedDB = factoryFiring("onerror");

    expect(await idbGet("vault")).toBeNull();
    expect(await idbPut("vault", { contacts: [] })).toBe(false);
    await expect(idbDelete("vault")).resolves.toBeUndefined();
  });

  it("does not hang when another tab holds an older version open", async () => {
    // Without the `onblocked` handler these promises never settle, and the
    // unlock waiting on them hangs for as long as the tab is open. A
    // regression here shows up as this test timing out.
    globalThis.indexedDB = factoryFiring("onblocked");

    expect(await idbGet("vault")).toBeNull();
    expect(await idbPut("vault", { contacts: [] })).toBe(false);
    await expect(idbDelete("vault")).resolves.toBeUndefined();
  });
});
