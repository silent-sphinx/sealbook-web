import { bytesFromJson } from "./bytes";
import {
  corePairApprove,
  corePairApprovePath,
  corePairJoinAccept,
  corePairJoinBody,
  corePairPath,
  corePairPreview,
  corePairStatus,
  createDevice,
} from "./wasm";
import { pinSealedRoster, syncRoster, verifiedRosterCore } from "./roster";
import { apiRoot, getJson, getTextStatus, postJson } from "./transport";
import { checkProtocol, deviceFromKeys, type Session } from "./clientCore";
import { rotateVault } from "./clientAuth";
import type { CoreDevice, CorePairPreview, PairStatus } from "./wasm";
import type { Roster } from "./types";

/**
 * A pairing request as this device checked it.
 *
 * `confirm` is the code this device computed, not the one the server sent.
 * Computed over the joining device's keys as previewed *and* the anchor of a
 * roster this device verified from its own pin. Displaying the server's code
 * instead would make the user's comparison prove only that the joining device's
 * code reached the server unmodified: a server that substituted the keys could
 * show the real code and keep the ones it had swapped in.
 */
export type PairPreview = CorePairPreview;

export type DeviceSummary = {
  device_id: string;
  mldsa_pk: string;
  ed25519_pk: string;
  xwing_hpke_pk: string;
};

export async function pairJoin(
  server: string,
  username: string,
): Promise<{
  pairId: string;
  pairCode: string;
  confirm: string;
  rosterSeq: number;
  rosterTranscript: string;
  state: ReturnType<typeof deviceFromKeys>;
}> {
  const root = apiRoot(server);
  await checkProtocol(root);
  const device = createDevice();
  const keys: CoreDevice = {
    device_id: device.device_id,
    mldsa_pk: device.mldsa_pk,
    ed25519_pk: device.ed25519_pk,
    xwing_hpke_pk: device.hpke_pk,
  };
  const body = corePairJoinBody(
    username,
    keys,
    bytesFromJson(device.mldsa_seed),
    bytesFromJson(device.ed25519_sk),
  );
  const served = await postJson<unknown>(`${root}/v1/pair/join`, JSON.parse(body));
  // Core checks the anchor, computes the code this device shows, and refuses a
  // server copy that is not it.
  const joined = corePairJoinAccept(keys, JSON.stringify(served));
  const state = deviceFromKeys(root, username, "", "", device);
  // The anchor the user is about to confirm by comparing codes. Pinning it here
  // means the roster this device is served after the approval has to be a signed
  // step from the one the code committed to.
  state.roster_seq = joined.pin.roster_seq;
  state.roster_transcript = joined.pin.transcript;
  return {
    pairId: joined.pair_id,
    pairCode: joined.pair_code,
    confirm: joined.confirm,
    rosterSeq: joined.pin.roster_seq,
    rosterTranscript: joined.pin.transcript,
    state,
  };
}

/**
 * Where a pairing has got to, for the joining device's poll.
 *
 * The status code matters here, not just the body: a code that has timed out is
 * a 404, so a poll that read only the body would wait on a pairing that is gone.
 */
export async function pairStatus(server: string, pairCode: string): Promise<PairStatus> {
  const { status, text } = await getTextStatus(`${apiRoot(server)}${corePairPath(pairCode)}`);
  return corePairStatus(status, text);
}

export async function pairReady(server: string, pairCode: string): Promise<boolean> {
  return (await pairStatus(server, pairCode)) === "Ready";
}

export async function pairPreview(session: Session, pairCode: string): Promise<PairPreview> {
  const served = await getJson<unknown>(
    `${apiRoot(session.state.server)}${corePairPath(pairCode)}`,
    session.token,
  );
  // The anchor is a roster this device verified from its own pin, never the
  // server's device list. Core checks everything about the approval that does
  // not need the typed code, so a preview that cannot lead to a valid approval
  // fails before the user is asked to compare anything.
  const verified = await verifiedRosterCore(session);
  const preview = corePairPreview(
    session.collectionKey,
    session.keyEpoch,
    verified,
    JSON.stringify(served),
  );
  session.roster = JSON.parse(verified.roster_json) as Roster;
  return preview;
}

/**
 * Approves a joining device: wraps the collection key for it, signs the grant,
 * and signs the roster that adds it.
 *
 * The roster is verified again here rather than reused from the preview: the
 * user has been looking at a screen in between, and a rotation or another
 * pairing may have landed. The confirmation code is recomputed from that roster
 * and the typed code compared against it, never against anything the server
 * supplied. The roster step is what lets the joining device, and every other
 * device, accept the new one without trusting the server's device list.
 */
export async function pairApprove(
  session: Session,
  pairCode: string,
  preview: PairPreview,
  confirmation: string,
): Promise<string> {
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
    preview,
    confirmation,
  );
  await postJson<{ status: string }>(
    `${apiRoot(state.server)}${corePairApprovePath(pairCode)}`,
    JSON.parse(approval.body),
    session.token,
  );
  // The account is on the roster this device just signed, so move the pin onto
  // it rather than waiting to be served it back.
  pinSealedRoster(session, JSON.parse(approval.roster_json) as Roster);
  return approval.confirm;
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
 * Revokes another device and rotates the vault key away from it.
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
export async function revokeDevice(
  session: Session,
  deviceId: string,
  password: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ session: Session; phrase: string }> {
  // Core refuses this too, but only once the rotation has a verified roster to
  // check against, which costs a fresh sign-in and the user's password first.
  if (deviceId === session.state.device_id) {
    throw new Error("You cannot revoke the device you are signed in on.");
  }
  return rotateVault(session, deviceId, password, onProgress);
}
