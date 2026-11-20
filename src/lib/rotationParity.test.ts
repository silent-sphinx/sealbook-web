import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import init from "../pkg/sealbook_wasm.js";
import {
  coreErrorOf,
  coreManifestEntryFor,
  coreOpenRow,
  coreResealRow,
  coreRotationEntries,
  coreRotationPlan,
  coreRotationRecipients,
} from "./wasm";
import { readFixture } from "../test/fixtures";
import type {
  CoreDevice,
  CoreManifestEntry,
  CoreSealedRow,
  ManifestPlan,
  RotationPlan,
  RotationState,
} from "../pkg/sealbook_wasm.js";

/**
 * The shared rotation fixture, through the same core the CLI and Android run.
 *
 * Held to the same document as `sealbook-core/tests/rotation.rs` and Android's
 * `VaultRotationTest`, so a rotation that differs here differs from the other
 * two clients rather than from a copy of their output.
 */
beforeAll(async () => {
  const wasm = readFileSync(new URL("../pkg/sealbook_wasm_bg.wasm", import.meta.url));
  await init({ module_or_path: wasm });
});

type Fixture = {
  collection_id: string;
  device_id: string;
  collection_key: string;
  new_collection_key: string;
  state: RotationState;
  rows: CoreSealedRow[];
  plan: {
    reseal: { id: string; revision: number }[];
    carried: CoreManifestEntry[];
    retired: string[];
    manifest: ManifestPlan;
  };
  unreadable: CoreSealedRow;
  refusal: { refusal: string; object?: string; reason?: string };
  devices: CoreDevice[];
  recipients: {
    roster: string[];
    revoke: string[];
    keep: string[] | null;
    refusal: { refusal: string } | null;
  }[];
};

const fixture = JSON.parse(readFixture("rotation/plan.json")) as Fixture;

function plan(rows: CoreSealedRow[] = fixture.rows): RotationPlan {
  return coreRotationPlan(
    fixture.collection_key,
    fixture.collection_id,
    fixture.state,
    rows,
  );
}

function resealAll(rotation: RotationPlan): CoreSealedRow[] {
  return rotation.reseal.map((row) =>
    coreResealRow(
      fixture.collection_key,
      fixture.new_collection_key,
      fixture.collection_id,
      row,
    ),
  );
}

/** The refusal core raised, as the fixture records it, or what else happened. */
function refusalOf(call: () => unknown): unknown {
  try {
    call();
  } catch (err) {
    const core = coreErrorOf(err);
    return core?.kind === "Rotation"
      ? (core as { kind: "Rotation"; refusal: unknown }).refusal
      : err;
  }
  return "the call did not refuse";
}

describe("the shared rotation fixture", () => {
  it("plans the rows, the tombstones and the revisions the fixture names", () => {
    const rotation = plan();
    expect(rotation.reseal.map((row) => ({ id: row.id, revision: row.revision }))).toEqual(
      fixture.plan.reseal,
    );
    expect(
      rotation.carried.map((entry) => ({ id: entry.id, revision: entry.revision })),
    ).toEqual(fixture.plan.carried.map((entry) => ({ id: entry.id, revision: entry.revision })));
    expect(rotation.retired).toEqual(fixture.plan.retired);
    expect(rotation.manifest).toEqual(fixture.plan.manifest);
  });

  // A sealed tombstone has a row-level flag of false, so it is a row with bytes
  // like any other and the rotation re-seals it. Classifying by the envelope
  // would leave it out of the request and short in the manifest.
  it("re-seals a sealed tombstone and leaves a row-level one alone", () => {
    const resealed = plan().reseal.map((row) => row.id);
    for (const row of fixture.rows) {
      expect(resealed.includes(row.id)).toBe(!row.tombstone);
    }
  });

  // The server refuses a rotation whose revisions have a gap in them.
  it("assigns consecutive revisions from the collection's next one", () => {
    const rotation = plan();
    const first = fixture.state.latest_revision + 1;
    rotation.reseal.forEach((row, offset) => {
      expect(row.revision).toBe(first + offset);
    });
    expect(rotation.manifest.latest_revision).toBe(first + rotation.reseal.length - 1);
  });

  it("commits to the re-sealed rows and the carried tombstones, and to nothing else", () => {
    const rotation = plan();
    const resealed = resealAll(rotation);
    const entries = coreRotationEntries(rotation, resealed);
    expect([...entries].map((entry) => entry.id).sort()).toEqual(
      [
        ...rotation.reseal.map((row) => row.id),
        ...rotation.carried.map((entry) => entry.id),
      ].sort(),
    );
    for (const retired of rotation.retired) {
      expect(entries.some((entry) => entry.id === retired)).toBe(false);
    }
    entries.slice(0, resealed.length).forEach((entry, index) => {
      const sealed = resealed[index];
      expect(entry.content_digest).toBe(
        coreManifestEntryFor(sealed.id, sealed.revision, false, sealed.nonce, sealed.ciphertext)
          .content_digest,
      );
    });
  });

  it("re-seals every planned row onto the new key and off the old one", () => {
    for (const sealed of resealAll(plan())) {
      const underNew = coreOpenRow(fixture.new_collection_key, fixture.collection_id, sealed);
      expect(typeof underNew === "string" || !("Unreadable" in underNew)).toBe(true);
      const underOld = coreOpenRow(fixture.collection_key, fixture.collection_id, sealed);
      expect(typeof underOld !== "string" && "Unreadable" in underOld).toBe(true);
    }
  });

  // The 2026-10-20 bug: a read counts a row it cannot open and carries on, which
  // for a rotation would leave the row sealed under the retired key and drop the
  // object from the collection for good.
  it("refuses the whole rotation on a row this device cannot open", () => {
    expect(refusalOf(() => plan([...fixture.rows, fixture.unreadable]))).toEqual(fixture.refusal);
    // The same row through the read path is counted rather than raised.
    const read = coreOpenRow(fixture.collection_key, fixture.collection_id, fixture.unreadable);
    expect(typeof read !== "string" && "Unreadable" in read && read.Unreadable.reason).toBe("Key");
  });

  it("answers each roster case the way the fixture names", () => {
    const answers = fixture.recipients.map((expected) => {
      const roster = expected.roster.map(
        (id) => fixture.devices.find((device) => device.device_id === id) as CoreDevice,
      );
      const call = () => coreRotationRecipients(fixture.device_id, expected.revoke, roster);
      return expected.keep
        ? { keep: call().map((device) => device.device_id), refusal: null }
        : { keep: null, refusal: refusalOf(call) };
    });
    expect(answers).toEqual(
      fixture.recipients.map((expected) => ({
        keep: expected.keep,
        refusal: expected.keep ? null : expected.refusal,
      })),
    );
  });
});
