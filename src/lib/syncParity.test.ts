import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import init from "../pkg/sealbook_wasm.js";
import {
  coreChangesRequest,
  coreLatestRevisions,
  coreManifestEntryFor,
  coreManifestVerify,
  coreOpenRow,
  coreWalkPage,
  coreWalkStart,
} from "./wasm";
import { readFixture } from "../test/fixtures";
import type {
  ChangesPage,
  CoreDevice,
  CoreSealedRow,
  ManifestContext,
  WalkOutcome,
} from "../pkg/sealbook_wasm.js";

/**
 * The shared change-feed fixture, through the same core the CLI and Android
 * run.
 *
 * Held to the same document as `sealbook-core/tests/sync.rs` and Android's
 * `VaultWalkTest`, so a read that differs here differs from the other two
 * clients rather than from a copy of their output.
 */
beforeAll(async () => {
  const wasm = readFileSync(new URL("../pkg/sealbook_wasm_bg.wasm", import.meta.url));
  await init({ module_or_path: wasm });
});

type ServedRow = CoreSealedRow & { content_type: string };

type Page = {
  request_path: string;
  latest_revision: number;
  key_epoch: number;
  objects: ServedRow[];
  has_more: boolean;
  manifest: Record<string, unknown> | null;
  resync?: boolean;
  tombstone_floor?: number;
};

type Fixture = {
  collection_id: string;
  device_id: string;
  key_epoch: number;
  collection_key: string;
  devices: CoreDevice[];
  pages: Page[];
  objects: { id: string; content_type: string; payload: string }[];
  deleted: string[];
  unreadable: { id: string; reason: string }[];
};

const fixture = JSON.parse(readFixture("changes/paged-walk.json")) as Fixture;

const context: ManifestContext = {
  collection_id: fixture.collection_id,
  device_id: fixture.device_id,
  manifest_seq: 0,
};

function facts(page: Page): ChangesPage {
  return {
    manifest_json: page.manifest ? JSON.stringify(page.manifest) : undefined,
    key_epoch: page.key_epoch,
    latest_revision: page.latest_revision,
    tombstone_floor: page.tombstone_floor ?? 0,
    has_more: page.has_more,
    resync: page.resync ?? false,
    highest_revision: page.objects.reduce((top, row) => Math.max(top, row.revision), 0),
  };
}

/** The whole walk, driven as `clientVault.ts` drives it. */
function walk(): { rows: ServedRow[]; outcome: WalkOutcome } {
  let cursor = coreWalkStart(0);
  let index = 0;
  let rows: ServedRow[] = [];
  for (;;) {
    const page = fixture.pages[index];
    expect(coreChangesRequest(fixture.collection_id, cursor).path).toBe(page.request_path);
    const step = coreWalkPage(cursor, facts(page));
    if ("Next" in step) {
      rows.push(...page.objects);
      cursor = step.Next.cursor;
      index += 1;
    } else if ("Restart" in step) {
      rows = [];
      cursor = step.Restart.cursor;
      index += 1;
    } else {
      rows.push(...page.objects);
      return { rows, outcome: step.Done.walk };
    }
  }
}

/** The walk collapsed to the newest revision of each object. */
function current(): ServedRow[] {
  const { rows } = walk();
  return coreLatestRevisions(rows.map((row) => ({ id: row.id, revision: row.revision }))).map(
    (index) => rows[index],
  );
}

describe("the shared change-feed fixture", () => {
  it("asks for the live rows from the start", () => {
    const request = coreChangesRequest(fixture.collection_id, coreWalkStart(0));
    expect(request.path).toBe(
      `/v1/collections/${fixture.collection_id}/changes?after=0&limit=500&snapshot=true`,
    );
  });

  it("pages to the end and keeps what it was served", () => {
    const { rows, outcome } = walk();
    expect(rows).toHaveLength(6);
    expect(outcome.key_epoch).toBe(fixture.key_epoch);
    expect(outcome.latest_revision).toBe(7);
    expect(outcome.full).toBe(true);
  });

  // The log still carries a superseded revision, so a read that kept both would
  // commit to one object twice and the digest would disagree with the manifest.
  it("keeps only the newest revision of each object", () => {
    const rows = current();
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.revision)).not.toContain(2);
  });

  // The manifest commits to the collection rather than to any page of it, so it
  // is the assembled set that has to satisfy it.
  it("satisfies the manifest the pages carried", () => {
    const { outcome } = walk();
    const entries = current().map((row) =>
      coreManifestEntryFor(row.id, row.revision, row.tombstone, row.nonce, row.ciphertext),
    );
    const plan = coreManifestVerify(
      context,
      outcome.manifest_json as string,
      entries,
      fixture.devices,
    );
    expect(plan.key_epoch).toBe(fixture.key_epoch);
    expect(plan.latest_revision).toBe(7);
  });

  it("yields the objects the fixture names", () => {
    const read = current().flatMap((row) => {
      const result = coreOpenRow(fixture.collection_key, fixture.collection_id, row);
      if (typeof result === "string" || !("Object" in result)) return [];
      return [
        { id: row.id, content_type: result.Object.content_type, payload: result.Object.payload },
      ];
    });
    expect(read).toEqual(fixture.objects);
  });

  // A row-level tombstone and a sealed one are the same verdict: a delete with
  // nothing to read, and not a row this device has lost access to.
  it("reads both kinds of tombstone as deletes", () => {
    const deleted = current()
      .filter(
        (row) => coreOpenRow(fixture.collection_key, fixture.collection_id, row) === "Deleted",
      )
      .map((row) => row.id);
    expect(deleted).toEqual(fixture.deleted);
  });

  it("reports a row this key does not open, with its reason", () => {
    const unreadable = current().flatMap((row) => {
      const result = coreOpenRow(fixture.collection_key, fixture.collection_id, row);
      if (typeof result === "string" || !("Unreadable" in result)) return [];
      return [{ id: row.id, reason: result.Unreadable.reason }];
    });
    expect(unreadable).toEqual(fixture.unreadable);
  });
});
