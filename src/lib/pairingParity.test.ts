import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import init from "../pkg/sealbook_wasm.js";
import {
  coreConfirmationGroups,
  coreErrorOf,
  coreLoginStartRequest,
  coreNewDevice,
  coreOpaqueLoginStart,
  coreFormatConfirmation,
  coreNormalizeConfirmation,
  corePairApprove,
  corePairApprovePath,
  corePairJoinAccept,
  corePairJoinBody,
  corePairPath,
  corePairPreview,
  corePairStatus,
  coreRosterAcceptSealed,
} from "./wasm";
import { confirmationGroups, formatConfirmation, normalizeConfirmation } from "./pairing";
import { deviceFromSecrets, toCoreState } from "./clientCore";
import { readFixture } from "../test/fixtures";
import type {
  CoreDevice,
  CorePairPreview,
  PairJoined,
  PairStatus,
  VerifiedRoster,
} from "../pkg/sealbook_wasm.js";

/**
 * The shared pairing fixture, through the same core the CLI and Android run.
 *
 * Held to the same document as `sealbook-core/tests/pairing.rs` and Android's
 * `DevicePairingTest`, so a pairing that differs here differs from the other
 * two clients rather than from a copy of their output.
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

type Fixture = {
  collection_id: string;
  collection_key: string;
  key_epoch: number;
  approver: Device;
  verified: VerifiedRoster;
  joining: Device;
  pair_id: string;
  pair_code: string;
  confirm: string;
  join_response: string;
  joined: PairJoined;
  preview_response: string;
  preview: CorePairPreview;
  join_refusals: { what: string; response: string; refusal: { refusal: string } }[];
  approve_refusals: {
    what: string;
    response: string;
    held_epoch: number;
    refusal: { refusal: string };
  }[];
  codes: { typed: string; normalized: string; formatted: string; groups: string[] }[];
  paths: { key: string; path: string; approve_path: string }[];
  polls: { what: string; status: number; body: string; state: PairStatus }[];
};

const fixture = JSON.parse(readFixture("pairing/handshake.json")) as Fixture;

function context() {
  return {
    collection_id: fixture.collection_id,
    device_id: fixture.approver.device.device_id,
    roster_seq: fixture.verified.pin.roster_seq,
    roster_transcript: fixture.verified.pin.transcript,
  };
}

function approve(typed: string, preview: CorePairPreview = fixture.preview) {
  return corePairApprove(
    fixture.approver.mldsa_seed,
    fixture.approver.ed25519_sk,
    context(),
    fixture.collection_key,
    fixture.key_epoch,
    fixture.verified,
    preview,
    typed,
  );
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
  // The one property the whole handshake rests on: each side computes the code
  // itself, so a user comparing two codes confirms the joining device's keys
  // and the device list both sides are anchored on.
  it("computes the same code on both sides from what each is served", () => {
    const joined = corePairJoinAccept(fixture.joining.device, fixture.join_response);
    const preview = corePairPreview(
      fixture.collection_key,
      fixture.key_epoch,
      fixture.verified,
      fixture.preview_response,
    );
    expect(joined.confirm).toBe(fixture.confirm);
    expect(preview.confirm).toBe(fixture.confirm);
    expect(joined).toEqual(fixture.joined);
    expect(preview).toEqual(fixture.preview);
  });

  // The anchor becomes this device's pin, so its first roster fetch is checked
  // against something the user vouched for rather than against a MAC keyed from
  // a collection key the same server supplies.
  it("pins the anchor the code commits to", () => {
    const joined = corePairJoinAccept(fixture.joining.device, fixture.join_response);
    expect(joined.pin).toEqual(fixture.verified.pin);
  });

  it("refuses each join response the fixture names", () => {
    for (const refusal of fixture.join_refusals) {
      expect(refusalOf(() => corePairJoinAccept(fixture.joining.device, refusal.response))).toEqual(
        refusal.refusal,
      );
    }
  });

  it("refuses each pairing request the fixture names", () => {
    for (const refusal of fixture.approve_refusals) {
      expect(
        refusalOf(() =>
          corePairPreview(
            fixture.collection_key,
            refusal.held_epoch,
            fixture.verified,
            refusal.response,
          ),
        ),
      ).toEqual(refusal.refusal);
    }
  });

  // The typed code is compared against the one recomputed at approval time, not
  // against anything the server supplied.
  it("refuses a typed code that is not this pairing's", () => {
    expect(refusalOf(() => approve("AAAA BBBB CCCC DDDD EEEE FFFF GG"))).toEqual({
      refusal: "TypedCode",
    });
  });

  it("accepts the code in every form it is displayed in", () => {
    for (const typed of [
      fixture.confirm,
      coreFormatConfirmation(fixture.confirm),
      coreFormatConfirmation(fixture.confirm).toLowerCase(),
      coreConfirmationGroups(fixture.confirm).join("-"),
    ]) {
      expect(approve(typed).confirm).toBe(fixture.confirm);
    }
  });

  // The roster step is what lets the joining device, and every other device,
  // accept the new one without trusting the server's device list. It has to
  // verify from this device's own pin: a step it could not check is one it
  // should not have sent.
  it("signs a roster step that adds the device and verifies from this pin", () => {
    const approval = approve(fixture.confirm);
    const next = JSON.parse(approval.roster_json) as {
      roster_seq: number;
      key_epoch: number;
      devices: { device_id: string }[];
    };
    expect(next.roster_seq).toBe(fixture.verified.roster.roster_seq + 1);
    expect(next.key_epoch).toBe(fixture.verified.roster.key_epoch);
    expect(next.devices.map((device) => device.device_id)).toEqual([
      ...fixture.verified.roster.devices.map((device) => device.device_id),
      fixture.joining.device.device_id,
    ]);
    const verified = coreRosterAcceptSealed(
      context(),
      fixture.collection_key,
      approval.roster_json,
    );
    expect(verified.pin.roster_seq).toBe(next.roster_seq);
  });

  it("sends the canonical code and a wrap addressed to the joining device", () => {
    const approval = approve(coreFormatConfirmation(fixture.confirm));
    const body = JSON.parse(approval.body) as {
      confirmation: string;
      wrap: { recipient_kind: string; recipient_id: string; wrapped_ck: string };
    };
    expect(approval.confirm).toBe(fixture.confirm);
    expect(body.confirmation).toBe(fixture.confirm);
    expect(body.wrap.recipient_kind).toBe("device");
    expect(body.wrap.recipient_id).toBe(fixture.joining.device.device_id);
    expect(body.wrap.wrapped_ck.length).toBeGreaterThan(0);
  });

  it("signs the enrollment the server checks", () => {
    const body = JSON.parse(
      corePairJoinBody(
        "alice",
        fixture.joining.device,
        fixture.joining.mldsa_seed,
        fixture.joining.ed25519_sk,
      ),
    ) as {
      username: string;
      device: { device_id: string };
      enrollment_signature: { mldsa: string; ed25519: string };
    };
    expect(body.username).toBe("alice");
    expect(body.device.device_id).toBe(fixture.joining.device.device_id);
    expect(body.enrollment_signature.mldsa.length).toBeGreaterThan(0);
    expect(body.enrollment_signature.ed25519.length).toBeGreaterThan(0);
  });

  it("normalizes and groups each code the fixture names", () => {
    for (const code of fixture.codes) {
      expect(coreNormalizeConfirmation(code.typed)).toBe(code.normalized);
      expect(coreFormatConfirmation(code.typed)).toBe(code.formatted);
      expect(coreConfirmationGroups(code.typed)).toEqual(code.groups);
    }
  });

  // The display helpers in `pairing.ts` stay pure TypeScript so components do
  // not load the wasm module to show a code. This is what holds them to the
  // same grouping the other clients show, since the user compares the two by
  // eye across two screens.
  it("shows each code exactly as core would group it", () => {
    for (const code of fixture.codes) {
      expect(normalizeConfirmation(code.typed)).toBe(code.normalized);
      expect(formatConfirmation(code.typed)).toBe(code.formatted);
      expect(confirmationGroups(code.typed)).toEqual(code.groups);
    }
  });

  // The server matches a code on its whitespace-normalized form, so a code typed
  // with a stray double space has to resolve to the same path rather than to a
  // 404 the host reports as "expired".
  it("resolves each lookup key to the path the fixture names", () => {
    for (const path of fixture.paths) {
      expect(corePairPath(path.key)).toBe(path.path);
      expect(corePairApprovePath(path.key)).toBe(path.approve_path);
    }
  });

  // Expiry is a 404 and not a status in the body, so a host that read only the
  // body would poll a dead pairing for ever.
  it("reports the state each poll answer the fixture names implies", () => {
    for (const poll of fixture.polls) {
      expect(corePairStatus(poll.status, poll.body)).toBe(poll.state);
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
