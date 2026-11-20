import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import init from "../pkg/sealbook_wasm.js";
import {
  coreManifestAccept,
  coreManifestApply,
  coreManifestBucketsAccept,
  coreManifestBucketsFromWhole,
  coreManifestBucketsRequest,
  coreManifestEntryFor,
  coreManifestRequest,
  coreManifestSignRoot,
  coreManifestSigner,
  coreManifestVerify,
  coreErrorOf,
} from "./wasm";
import { readFixture } from "../test/fixtures";
import type {
  BucketedManifest,
  CoreDevice,
  CoreManifestEntry,
  ManifestContext,
} from "../pkg/sealbook_wasm.js";

/**
 * The shared manifest fixture, through the same core the CLI and Android run.
 *
 * Held to the same bytes as `sealbook-core/tests/manifest.rs` and Android's
 * `ManifestChainTest`, so a verdict that differs here differs from the other
 * two clients rather than from a copy of their output.
 */
beforeAll(async () => {
  const wasm = readFileSync(new URL("../pkg/sealbook_wasm_bg.wasm", import.meta.url));
  await init({ module_or_path: wasm });
});

type Fixture = {
  collection_id: string;
  device_id: string;
  key_epoch: number;
  mldsa_seed: string;
  ed25519_sk: string;
  devices: CoreDevice[];
  manifest_response: { manifest: unknown; entries: CoreManifestEntry[] };
  wanted: number[];
  buckets_response: { buckets: string; served: number[]; entries: CoreManifestEntry[] };
  write: CoreManifestEntry[];
  next_object_count: number;
  next_root: string;
};

const fixture = JSON.parse(readFixture("manifests/one-write.json")) as Fixture;
const wholeBody = JSON.stringify(fixture.manifest_response);
const bucketsBody = JSON.stringify(fixture.buckets_response);
const ids = fixture.write.map((entry) => entry.id);

const context = (seq = 0): ManifestContext => ({
  collection_id: fixture.collection_id,
  device_id: fixture.device_id,
  manifest_seq: seq,
});

/** The variant core raised, so a test names the verdict and not a sentence. */
const refusal = (run: () => unknown): string | undefined => {
  try {
    run();
    return undefined;
  } catch (err) {
    return coreErrorOf(err)?.kind;
  }
};

const held = (): BucketedManifest => {
  return coreManifestBucketsAccept(context(), ids, bucketsBody, fixture.devices).Signed.held;
};

describe("the shared manifest fixture", () => {
  it("asks for the whole manifest, and for only the buckets a write touches", () => {
    expect(coreManifestRequest(context()).path).toBe(
      `/v2/collections/${fixture.collection_id}/manifest`,
    );
    const query = fixture.wanted
      .map((bucket) => bucket.toString(16).padStart(2, "0"))
      .join("");
    expect(coreManifestBucketsRequest(context(), ids).path).toContain(`buckets=${query}`);
  });

  it("names the signer before the roster is fetched", () => {
    const signer = coreManifestSigner(wholeBody);
    expect(signer?.device_id).toBe(fixture.device_id);
    expect(signer?.key_epoch).toBe(fixture.key_epoch);
    expect(coreManifestSigner(JSON.stringify({ manifest: null, entries: [] }))).toBeUndefined();
  });

  it("verifies the whole collection against what the manifest commits to", () => {
    const outcome = coreManifestAccept(context(), wholeBody, fixture.devices);
    expect("Signed" in outcome).toBe(true);
    if (!("Signed" in outcome)) {
      return;
    }
    expect(outcome.Signed.plan.manifest_seq).toBe(7);
    expect(outcome.Signed.entries).toHaveLength(5);
  });

  it("refuses a manifest signed by a device the roster does not list", () => {
    expect(refusal(() => coreManifestAccept(context(), wholeBody, []))).toBe("Manifest");
  });

  it("refuses a manifest older than the one this device has seen", () => {
    expect(refusal(() => coreManifestAccept(context(99), wholeBody, fixture.devices))).toBe(
      "Manifest",
    );
  });

  it("holds only the buckets the write touches, and folds the write into them", () => {
    const state = held();
    expect(state.held).toEqual(fixture.wanted);
    expect(state.entries.length).toBeLessThan(fixture.manifest_response.entries.length);
    const applied = coreManifestApply(state, fixture.write);
    expect(applied.object_count).toBe(fixture.next_object_count);
    expect(applied.root).toBe(fixture.next_root);
  });

  it("reaches the same root from the whole entry set as from the buckets", () => {
    const { plan, entries } = coreManifestAccept(context(), wholeBody, fixture.devices).Signed;
    const whole = coreManifestBucketsFromWhole(plan, entries);
    expect(coreManifestApply(whole, fixture.write).root).toBe(fixture.next_root);
  });

  it("refuses an answer for buckets other than the ones asked for", () => {
    const body = JSON.stringify({
      ...fixture.buckets_response,
      served: [fixture.wanted[0]],
    });
    expect(refusal(() => coreManifestBucketsAccept(context(), ids, body, fixture.devices))).toBe(
      "Manifest",
    );
  });

  it("refuses an object withheld from a served bucket", () => {
    const body = JSON.stringify({
      ...fixture.buckets_response,
      entries: fixture.buckets_response.entries.slice(1),
    });
    expect(refusal(() => coreManifestBucketsAccept(context(), ids, body, fixture.devices))).toBe(
      "Manifest",
    );
  });

  it("refuses a bucket answer with no manifest, whatever this device has seen", () => {
    const body = JSON.stringify({ ...fixture.buckets_response, manifest: null });
    for (const seq of [0, 7]) {
      expect(refusal(() => coreManifestBucketsAccept(context(seq), ids, body, fixture.devices))).toBe(
        "Manifest",
      );
    }
  });

  it("signs the next manifest over the root the server will recompute", () => {
    const applied = coreManifestApply(held(), fixture.write);
    const signed = coreManifestSignRoot(
      fixture.mldsa_seed,
      fixture.ed25519_sk,
      context(),
      { manifest_seq: 8, key_epoch: fixture.key_epoch, latest_revision: 13 },
      applied,
    );
    expect(signed.digest).toBe(fixture.next_root);
    expect(signed.object_count).toBe(fixture.next_object_count);
    expect(JSON.parse(signed.manifest_json)).toMatchObject({
      manifest_seq: 8,
      digest: fixture.next_root,
      device_id: fixture.device_id,
    });
  });

  it("checks a walk against the manifest it was served with", () => {
    const manifest = JSON.stringify(fixture.manifest_response.manifest);
    const entries = fixture.manifest_response.entries;
    expect(
      coreManifestVerify(context(), manifest, entries, fixture.devices).manifest_seq,
    ).toBe(7);
    expect(
      refusal(() => coreManifestVerify(context(), manifest, entries.slice(1), fixture.devices)),
    ).toBe("Manifest");
  });

  it("commits an entry to the bytes that were sealed", () => {
    const entry = coreManifestEntryFor(fixture.write[0].id, 13, false, "AQID", "BAUG");
    expect(entry.content_digest).not.toBe(
      coreManifestEntryFor(fixture.write[0].id, 13, false, "CQkJ", "BAUG").content_digest,
    );
  });
});
