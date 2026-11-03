import { describe, expect, it } from "vitest";

import {
  coreFlushPlan,
  coreLocalView,
  coreMergePayload,
  coreOutboxPush,
  coreOutboxRead,
  coreOutboxWrite,
  type FlushPlan,
  type LocalObject,
  type LocalVault,
  type MergeOutcome,
  type Outbox,
  type PendingWrite,
} from "./wasm";
import { EMPTY_OUTBOX } from "./localStore";
import { readFixture } from "../test/fixtures";

/** The shared offline fixture, held to the same document as `sealbook-core/tests/offline.rs`. */
type Fixture = {
  date: string;
  outbox: {
    case: string;
    vault: LocalVault;
    pushes: PendingWrite[];
    outbox: Outbox;
    view: LocalObject[];
  }[];
  merge: {
    case: string;
    content_type: string;
    base: string | null;
    local: string;
    remote: string;
    outcome: MergeOutcome;
  }[];
  flush: { case: string; vault: LocalVault; outbox: Outbox; plan: FlushPlan }[];
};

// Core writes an absent option as `null` and wasm hands it back as `undefined`.
const fixture = JSON.parse(readFixture("offline/offline.json"), (_key, value: unknown) =>
  value === null ? undefined : value,
) as Fixture;

describe("the outbox", () => {
  it.each(fixture.outbox.map((c) => [c.case, c] as const))("%s", (_, c) => {
    const outbox = c.pushes.reduce(coreOutboxPush, EMPTY_OUTBOX);
    expect(outbox).toEqual(c.outbox);
    expect(coreLocalView(c.vault, outbox)).toEqual(c.view);
    expect(coreOutboxRead(coreOutboxWrite(outbox))).toEqual(outbox);
  });
});

describe("the merge", () => {
  it.each(fixture.merge.map((c) => [c.case, c] as const))("%s", (_, c) => {
    expect(coreMergePayload(c.content_type, c.base, c.local, c.remote, fixture.date)).toEqual(
      c.outcome,
    );
  });
});

describe("the flush plan", () => {
  it.each(fixture.flush.map((c) => [c.case, c] as const))("%s", (_, c) => {
    expect(coreFlushPlan(c.outbox, c.vault, fixture.date)).toEqual(c.plan);
  });
});
