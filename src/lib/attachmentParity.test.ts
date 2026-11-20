import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import init from "../pkg/sealbook_wasm.js";
import {
  coreAttachmentChunkDigest,
  coreAttachmentChunkNonce,
  coreAttachmentChunkPath,
  coreAttachmentCommitAccept,
  coreAttachmentCommitRequest,
  coreAttachmentContentHash,
  coreAttachmentCreateRequest,
  coreAttachmentDeleteRequest,
  coreAttachmentLimits,
  coreAttachmentMetaAccept,
  coreAttachmentMetaRequest,
  coreAttachmentPlan,
  coreAttachmentRanges,
  coreAttachmentSweepOrphans,
  coreAttachmentSweepPage,
  coreAttachmentSweepRequest,
  coreAttachmentSweepStart,
  coreAttachmentVerify,
  coreErrorOf,
  coreOpenAttachmentChunk,
  coreSealAttachmentChunk,
} from "./wasm";
import { ATTACHMENT_CHUNK_SIZE, ATTACHMENT_NONCE_LEN } from "./attachments";
import { b64ToByteArray, b64encode } from "./bytes";
import { readFixture } from "../test/fixtures";
import type { AttachmentPlan, CoreDeviceState } from "../pkg/sealbook_wasm.js";

/**
 * The shared attachment fixture, through the same core the CLI and Android run.
 *
 * Held to the same document as `sealbook-core/tests/attachments.rs` and
 * Android's `AttachmentTest`, so a chunk count, a path, a refusal or a content
 * hash that differs here differs from the other two clients.
 */
beforeAll(async () => {
  const wasm = readFileSync(new URL("../pkg/sealbook_wasm_bg.wasm", import.meta.url));
  await init({ module_or_path: wasm });
});

type PlanCase = {
  size: number;
  padded_size: number;
  chunk_count: number;
  ranges?: [number, number, number][];
};
type DigestCase = { plaintext_b64: string; digest: string };
type ContentHashCase = { digests: string[]; hash: string };

type Fixture = {
  collection_id: string;
  attachment_id: string;
  key: string;
  limits: {
    max_size: number;
    chunk_size: number;
    nonce_header: string;
    nonce_len: number;
    orphan_grace_secs: number;
  };
  plans: PlanCase[];
  paths: {
    create: string;
    chunk: string;
    commit: string;
    meta: string;
    delete: string;
    list: string;
    list_after: string;
  };
  digests: DigestCase[];
  content_hashes: ContentHashCase[];
  sealed_chunk: {
    index: number;
    chunk_count: number;
    plaintext_b64: string;
    nonce: string;
    ciphertext_b64: string;
  };
  refusals: { case: string; refusal: string }[];
  sweep: {
    rows: { attachment_id: string; state: string; created_at: number }[];
    referenced: string[];
    now_secs: number;
    orphans: string[];
  };
};

const fixture = JSON.parse(readFixture("attachments/attachments.json")) as Fixture;
const COLLECTION = fixture.collection_id;
const ATTACHMENT = fixture.attachment_id;
const OTHER = "33333333-3333-4333-8333-333333333333";

/** The refusal's name, which is what the fixture pins rather than its wording. */
function refusalOf(run: () => unknown): string {
  try {
    run();
    return "no refusal";
  } catch (error) {
    const core = coreErrorOf(error);
    if (!core) return `not a core error: ${String(error)}`;
    if (core.kind === "Attachment") {
      return (core as unknown as { refusal: { refusal: string } }).refusal.refusal;
    }
    if (core.kind === "AttachmentIntegrity") return "Integrity";
    return core.kind;
  }
}

function planOf(entry: PlanCase): AttachmentPlan {
  return {
    attachment_id: ATTACHMENT,
    key: fixture.key,
    chunk_size: fixture.limits.chunk_size,
    chunk_count: entry.chunk_count,
    byte_size: entry.size,
    padded_size: entry.padded_size,
  };
}

function metaBody(id: string, state: string, chunkCount: number): string {
  return JSON.stringify({
    attachment_id: id,
    state,
    chunk_size: fixture.limits.chunk_size,
    chunk_count: chunkCount,
    total_ciphertext_size: 64,
    created_at: 10,
  });
}

describe("attachment limits", () => {
  it("are the protocol's", () => {
    const limits = coreAttachmentLimits();
    expect(Number(limits.max_size)).toBe(fixture.limits.max_size);
    expect(limits.chunk_size).toBe(fixture.limits.chunk_size);
    expect(limits.nonce_header).toBe(fixture.limits.nonce_header);
    expect(limits.nonce_len).toBe(fixture.limits.nonce_len);
    expect(Number(limits.orphan_grace_secs)).toBe(fixture.limits.orphan_grace_secs);
  });

  /** The two literals this module exports, because module scope runs before
   * `initWasm` and cannot read core. */
  it("match the constants this client declares for itself", () => {
    const limits = coreAttachmentLimits();
    expect(ATTACHMENT_CHUNK_SIZE).toBe(limits.chunk_size);
    expect(ATTACHMENT_NONCE_LEN).toBe(limits.nonce_len);
  });
});

describe("attachment planning", () => {
  it("turns a size into the chunk count the server derives", () => {
    for (const entry of fixture.plans) {
      if (entry.size === 0 || entry.size > fixture.limits.max_size) continue;
      const plan = coreAttachmentPlan(entry.size);
      expect(plan.chunk_count).toBe(entry.chunk_count);
      expect(Number(plan.byte_size)).toBe(entry.size);
      expect(Number(plan.padded_size)).toBe(entry.padded_size);
    }
  });

  it("covers the plaintext once and in order", () => {
    for (const entry of fixture.plans) {
      if (!entry.ranges) continue;
      const ranges = coreAttachmentRanges(planOf(entry));
      expect(ranges.map((r) => [Number(r.start), Number(r.end), Number(r.len)])).toEqual(
        entry.ranges,
      );
      expect(ranges.map((r) => r.index)).toEqual(ranges.map((_, i) => i));
    }
  });

  it("refuses an empty attachment rather than sending one", () => {
    expect(refusalOf(() => coreAttachmentPlan(0))).toBe("Empty");
  });

  it("refuses a file over the protocol ceiling", () => {
    expect(refusalOf(() => coreAttachmentPlan(fixture.limits.max_size + 1))).toBe("TooLarge");
  });
});

/** A device with fixed signing seeds, and a challenge as the server serves it. */
const DEVICE_STATE: CoreDeviceState = {
  server: "https://example.test",
  username: "alice",
  account_id: "55555555-5555-4555-8555-555555555555",
  collection_id: COLLECTION,
  device_id: "66666666-6666-4666-8666-666666666666",
  hpke_sk: new Array(32).fill(7),
  mldsa_seed: new Array(32).fill(1),
  ed25519_sk: new Array(32).fill(11),
  manifest_seq: 0,
  roster_seq: 0,
  roster_transcript: new Array(32).fill(6),
};
const CHALLENGE = JSON.stringify({
  challenge_id: "44444444-4444-4444-8444-444444444444",
  challenge: b64encode(new Uint8Array(32).fill(5)),
});

describe("attachment paths", () => {
  it("are the ones the fixture pins", () => {
    expect(
      coreAttachmentCreateRequest(DEVICE_STATE, COLLECTION, planOf({ size: 1, padded_size: 1, chunk_count: 1 }), CHALLENGE).path,
    ).toBe(fixture.paths.create);
    expect(coreAttachmentChunkPath(COLLECTION, ATTACHMENT, 0)).toBe(fixture.paths.chunk);
    expect(
      coreAttachmentCommitRequest(DEVICE_STATE, COLLECTION, ATTACHMENT, CHALLENGE).path,
    ).toBe(fixture.paths.commit);
    expect(coreAttachmentMetaRequest(COLLECTION, ATTACHMENT).path).toBe(fixture.paths.meta);
    expect(
      coreAttachmentDeleteRequest(DEVICE_STATE, COLLECTION, ATTACHMENT, CHALLENGE).path,
    ).toBe(fixture.paths.delete);
    expect(coreAttachmentSweepRequest(COLLECTION, coreAttachmentSweepStart()).path).toBe(
      fixture.paths.list,
    );
    expect(
      coreAttachmentSweepRequest(COLLECTION, { after: ATTACHMENT, seen: [ATTACHMENT] }).path,
    ).toBe(fixture.paths.list_after);
  });
});

describe("attachment rounds", () => {
  it("does not accept a commit the server left pending", () => {
    expect(
      refusalOf(() =>
        coreAttachmentCommitAccept(
          ATTACHMENT,
          JSON.stringify({ attachment_id: ATTACHMENT, state: "pending" }),
        ),
      ),
    ).toBe("State");
    expect(() =>
      coreAttachmentCommitAccept(
        ATTACHMENT,
        JSON.stringify({ attachment_id: ATTACHMENT, state: "committed" }),
      ),
    ).not.toThrow();
  });

  /** The note's count is the one every chunk's AAD was built over, so another
   * count means another set of chunks. */
  it("refuses a server that names another chunk count, before any bytes", () => {
    expect(
      refusalOf(() => coreAttachmentMetaAccept(ATTACHMENT, 3, metaBody(ATTACHMENT, "committed", 7))),
    ).toBe("ChunkCount");
    expect(() =>
      coreAttachmentMetaAccept(ATTACHMENT, 7, metaBody(ATTACHMENT, "committed", 7)),
    ).not.toThrow();
  });

  it("does not download an uncommitted attachment", () => {
    expect(
      refusalOf(() => coreAttachmentMetaAccept(ATTACHMENT, 1, metaBody(ATTACHMENT, "pending", 1))),
    ).toBe("State");
  });

  it("refuses a chunk served without its nonce header", () => {
    expect(refusalOf(() => coreAttachmentChunkNonce(null))).toBe("MissingNonce");
    expect(refusalOf(() => coreAttachmentChunkNonce(""))).toBe("MissingNonce");
    expect(coreAttachmentChunkNonce("abc")).toBe("abc");
  });
});

describe("attachment hashing", () => {
  it("produces the chunk digests the fixture pins", () => {
    for (const entry of fixture.digests) {
      expect(coreAttachmentChunkDigest(Uint8Array.from(b64ToByteArray(entry.plaintext_b64)))).toBe(entry.digest);
    }
  });

  it("produces the content hashes the fixture pins", () => {
    for (const entry of fixture.content_hashes) {
      expect(coreAttachmentContentHash(entry.digests)).toBe(entry.hash);
    }
  });

  /** The chunk count is folded in last for exactly this. */
  it("does not let a truncated or reordered set reach the whole hash", () => {
    const digests = [0, 1, 2, 3].map((byte) =>
      coreAttachmentChunkDigest(new Uint8Array(16).fill(byte)),
    );
    const whole = coreAttachmentContentHash(digests);
    expect(coreAttachmentContentHash(digests.slice(0, 3))).not.toBe(whole);
    const reordered = [digests[1], digests[0], digests[2], digests[3]];
    expect(coreAttachmentContentHash(reordered)).not.toBe(whole);
  });

  it("reports a download that does not reproduce the hash as an integrity failure", () => {
    const digests = [coreAttachmentChunkDigest(new TextEncoder().encode("one"))];
    const hash = coreAttachmentContentHash(digests);
    expect(() => coreAttachmentVerify(ATTACHMENT, hash, digests)).not.toThrow();
    const wrong = [coreAttachmentChunkDigest(new TextEncoder().encode("two"))];
    expect(refusalOf(() => coreAttachmentVerify(ATTACHMENT, hash, wrong))).toBe("Integrity");
  });
});

describe("attachment chunks", () => {
  it("opens the chunk core sealed for the fixture", () => {
    const sealed = fixture.sealed_chunk;
    const opened = coreOpenAttachmentChunk(
      fixture.key,
      ATTACHMENT,
      COLLECTION,
      sealed.index,
      sealed.chunk_count,
      sealed.nonce,
      Uint8Array.from(b64ToByteArray(sealed.ciphertext_b64)),
    );
    expect(b64encode(opened)).toBe(sealed.plaintext_b64);
  });

  /** Each of these is a replayed, reordered or substituted chunk, and the AAD is
   * what makes all four fail rather than decrypt to the wrong thing. */
  it("does not open a chunk in another position or under another attachment", () => {
    const sealed = fixture.sealed_chunk;
    const ciphertext = Uint8Array.from(b64ToByteArray(sealed.ciphertext_b64));
    const open = (attachment: string, collection: string, index: number, count: number) =>
      refusalOf(() =>
        coreOpenAttachmentChunk(
          fixture.key,
          attachment,
          collection,
          index,
          count,
          sealed.nonce,
          ciphertext,
        ),
      );
    expect(open(ATTACHMENT, COLLECTION, sealed.index + 1, sealed.chunk_count)).toBe("Integrity");
    expect(open(ATTACHMENT, COLLECTION, sealed.index, sealed.chunk_count + 1)).toBe("Integrity");
    expect(open(OTHER, COLLECTION, sealed.index, sealed.chunk_count)).toBe("Integrity");
    expect(open(ATTACHMENT, OTHER, sealed.index, sealed.chunk_count)).toBe("Integrity");
  });

  it("round-trips every chunk of a plan through seal and open", () => {
    const limits = coreAttachmentLimits();
    const size = limits.chunk_size + 100;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) data[i] = i % 251;
    const plan = coreAttachmentPlan(size);

    const digests: string[] = [];
    const out = new Uint8Array(size);
    let at = 0;
    for (const range of coreAttachmentRanges(plan)) {
      const slice = data.subarray(Number(range.start), Number(range.end));
      digests.push(coreAttachmentChunkDigest(slice));
      const sealed = coreSealAttachmentChunk(
        plan.key,
        plan.attachment_id,
        COLLECTION,
        range.index,
        plan.chunk_count,
        slice,
      );
      const opened = coreOpenAttachmentChunk(
        plan.key,
        plan.attachment_id,
        COLLECTION,
        range.index,
        plan.chunk_count,
        b64encode(sealed.subarray(0, limits.nonce_len)),
        sealed.subarray(limits.nonce_len),
      );
      out.set(opened, at);
      at += opened.length;
    }
    expect(out).toEqual(data);
    expect(() =>
      coreAttachmentVerify(plan.attachment_id, coreAttachmentContentHash(digests), digests),
    ).not.toThrow();
  }, 20000);

  it("names an unreadable key rather than reporting a crypto failure", () => {
    expect(
      refusalOf(() => coreSealAttachmentChunk("not base64!", ATTACHMENT, COLLECTION, 0, 1, new Uint8Array(1))),
    ).toBe("Key");
    expect(
      refusalOf(() => coreSealAttachmentChunk("AAAA", ATTACHMENT, COLLECTION, 0, 1, new Uint8Array(1))),
    ).toBe("Key");
  });
});

describe("the attachment sweep", () => {
  it("pages the listing and stops when it is exhausted", () => {
    const first = JSON.stringify({
      attachments: [{ attachment_id: ATTACHMENT, state: "committed", created_at: 10 }],
      next_after: OTHER,
    });
    const page = coreAttachmentSweepPage(coreAttachmentSweepStart(), first);
    expect(page.rows).toHaveLength(1);
    expect(page.next?.after).toBe(OTHER);

    const last = JSON.stringify({ attachments: [], next_after: null });
    expect(coreAttachmentSweepPage(page.next!, last).next).toBeFalsy();
  });

  /** The CLI had no such guard and would page forever. */
  it("ends on a cursor that does not advance", () => {
    const cursor = { after: OTHER, seen: [OTHER] };
    const body = JSON.stringify({ attachments: [], next_after: OTHER });
    expect(coreAttachmentSweepPage(cursor, body).next).toBeFalsy();
  });

  it("deletes only unreferenced attachments past the grace period", () => {
    const rows = fixture.sweep.rows.map((row) => ({ ...row, created_at: BigInt(row.created_at) }));
    const orphans = coreAttachmentSweepOrphans(
      rows as never,
      fixture.sweep.referenced,
      fixture.sweep.now_secs,
    );
    expect(orphans).toEqual(fixture.sweep.orphans);
  });

  it("names every refusal the fixture lists", () => {
    const names = fixture.refusals.map((entry) => entry.refusal);
    for (const expected of [
      "Empty",
      "TooLarge",
      "ChunkCount",
      "State",
      "MissingNonce",
      "Key",
      "Integrity",
    ]) {
      expect(names).toContain(expected);
    }
  });
});
