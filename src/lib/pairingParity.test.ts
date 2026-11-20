import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import init from "../pkg/sealbook_wasm.js";
import {
  coreErrorOf,
  coreLoginStartRequest,
  coreNewDevice,
  coreOpaqueLoginStart,
  corePairApprove,
  corePairApprovePath,
  corePairApprovePoll,
  corePairCancelPath,
  corePairConfirm,
  corePairConfirmPath,
  corePairFinish,
  corePairJoinAccept,
  corePairJoinPoll,
  corePairLookupPath,
  corePairPath,
  corePairPreview,
  corePairRespond,
  corePairRespondPath,
  coreRosterAcceptSealed,
} from "./wasm";
import { PAIR_CODE_WORDS, pairCodeWords } from "./pairing";
import { deviceFromSecrets, toCoreState } from "./clientCore";
import { readFixture } from "../test/fixtures";
import type {
  CoreDevice,
  CorePairPreview,
  CorePairResponse,
  CoreRosterPin,
  PairApprovePoll,
  PairJoinPoll,
  PairJoined,
  PairResponded,
  PairStarted,
  VerifiedRoster,
} from "../pkg/sealbook_wasm.js";

/**
 * The shared pairing fixture, through the same core the CLI and Android run.
 *
 * Held to the same document as `sealbook-core/tests/pairing.rs` and Android's
 * `DevicePairingTest`, so a pairing that differs here differs from the other
 * clients rather than from a copy of their output. The fixture's CPace shares
 * came from a seeded generator this build does not expose, so where a step is
 * random the test checks it against the other side's recorded half instead.
 */
beforeAll(async () => {
  const wasm = readFileSync(new URL("../pkg/sealbook_wasm_bg.wasm", import.meta.url));
  await init({ module_or_path: wasm });
});

type Device = {
  device: CoreDevice;
  mldsa_seed: string;
  ed25519_sk: string;
};

type Refusal = { refusal: string };

type Fixture = {
  collection_id: string;
  collection_key: string;
  key_epoch: number;
  username: string;
  description: string;
  approver: Device;
  verified: VerifiedRoster;
  joining: Device;
  pair_id: string;
  started: PairStarted;
  join_response: string;
  joined: PairJoined;
  typed: string;
  pending_response: string;
  responded: PairResponded;
  responded_response: string;
  confirm_body: string;
  confirmed_response: string;
  preview: CorePairPreview;
  ready_response: string;
  approved_roster_json: string;
  finished: CoreRosterPin;
  respond_refusals: {
    what: string;
    typed: string;
    response: string;
    held_epoch: number;
    refusal: Refusal;
  }[];
  preview_refusals: { what: string; response: CorePairResponse; body: string; refusal: Refusal }[];
  finish_refusals: { what: string; body: string; refusal: Refusal }[];
  codes: { typed: string; path: string | null; refusal: Refusal | null }[];
  paths: {
    key: string;
    path: string;
    respond: string;
    confirm: string;
    approve: string;
    cancel: string;
  }[];
  join_polls: { what: string; status: number | null; body: string; decision: PairJoinPoll }[];
  approve_polls: {
    what: string;
    status: number | null;
    body: string;
    decision: PairApprovePoll;
  }[];
};

const fixture = JSON.parse(readFixture("pairing/handshake.json")) as Fixture;

/** The sequence the fixture was generated with; core's pairing tests use the same. */
const APPROVER_MANIFEST_SEQ = 9;

function context() {
  return {
    collection_id: fixture.collection_id,
    device_id: fixture.approver.device.device_id,
    roster_seq: fixture.verified.pin.roster_seq,
    roster_transcript: fixture.verified.pin.transcript,
  };
}

function approve(preview: CorePairPreview = fixture.preview) {
  return corePairApprove(
    fixture.approver.mldsa_seed,
    fixture.approver.ed25519_sk,
    context(),
    fixture.collection_key,
    fixture.key_epoch,
    fixture.verified,
    fixture.responded.response,
    preview,
    APPROVER_MANIFEST_SEQ,
  );
}

function preview(response: CorePairResponse, body: string) {
  return corePairPreview(
    fixture.collection_key,
    fixture.key_epoch,
    fixture.verified,
    response,
    body,
  );
}

function finish(body: string) {
  return corePairFinish(fixture.started.state, fixture.joining.device, fixture.pair_id, body);
}

/** A served body with one field replaced, as a test stands in for the server. */
function withField(body: string, field: string, value: unknown): string {
  return JSON.stringify({ ...(JSON.parse(body) as Record<string, unknown>), [field]: value });
}

/** The refusal core raised, as the fixture records it, or what else happened. */
function refusalOf(call: () => unknown): unknown {
  try {
    call();
  } catch (err) {
    const core = coreErrorOf(err);
    return core?.kind === "Pair" ? (core as { kind: "Pair"; refusal: unknown }).refusal : err;
  }
  return "the call did not refuse";
}

describe("the shared pairing fixture", () => {
  it("reads the join answer the fixture names", () => {
    expect(corePairJoinAccept(fixture.join_response)).toEqual(fixture.joined);
  });

  it("answers the code for the device the server showed", () => {
    const responded = corePairRespond(
      fixture.collection_key,
      fixture.key_epoch,
      fixture.verified,
      fixture.username,
      fixture.typed,
      fixture.pending_response,
    );
    const { approver_share: _share, keys: _keys, ...bound } = responded.response;
    const { approver_share: _s, keys: _k, ...expected } = fixture.responded.response;
    expect(bound).toEqual(expected);
  });

  // The property the whole handshake rests on, across implementations: the
  // reply this build seals for the Rust approver's recorded answer opens under
  // that approver's keys, to the description it was given.
  it("seals a reply the other side opens", () => {
    const reply = JSON.parse(
      corePairConfirm(
        fixture.started.state,
        fixture.joining.device,
        fixture.pair_id,
        fixture.responded_response,
        fixture.description,
      ),
    ) as { hello: string };
    const opened = preview(
      fixture.responded.response,
      withField(fixture.confirmed_response, "hello", reply.hello),
    );
    expect(opened.description).toBe(fixture.description);
    expect(opened.device).toEqual(fixture.joining.device);
  });

  it("opens the recorded reply to the preview the fixture names", () => {
    expect(preview(fixture.responded.response, fixture.confirmed_response)).toEqual(
      fixture.preview,
    );
  });

  // The joining device's root of trust for the account's devices is the roster
  // the approver signed, reached under the run's keys rather than from the server.
  it("opens the recorded pin to the roster the approval signed", () => {
    expect(finish(fixture.ready_response)).toEqual(fixture.finished);
  });

  it("seals the pin of the roster step its own approval signs", () => {
    const approval = approve();
    const body = JSON.parse(approval.body) as { sealed_pin: string };
    const pin = finish(withField(fixture.ready_response, "sealed_pin", body.sealed_pin));
    const signed = coreRosterAcceptSealed(context(), fixture.collection_key, approval.roster_json);
    // The roster half is what the sealed step commits to; the manifest sequence
    // is the approver's own, sealed alongside it.
    expect(pin).toEqual({ ...signed.pin, manifest_seq: APPROVER_MANIFEST_SEQ });
    expect(signed.roster.devices.map((device) => device.device_id)).toContain(
      fixture.joining.device.device_id,
    );
  });

  it("refuses to approve a preview the run did not open", () => {
    const forged = { ...fixture.preview, hello: "A".repeat(86) };
    expect(refusalOf(() => approve(forged))).toEqual({ refusal: "CodeMismatch" });
  });

  it("refuses each answer the fixture names", () => {
    for (const refusal of fixture.respond_refusals) {
      expect(
        refusalOf(() =>
          corePairRespond(
            fixture.collection_key,
            refusal.held_epoch,
            fixture.verified,
            fixture.username,
            refusal.typed,
            refusal.response,
          ),
        )).toEqual(refusal.refusal);
    }
  });

  // A wrong secret word and keys the server swapped in look the same from here:
  // the reply does not open. That is the whole defence, so both are pinned.
  it("refuses each reply the fixture names", () => {
    expect(fixture.preview_refusals.length).toBeGreaterThan(0);
    for (const refusal of fixture.preview_refusals) {
      expect(refusalOf(() => preview(refusal.response, refusal.body))).toEqual(refusal.refusal);
    }
  });

  it("refuses each pin the fixture names", () => {
    for (const refusal of fixture.finish_refusals) {
      expect(refusalOf(() => finish(refusal.body))).toEqual(refusal.refusal);
    }
  });

  it("sends the server the nameplate and none of the secret words", () => {
    const words = pairCodeWords(fixture.started.code);
    expect(words).toHaveLength(PAIR_CODE_WORDS);
    const body = JSON.parse(fixture.started.body) as { nameplate: string; username: string };
    expect(body.username).toBe(fixture.username);
    expect(body.nameplate).toBe(words.slice(0, 3).join("-"));
    for (const secret of words.slice(3)) {
      expect(fixture.started.body).not.toContain(secret);
    }
  });

  it("reads each code the fixture names", () => {
    const read = fixture.codes.map((code) => {
      try {
        return { path: corePairLookupPath(code.typed), refusal: null };
      } catch {
        return { path: null, refusal: refusalOf(() => corePairLookupPath(code.typed)) };
      }
    });
    expect(read).toEqual(fixture.codes.map(({ path, refusal }) => ({ path, refusal })));
  });

  it("resolves each key to the paths the fixture names", () => {
    for (const path of fixture.paths) {
      expect(corePairPath(path.key)).toBe(path.path);
      expect(corePairRespondPath(path.key)).toBe(path.respond);
      expect(corePairConfirmPath(path.key)).toBe(path.confirm);
      expect(corePairApprovePath(path.key)).toBe(path.approve);
      expect(corePairCancelPath(path.key)).toBe(path.cancel);
    }
  });

  it("decides each poll the fixture names", () => {
    for (const poll of fixture.join_polls) {
      expect(corePairJoinPoll(poll.status ?? undefined, poll.body)).toEqual(poll.decision);
    }
    for (const poll of fixture.approve_polls) {
      expect(corePairApprovePoll(poll.status ?? undefined, poll.body)).toEqual(poll.decision);
    }
  });
});

describe("a device that has just joined by pairing", () => {
  // It has no account or collection id until its first login fills them in,
  // and that login hands its state to core. The challenge body here is not a
  // real one, so core refuses it; what matters is that it got as far as the
  // body rather than refusing the state.
  it("has a state core reads, so it can sign in", () => {
    const state = toCoreState(deviceFromSecrets("https://sealbook.test", "alice", coreNewDevice()));
    let refusal: unknown;
    try {
      coreLoginStartRequest(state, coreOpaqueLoginStart("a password").request, "{}");
    } catch (err) {
      refusal = err;
    }
    expect(String(refusal)).not.toMatch(/CoreDeviceState|UUID/);
  });
});
