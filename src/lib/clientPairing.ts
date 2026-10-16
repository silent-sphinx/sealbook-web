import { bytesFromJson } from "./bytes";
import { createDevice, pairConfirmationCode, pairGrantSign, rosterSealDevice, wrapCkForDevice } from "./wasm";
import { pinSealedRoster, syncRoster, verifiedRosterChain } from "./roster";
import { apiRoot, getJson, postJson } from "./transport";
import { normalizeConfirmation } from "./pairing";
import { checkProtocol, deviceBody, deviceFromKeys, enrollSig, type Session } from "./clientCore";
import { rotateVault } from "./clientAuth";
import type { DevicePublic, RosterVerified } from "./types";

export type PairPreview = {
  pairId: string;
  /**
   * The code this device computed, not the one the server sent.
   *
   * Computed over the joining device's keys as previewed *and* the anchor of a
   * roster this device verified from its own pin. Displaying the server's code
   * instead would make the user's comparison prove only that the joining
   * device's code reached the server unmodified: a server that substituted the
   * keys could show the real code and keep the ones it had swapped in.
   */
  confirm: string;
  device: DevicePublic;
  /** The roster being extended, which the code above commits to. */
  rosterSeq: number;
};

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
  const joined = await postJson<{
    pair_id: string;
    pair_code: string;
    confirm: string;
    roster_seq: number;
    roster_transcript: string;
  }>(`${root}/v1/pair/join`, {
    username,
    device: deviceBody(device),
    enrollment_signature: enrollSig(device),
  });
  if (!joined.roster_seq || !joined.roster_transcript) {
    throw new Error("The server sent no device roster for this account to anchor on");
  }
  // The code covers the roster this device is told the account is on, so that the
  // user comparing two codes also confirms the approver's view of the roster to
  // this device. The anchor becomes this device's roster pin below, so its first
  // roster fetch is checked against something the user vouched for rather than
  // against a MAC keyed from a collection key the same server supplies.
  const confirm = pairConfirmationCode(
    joined.pair_id,
    device.device_id,
    device.mldsa_pk,
    device.ed25519_pk,
    device.hpke_pk,
    joined.roster_seq,
    joined.roster_transcript,
  );
  if (joined.confirm !== confirm) {
    throw new Error("Pairing confirmation mismatch");
  }
  const state = deviceFromKeys(root, username, "", "", device);
  // The anchor the user is about to confirm by comparing codes. Pinning it here
  // means the roster this device is served after the approval has to be a signed
  // step from the one the code committed to.
  state.roster_seq = joined.roster_seq;
  state.roster_transcript = joined.roster_transcript;
  return {
    pairId: joined.pair_id,
    pairCode: joined.pair_code,
    confirm,
    rosterSeq: joined.roster_seq,
    rosterTranscript: joined.roster_transcript,
    state,
  };
}

export async function pairReady(server: string, pairCode: string): Promise<boolean> {
  const status = await getJson<{ status: string }>(`${apiRoot(server)}/v1/pair/${encodeURIComponent(pairCode)}`);
  return status.status === "ready";
}

export async function pairPreview(
  session: Session,
  pairCode: string,
): Promise<PairPreview> {
  const resp = await getJson<{
    pair_id: string;
    confirm: string;
    device?: DevicePublic | null;
    roster_seq?: number | null;
  }>(`${apiRoot(session.state.server)}/v1/pair/${encodeURIComponent(pairCode)}`, session.token);
  if (!resp.device) {
    throw new Error("expired");
  }
  const anchor = await approvalAnchor(session, resp.device, resp.roster_seq ?? null);
  const confirm = pairConfirmationCode(
    resp.pair_id,
    resp.device.device_id,
    resp.device.mldsa_pk,
    resp.device.ed25519_pk,
    resp.device.xwing_hpke_pk,
    anchor.pin_seq,
    anchor.pin_transcript,
  );
  if (resp.confirm !== confirm) {
    // The two sides folded different things into the code: either the roster
    // moved under the pairing, or the keys in this preview are not the ones the
    // joining device is holding.
    throw new Error(
      "Pairing confirmation mismatch: this device and the new one do not agree on the account's " +
        "devices. Start the pairing again.",
    );
  }
  return {
    pairId: resp.pair_id,
    confirm,
    device: resp.device,
    rosterSeq: anchor.pin_seq,
  };
}

/**
 * The verified roster an approval extends, and the pin the pairing code covers.
 *
 * Checks everything about the approval that does not need the typed code, so a
 * preview that cannot lead to a valid approval fails before the user is asked to
 * compare anything.
 */
async function approvalAnchor(
  session: Session,
  joining: DevicePublic,
  joinedAt: number | null,
): Promise<RosterVerified> {
  const verified = await verifiedRosterChain(session);
  const roster = verified.roster;
  if (roster.key_epoch !== session.keyEpoch) {
    throw new Error(
      "The vault key has been rotated since this device fetched it. Sign in again and approve " +
        "the new device after that.",
    );
  }
  if (roster.devices.some((device) => device.device_id === joining.device_id)) {
    throw new Error("That device is already enrolled.");
  }
  if (joinedAt !== null && joinedAt !== verified.pin_seq) {
    // A rotation or another pairing landed while this one was waiting, so the
    // two sides would fold different anchors into the code.
    throw new Error(
      `The new device started pairing against roster ${joinedAt} but this account is now on ` +
        `roster ${verified.pin_seq}. Start the pairing again.`,
    );
  }
  session.roster = roster;
  return verified;
}

/**
 * Approves a joining device: wraps the collection key for it, signs the grant,
 * and signs the roster that adds it.
 *
 * The confirmation code is recomputed here from a roster this device verified,
 * and the typed code is compared against that rather than against anything the
 * server supplied. The roster step is what lets the joining device, and every
 * other device, accept the new one without trusting the server's device list.
 */
export async function pairApprove(
  session: Session,
  pairCode: string,
  preview: PairPreview,
  confirmation: string,
): Promise<string> {
  const { state } = session;
  const anchor = await approvalAnchor(session, preview.device, preview.rosterSeq);
  const confirm = pairConfirmationCode(
    preview.pairId,
    preview.device.device_id,
    preview.device.mldsa_pk,
    preview.device.ed25519_pk,
    preview.device.xwing_hpke_pk,
    anchor.pin_seq,
    anchor.pin_transcript,
  );
  // Codes are shown in groups of four, so compare on the normalised form but
  // send the canonical one.
  if (normalizeConfirmation(confirmation) !== confirm) {
    throw new Error("That confirmation code does not match the one for this pairing.");
  }
  const wrap = wrapCkForDevice(session.collectionKey, preview.device.xwing_hpke_pk);
  const mldsaSeed = bytesFromJson(state.mldsa_seed);
  const ed25519Sk = bytesFromJson(state.ed25519_sk);
  const grant = pairGrantSign(
    mldsaSeed,
    ed25519Sk,
    preview.pairId,
    state.device_id,
    preview.device.device_id,
    preview.device.mldsa_pk,
    preview.device.ed25519_pk,
    preview.device.xwing_hpke_pk,
    confirm,
  );
  const roster = rosterSealDevice(
    state.collection_id,
    anchor.roster.roster_seq + 1,
    anchor.roster.key_epoch,
    [...anchor.roster.devices, preview.device],
    anchor.roster.phrase_mldsa_pk,
    anchor.roster.phrase_ed25519_pk,
    state.device_id,
    mldsaSeed,
    ed25519Sk,
    session.collectionKey,
  );
  await postJson<{ status: string }>(
    `${apiRoot(state.server)}/v1/pair/${encodeURIComponent(pairCode)}/approve`,
    {
      wrap: {
        recipient_kind: "device",
        recipient_id: preview.device.device_id,
        hpke_enc: wrap.enc,
        wrapped_ck: wrap.wrapped_ck,
        ciphersuite: wrap.ciphersuite,
      },
      grant,
      confirmation: confirm,
      roster,
    },
    session.token,
  );
  // The account is on the roster this device just signed, so move the pin onto
  // it rather than waiting to be served it back.
  pinSealedRoster(session, roster);
  return confirm;
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
  if (deviceId === session.state.device_id) {
    throw new Error("You cannot revoke the device you are signed in on.");
  }
  return rotateVault(session, deviceId, password, onProgress);
}
