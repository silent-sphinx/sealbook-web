import {
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
  corePairStart,
  coreNewDevice,
} from "./wasm";
import { bytesFromJson } from "./bytes";
import { pinSealedRoster, syncRoster, verifiedRosterCore } from "./roster";
import { apiRoot, getJson, getTextStatus, postJson, postText } from "./transport";
import { checkProtocol, deviceFromSecrets, type Session } from "./clientCore";
import { rotateVault } from "./clientAuth";
import type { PhraseConfirm, RotationOutcome } from "./clientRotation";
import type { CoreDevice, CorePairPreview, CorePairResponse } from "./wasm";
import type { DeviceState, Roster } from "./types";

/**
 * Pairing over a PAKE. The joining device shows an eight-word code; the user
 * types or scans it into a device that is already signed in. Only the first
 * three words reach the server. The other five are the password for a CPace run
 * bound to the joining device's keys, so the two devices only agree if both
 * hold the same code and the approving device is looking at the keys the
 * joining device actually has. Nothing is compared by eye. The steps are
 * documented on `sealbook_core::pairing`.
 */

export type PairPreview = CorePairPreview;
export type PairResponse = CorePairResponse;

export type DeviceSummary = {
  device_id: string;
  mldsa_pk: string;
  ed25519_pk: string;
  xwing_hpke_pk: string;
};

/**
 * A pairing this device has asked to join. `secret` is this device's half of
 * the CPace run and lives in memory only; `state` has no roster pin until the
 * pairing is approved, so it is not persisted before then.
 */
export type JoinPairing = {
  pairId: string;
  /** The eight words to show. */
  code: string;
  /** The same code, as a QR code holds it. */
  qrText: string;
  device: CoreDevice;
  secret: string;
  state: DeviceState;
};

export type PairJoinStep =
  | { kind: "wait"; afterMs: number }
  | { kind: "ready"; state: DeviceState }
  | { kind: "expired" };

export type PairPreviewStep =
  | { kind: "wait"; afterMs: number }
  | { kind: "preview"; preview: PairPreview }
  | { kind: "expired" };

export async function pairJoin(server: string, username: string): Promise<JoinPairing> {
  const root = apiRoot(server);
  await checkProtocol(root);
  // One generator for every new device, whether it arrives by registering,
  // recovering or pairing, so the three cannot drift apart again.
  const generated = coreNewDevice();
  const device: CoreDevice = generated.device;
  const started = corePairStart(username, device, generated.mldsa_seed, generated.ed25519_sk);
  const served = await postJson<unknown>(`${root}/v2/pair/join`, JSON.parse(started.body));
  const joined = corePairJoinAccept(JSON.stringify(served));
  return {
    pairId: joined.pair_id,
    code: started.code,
    qrText: started.qr_text,
    device,
    secret: started.state,
    state: deviceFromSecrets(root, username, generated),
  };
}

/**
 * One poll of a pairing this device is joining, acted on. When the approving
 * device has answered, this sends the reply sealed for it, with `description`
 * saying what this device is. When the pairing is approved, this opens the
 * roster pin it carries: the state it returns then is pinned and can sign in.
 */
export async function pairJoinStep(
  pairing: JoinPairing,
  description: string,
): Promise<PairJoinStep> {
  const root = pairing.state.server;
  let status: number | undefined;
  let text = "";
  try {
    ({ status, text } = await getTextStatus(`${root}${corePairPath(pairing.pairId)}`));
  } catch {
    status = undefined;
  }
  const decision = corePairJoinPoll(status, text);
  if (decision === "Ready") {
    const pin = corePairFinish(pairing.secret, pairing.device, pairing.pairId, text);
    return {
      kind: "ready",
      // The approver vouches for the manifest sequence too. Taking it as this
      // device's own high-water mark is what stops a server serving a manifest
      // older than the one the approver had seen.
      state: {
        ...pairing.state,
        roster_seq: pin.roster_seq,
        roster_transcript: pin.transcript,
        manifest_seq: pin.manifest_seq,
      },
    };
  }
  if (decision === "Expired") return { kind: "expired" };
  if (decision === "Confirm") {
    const reply = corePairConfirm(pairing.secret, pairing.device, pairing.pairId, text, description);
    try {
      await postText(`${root}${corePairConfirmPath(pairing.pairId)}`, reply);
    } catch {
      // Treated like a poll that got no answer: the next poll still says
      // `Confirm`, so the reply is sent again, until the pairing expires.
      const retry = corePairJoinPoll(undefined, "");
      return { kind: "wait", afterMs: typeof retry === "object" ? retry.Wait.after_ms : 0 };
    }
    return { kind: "wait", afterMs: 0 };
  }
  return { kind: "wait", afterMs: decision.Wait.after_ms };
}

/**
 * Answers a code typed or scanned on this signed-in device. A string that is not
 * a pairing code is refused before anything is sent, and the checks that need no
 * reply from the joining device are made before the code is spent.
 */
export async function pairRespond(session: Session, typed: string): Promise<PairResponse> {
  const root = apiRoot(session.state.server);
  const path = corePairLookupPath(typed);
  const served = await getJson<unknown>(`${root}${path}`, session.token);
  // The roster is one this device verified from its own pin, never the
  // server's device list.
  const verified = await verifiedRosterCore(session);
  const responded = corePairRespond(
    session.collectionKey,
    session.keyEpoch,
    verified,
    session.state.username,
    typed,
    JSON.stringify(served),
  );
  await postJson<unknown>(
    `${root}${corePairRespondPath(responded.response.nameplate)}`,
    JSON.parse(responded.body),
    session.token,
  );
  return responded.response;
}

/**
 * One poll of a pairing this device has answered. A reply that does not open
 * means the code was mistyped or the keys were swapped; the code is then spent,
 * so the pairing is cancelled before the refusal is thrown.
 */
export async function pairPreviewStep(
  session: Session,
  response: PairResponse,
): Promise<PairPreviewStep> {
  const root = apiRoot(session.state.server);
  let status: number | undefined;
  let text = "";
  try {
    ({ status, text } = await getTextStatus(
      `${root}${corePairPath(response.nameplate)}`,
      session.token,
    ));
  } catch {
    status = undefined;
  }
  const decision = corePairApprovePoll(status, text);
  if (decision === "Expired") return { kind: "expired" };
  if (decision !== "Preview") return { kind: "wait", afterMs: decision.Wait.after_ms };
  const verified = await verifiedRosterCore(session);
  try {
    const preview = corePairPreview(
      session.collectionKey,
      session.keyEpoch,
      verified,
      response,
      text,
    );
    session.roster = JSON.parse(verified.roster_json) as Roster;
    return { kind: "preview", preview };
  } catch (err) {
    // The refusal is what the user has to see. A cancel that fails changes
    // nothing they can act on: the code is spent either way, and the server
    // drops the pairing when it expires.
    await pairCancel(session, response).catch(() => undefined);
    throw err;
  }
}

/**
 * Approves the device a preview showed: wraps the collection key for it, signs
 * the grant and the roster step that adds it, and seals that step's pin for it.
 *
 * The roster is verified again here rather than reused from the preview: the
 * user has been looking at a screen in between, and a rotation or another
 * pairing may have landed.
 */
export async function pairApprove(
  session: Session,
  response: PairResponse,
  preview: PairPreview,
): Promise<void> {
  const { state } = session;
  const verified = await verifiedRosterCore(session);
  const approval = corePairApprove(
    bytesFromJson(state.mldsa_seed),
    bytesFromJson(state.ed25519_sk),
    {
      collection_id: state.collection_id,
      device_id: state.device_id,
      roster_seq: state.roster_seq ?? 0,
      roster_transcript: state.roster_transcript ?? "",
    },
    session.collectionKey,
    session.keyEpoch,
    verified,
    response,
    preview,
    session.manifestSeq,
  );
  await postJson<unknown>(
    `${apiRoot(state.server)}${corePairApprovePath(response.nameplate)}`,
    JSON.parse(approval.body),
    session.token,
  );
  // The account is on the roster this device just signed, so move the pin onto
  // it rather than waiting to be served it back.
  pinSealedRoster(session, JSON.parse(approval.roster_json) as Roster);
}

/** Gives up on a pairing this device answered. */
export async function pairCancel(session: Session, response: PairResponse): Promise<void> {
  await postText(
    `${apiRoot(session.state.server)}${corePairCancelPath(response.nameplate)}`,
    "",
    session.token,
  );
}

/**
 * The account's devices, from the verified roster rather than the server's list.
 *
 * The server's own word for which devices exist is what the roster replaces: a
 * device the server added to that list would be shown to the user as theirs, and
 * wrapped for at the next rotation. The server no longer serves such a list.
 */
export async function listDevices(session: Session): Promise<DeviceSummary[]> {
  return (await syncRoster(session)).devices;
}

/**
 * Revokes other devices and rotates the vault key away from them, in one rotation.
 *
 * Removing a device is not enough on its own: it still holds the collection key
 * and any copy of the ciphertext it kept. So the key is replaced, every object
 * is re-encrypted under the new one, and the new key is wrapped afresh for each
 * device that keeps access. The old recovery phrase was wrapped to the old key,
 * so a new phrase is issued in the same operation and returned here -- the
 * caller must show it to the user, because the previous one stops working.
 *
 * `onProgress` reports re-encryption progress; a large vault takes a while.
 */
export async function revokeDevices(
  session: Session,
  deviceIds: string[],
  password: string,
  confirmPhrase: PhraseConfirm,
  onProgress?: (done: number, total: number) => void,
): Promise<RotationOutcome> {
  // Core refuses this too, but only once the rotation has a verified roster to
  // check against, which costs a fresh sign-in and the user's password first.
  if (deviceIds.includes(session.state.device_id)) {
    throw new Error("You cannot revoke the device you are signed in on.");
  }
  // Core wants them strictly ascending, which the signature then covers in order.
  const ids = [...new Set(deviceIds)].sort();
  return rotateVault(session, ids, password, confirmPhrase, onProgress);
}
