import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import init from "../pkg/sealbook_wasm.js";
import {
  coreErrorOf,
  corePinRoster,
  coreRosterAccept,
  coreRosterAnswersFor,
  coreRosterRequest,
} from "./wasm";
import { readFixture } from "../test/fixtures";
import type { CoreRoster, RosterContext } from "../pkg/sealbook_wasm.js";

/**
 * The shared roster chain, through the same core the CLI and Android run.
 *
 * Alpha registers, pairs beta, then revokes it, so this covers the case nothing
 * else does: a device that was in the account and is no longer. Held to the same
 * bytes as `sealbook-core/tests/roster.rs` and Android's `RosterChainTest`, so a
 * verdict that differs here differs from the other two clients rather than from
 * a copy of their output.
 */
beforeAll(async () => {
  const wasm = readFileSync(new URL("../pkg/sealbook_wasm_bg.wasm", import.meta.url));
  await init({ module_or_path: wasm });
});

type Fixture = {
  collection_id: string;
  collection_key: string;
  key_epoch: number;
  alpha_device_id: string;
  beta_device_id: string;
  rosters: { roster_seq: number }[];
};

const fixture = JSON.parse(readFixture("rosters/chain-with-revoke.json")) as Fixture;
const { collection_key: ck, key_epoch: epoch } = fixture;

const served = (from: number, floor: number) =>
  JSON.stringify({
    rosters: fixture.rosters.filter((roster) => roster.roster_seq >= from),
    floor,
  });

/** One roster alone, which is how a pin is computed for a given step. */
const single = (seq: number) =>
  JSON.stringify({
    rosters: fixture.rosters.filter((roster) => roster.roster_seq === seq),
    floor: seq,
  });

/** Alpha pinned at `seq`, or unpinned when 0. */
const context = (seq: number): RosterContext => ({
  collection_id: fixture.collection_id,
  device_id: fixture.alpha_device_id,
  roster_seq: seq,
  // The transcript is core's own, so the fixture does not have to carry it.
  roster_transcript:
    seq === 0 ? "" : coreRosterAccept(context(0), ck, epoch, 200, single(seq)).pin.transcript,
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

describe("the shared roster chain", () => {
  it("asks from the pin, so the chain back to it can be checked", () => {
    const base = `/v1/collections/${fixture.collection_id}/roster`;
    expect(coreRosterRequest(context(0)).path).toBe(base);
    expect(coreRosterRequest(context(2)).path).toBe(`${base}?from=2`);
  });

  it("ends on the roster the revoked device is gone from", () => {
    const verified = coreRosterAccept(context(1), ck, epoch, 200, served(1, 1));
    expect(verified.pin.roster_seq).toBe(3);
    expect(verified.roster.devices).toHaveLength(1);
    expect(verified.roster.devices[0]?.device_id).toBe(fixture.alpha_device_id);
  });

  it("refuses a history that no longer reaches the pin, as RosterTooOld", () => {
    expect(refusal(() => coreRosterAccept(context(1), ck, epoch, 200, served(2, 2)))).toBe(
      "RosterTooOld",
    );
  });

  it("refuses the revoked device its own account", () => {
    const asBeta = { ...context(1), device_id: fixture.beta_device_id };
    // Beta is in roster 2 and gone by 3, so the chain verifies and then rejects
    // the device reading it.
    expect(refusal(() => coreRosterAccept(asBeta, ck, epoch, 200, served(1, 1)))).toBe("Roster");
  });

  it("moves the pin forward and never back", () => {
    const start = context(1);
    const { pin } = coreRosterAccept(start, ck, epoch, 200, served(1, 1));
    const next = corePinRoster(start, pin);
    expect(next.roster_seq).toBe(3);
    expect(refusal(() => corePinRoster(next, { roster_seq: 2, transcript: pin.transcript }))).toBe(
      "Roster",
    );
  });

  it("answers from a cached roster only for a signer of its own epoch", () => {
    const roster: CoreRoster = coreRosterAccept(context(1), ck, epoch, 200, served(1, 1)).roster;
    const alpha = fixture.alpha_device_id;
    expect(coreRosterAnswersFor(roster, roster.key_epoch, alpha)).toBe(true);
    expect(coreRosterAnswersFor(roster, roster.key_epoch + 1, alpha)).toBe(false);
    expect(coreRosterAnswersFor(roster, roster.key_epoch, fixture.beta_device_id)).toBe(false);
    // A constraint left out is not checked.
    expect(coreRosterAnswersFor(roster, undefined, undefined)).toBe(true);
  });
});
