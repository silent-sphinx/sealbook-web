import { b64ToByteArray, bytesFromJson } from "./bytes";
import {
  coreAcceptManifestSeq,
  coreManifestAbsenceOk,
  coreManifestAccept,
  coreManifestApply,
  coreManifestBucketsAccept,
  coreManifestBucketsFromWhole,
  coreManifestBucketsRequest,
  coreManifestRequest,
  coreManifestSigner,
  coreManifestVerify,
  coreErrorOf,
  createEnrollment,
  objectContentDigest,
  sealObject,
  unwrapCk,
} from "./wasm";
import { describeError, log, serverHost } from "./log";
import { ManifestError, rosterDevices } from "./roster";
import { apiRoot, getJson, getText } from "./transport";
import { PROTOCOL_VERSION, speaksProtocol } from "./protocol";
import type {
  DeviceOut,
  DeviceState,
  KeyWrap,
  ManifestBody,
  ManifestEntry,
  Roster,
} from "./types";
import type {
  BucketedManifest,
  CoreDevice,
  ManifestContext,
  ManifestPlan,
  ManifestSigner,
} from "../pkg/sealbook_wasm.js";

export type { BucketedManifest, ManifestPlan };

export type Session = {
  state: DeviceState;
  collectionKey: string;
  token: string;
  latestRevision: number;
  /**
   * The collection key epoch this session's key belongs to. Bumped server-side
   * whenever a device is revoked, which rotates the key; a session holding an
   * older epoch must re-fetch its wrap before it can decrypt anything.
   */
  keyEpoch: number;
  /**
   * Highest manifest sequence this session has accepted.
   *
   * Remembered so the server cannot serve an older manifest, or claim to have
   * none, once this device has seen one. It is the only freshness available: the
   * server is the sole source of manifests, so it can still freeze a client at a
   * real past state, just not rewind it.
   */
  manifestSeq: number;
  /**
   * The roster this session last verified, with the epoch it was verified at.
   *
   * Checking a manifest signature needs the device set, and fetching it per
   * write was a request per write. It is reused while the epoch matches: a
   * revocation is always a rotation, so the epoch moving is what a device having
   * been removed looks like from here, and a signer the cache does not hold is
   * what a pairing elsewhere looks like. Either refetches.
   */
  roster?: Roster;
  /**
   * True when a recovery enrolled this device and the collection key has still
   * not been rotated, so the phrase used then, and any other copy of it, can
   * still open this vault. The server refuses writes until that rotation
   * happens; `completeRecoveryRotation` is what finishes it.
   */
  recoveryPending?: boolean;
  offline?: boolean;
};

/**
 * Runs vault reads and writes one at a time, per collection.
 *
 * A confirmed write advances the manifest high-water mark, while a read already
 * in flight answers from the snapshot it opened before that write committed.
 * Overlapped, the older sequence is indistinguishable from a rollback, so
 * `verifyManifest` reports tampering against a server that did nothing wrong.
 * Keyed by collection, not held on the session, because a rotation signs in
 * again and carries on against a different session object for the same vault.
 */
const vaultQueues = new Map<string, Promise<void>>();

export function serializeVault<T>(collectionId: string, run: () => Promise<T>): Promise<T> {
  const queue = vaultQueues.get(collectionId) ?? Promise.resolve();
  const result = queue.then(run);
  // Followers wait for their predecessor to settle, not to succeed: one caller's
  // failure is its own and must not be rethrown into the next.
  vaultQueues.set(
    collectionId,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

/**
 * Records the highest manifest sequence this device has accepted.
 *
 * Written through to the device state, not just the session, so that closing the
 * app and reopening it cannot be used to rewind the high-water mark.
 */
export function rememberManifestSeq(session: Session, seq: number): void {
  const next = coreAcceptManifestSeq(session.manifestSeq, seq);
  session.manifestSeq = next;
  session.state.manifest_seq = next;
}

/** Just what a manifest decision reads out of this session. */
export function manifestContext(session: Session): ManifestContext {
  return {
    collection_id: session.state.collection_id,
    device_id: session.state.device_id,
    manifest_seq: session.manifestSeq,
  };
}

/**
 * The roster a served manifest's signature is checked against.
 *
 * Fetched here because core names the epoch and the signer but cannot go and
 * get them, and nothing is needed at all when no manifest was served.
 */
async function devicesFor(
  session: Session,
  signer: ManifestSigner | undefined,
): Promise<CoreDevice[]> {
  if (!signer) {
    return [];
  }
  return rosterDevices(session, signer.key_epoch, signer.device_id);
}

/**
 * Raises what core refused as the class this app's callers already catch.
 *
 * Core states the condition; the lead-in a person reads is `friendlyError`'s.
 */
function manifestFailure(err: unknown): Error {
  const core = coreErrorOf(err);
  if (core === null) {
    return err instanceof Error ? err : new Error(describeError(err));
  }
  return new ManifestError("detail" in core ? core.detail : core.kind);
}

/** The signer core named, with its refusal raised as this app's own class. */
function signerOf(body: string): ManifestSigner | undefined {
  try {
    return coreManifestSigner(body);
  } catch (err) {
    throw manifestFailure(err);
  }
}

/**
 * Fetches the manifest and checks it against the entries the server serves with it.
 *
 * Returns the state a write needs: the sequence to follow, the key epoch to sign
 * under, the revision to take next, and the entry set to amend.
 */
export async function manifestState(session: Session): Promise<{
  seq: number;
  keyEpoch: number;
  latestRevision: number;
  entries: ManifestEntry[];
}> {
  const context = manifestContext(session);
  const body = await getText(
    `${apiRoot(session.state.server)}${coreManifestRequest(context).path}`,
    session.token,
  );
  // Outside the try: a roster failure is the roster's to report, not a manifest
  // failure, and it has already been worded by `rosterDevices`.
  const devices = await devicesFor(session, signerOf(body));
  try {
    const outcome = coreManifestAccept(context, body, devices);
    if ("Signed" in outcome) {
      const { plan, entries } = outcome.Signed;
      log.debug("vault manifest verified", {
        seq: plan.manifest_seq,
        objects: entries.length,
        key_epoch: plan.key_epoch,
      });
      rememberManifestSeq(session, plan.manifest_seq);
      return {
        seq: plan.manifest_seq,
        keyEpoch: plan.key_epoch,
        latestRevision: plan.latest_revision,
        entries,
      };
    }
    // A collection no manifest-signing client has written yet. The epoch to
    // sign the next write under is the session's: there is no signed one to
    // read, and core will not guess.
    return {
      seq: 0,
      keyEpoch: session.keyEpoch,
      latestRevision: outcome.Unmanifested.latest_revision,
      entries: outcome.Unmanifested.entries,
    };
  } catch (err) {
    log.error("vault manifest refused", { reason: describeError(err) });
    throw manifestFailure(err);
  }
}

/**
 * Verifies a manifest served alongside pages of objects, against the entry set
 * those pages produced.
 *
 * The signature says an enrolled device vouched for this shape of the
 * collection; the digest says the shape is the one being served. A valid
 * signature over a different state is exactly what a rollback looks like, so
 * both are required.
 */
export async function verifyManifest(
  session: Session,
  manifestJson: string,
  entries: ManifestEntry[],
): Promise<void> {
  const context = manifestContext(session);
  // Read rather than reassembled: the signature covers the bytes the server
  // sent, and the manifest is what says which roster to check them against.
  const manifest = JSON.parse(manifestJson) as ManifestBody;
  const devices = await devicesFor(session, {
    key_epoch: manifest.key_epoch,
    device_id: manifest.device_id,
  });
  let plan: ManifestPlan;
  try {
    plan = coreManifestVerify(context, manifestJson, entries, devices);
  } catch (err) {
    log.error("vault manifest refused", {
      seq: manifest.manifest_seq,
      objects: entries.length,
      reason: describeError(err),
    });
    throw manifestFailure(err);
  }
  log.debug("vault manifest verified", {
    seq: plan.manifest_seq,
    objects: entries.length,
    key_epoch: plan.key_epoch,
  });
  rememberManifestSeq(session, plan.manifest_seq);
}

/** The rule for a server that served objects with no manifest at all. */
export function requireManifestAbsenceOk(session: Session): void {
  try {
    coreManifestAbsenceOk(manifestContext(session));
  } catch (err) {
    log.error("the vault was served with no manifest after this device had seen one", {
      seen_seq: session.manifestSeq,
    });
    throw manifestFailure(err);
  }
}

/**
 * Fetches the manifest and only the buckets these objects fall in.
 *
 * `manifestState` serves every entry in the collection, so a write that read it
 * moved bytes proportional to the whole vault and autosave of one note in a
 * large one re-downloaded the lot. The root is a hash of 256 bucket digests and
 * a write changes one of them per object, so this is the same guarantee over a
 * fraction of the entries.
 */
export async function manifestBucketState(
  session: Session,
  ids: string[],
): Promise<BucketedManifest> {
  const context = manifestContext(session);
  const body = await getText(
    `${apiRoot(session.state.server)}${coreManifestBucketsRequest(context, ids).path}`,
    session.token,
  );
  const devices = await devicesFor(session, signerOf(body));
  let outcome;
  try {
    outcome = coreManifestBucketsAccept(context, ids, body, devices);
  } catch (err) {
    log.error("vault manifest buckets refused", { reason: describeError(err) });
    throw manifestFailure(err);
  }
  if (outcome === "Unmanifested") {
    // A bucket answer carries no revision for the entries it did not serve, so
    // the revision this write takes cannot be chosen from it. It costs an extra
    // request, on a path nothing takes once anything has written a manifest.
    const whole = await manifestState(session);
    return coreManifestBucketsFromWhole(
      {
        manifest_seq: whole.seq,
        key_epoch: whole.keyEpoch,
        latest_revision: whole.latestRevision,
      },
      whole.entries,
    );
  }
  const { held } = outcome.Signed;
  log.debug("vault manifest verified", {
    seq: held.plan.manifest_seq,
    objects: held.object_count,
    key_epoch: held.plan.key_epoch,
  });
  rememberManifestSeq(session, held.plan.manifest_seq);
  return held;
}

/** What the manifest after a write has to carry. */
export function applyWrite(
  held: BucketedManifest,
  written: ManifestEntry[],
): { objectCount: number; root: string } {
  const next = coreManifestApply(held, written);
  return { objectCount: next.object_count, root: next.root };
}

export async function alignKeyEpoch(session: Session, keyEpoch: number): Promise<void> {
  if (session.keyEpoch === keyEpoch) {
    return;
  }
  const refreshed = await refreshCollectionKey(session);
  if (refreshed !== keyEpoch) {
    throw new Error(
      `The vault key has moved to epoch ${keyEpoch} and this device has epoch ${refreshed}. ` +
        "Nothing was saved. Sign in again and retry.",
    );
  }
}

export function entryFor(object: {
  id: string;
  revision: number;
  tombstone: boolean;
  nonce: string;
  ciphertext: string;
}): ManifestEntry {
  return {
    id: object.id,
    revision: object.revision,
    tombstone: object.tombstone,
    content_digest: objectContentDigest(object.nonce, object.ciphertext),
  };
}

export function sealPayload(
  session: Session,
  id: string,
  contentType: string,
  payload: string,
  revision: number,
) {
  return {
    revision,
    encrypted: sealObject(session.collectionKey, id, session.state.collection_id, contentType, payload),
  };
}

/**
 * Re-fetches this device's collection-key wrap after a rotation.
 *
 * Only the device's own X-Wing secret is needed to open it, so unlike a login
 * this does not require the password.
 */
export async function refreshCollectionKey(session: Session): Promise<number> {
  const { state, token } = session;
  const resp = await getJson<{ key_epoch: number; key_wraps: KeyWrap[] }>(
    `${apiRoot(state.server)}/v1/collections/${state.collection_id}/keys`,
    token,
  );
  const deviceWrap = resp.key_wraps.find(
    (wrap) => wrap.recipient_kind === "device" && wrap.recipient_id === state.device_id,
  );
  if (!deviceWrap) {
    log.error("this device has no key wrap in the current epoch", { key_epoch: resp.key_epoch });
    throw new Error(
      "This device no longer has access to the vault. It may have been revoked; sign in again.",
    );
  }
  // unwrapCk resolves the device wrap first and never touches the password or
  // salt, so empty values are correct here rather than a placeholder.
  session.collectionKey = unwrapCk(
    "",
    "",
    bytesFromJson(state.hpke_sk),
    state.device_id,
    JSON.stringify([deviceWrap]),
  );
  log.info("collection key refreshed", { from_epoch: session.keyEpoch, to_epoch: resp.key_epoch });
  session.keyEpoch = resp.key_epoch;
  return resp.key_epoch;
}

/**
 * Refuses a server speaking a protocol generation this build does not know.
 *
 * Called before the first exchange that carries real material, so that a
 * version mismatch is reported as itself. Without it the two builds get as far
 * as some field one of them encodes differently, and the failure surfaces as
 * whatever that field happens to be.
 */
export async function checkProtocol(root: string): Promise<void> {
  const report = await getJson<{ protocol?: string }>(`${root}/health/crypto`);
  log.info("server reached", {
    host: root ? serverHost(root) : "same-origin",
    server_protocol: report.protocol ?? "unknown",
    app_protocol: PROTOCOL_VERSION,
  });
  if (!speaksProtocol(report.protocol)) {
    throw new Error(
      `This server speaks protocol ${report.protocol ?? "an unknown version"}, ` +
        `and this app speaks ${PROTOCOL_VERSION}. Update whichever is older.`,
    );
  }
}

function deviceFromSecrets(
  server: string,
  username: string,
  accountId: string,
  collectionId: string,
  deviceId: string,
  kdfSalt: string,
  hpkeSk: string,
  mldsaSeed: string,
  ed25519Sk: string,
): DeviceState {
  return {
    server,
    username,
    account_id: accountId,
    collection_id: collectionId,
    device_id: deviceId,
    kdf_salt: b64ToByteArray(kdfSalt),
    hpke_sk: b64ToByteArray(hpkeSk),
    mldsa_seed: b64ToByteArray(mldsaSeed),
    ed25519_sk: b64ToByteArray(ed25519Sk),
    roster_seq: 0,
    roster_transcript: "",
  };
}

export function deviceFromEnrollment(
  server: string,
  username: string,
  accountId: string,
  collectionId: string,
  enrollment: ReturnType<typeof createEnrollment>,
): DeviceState {
  return deviceFromSecrets(
    server,
    username,
    accountId,
    collectionId,
    enrollment.device_id,
    enrollment.kdf_salt,
    enrollment.hpke_sk,
    enrollment.mldsa_seed,
    enrollment.ed25519_sk,
  );
}

export function deviceFromKeys(
  server: string,
  username: string,
  accountId: string,
  collectionId: string,
  device: DeviceOut,
): DeviceState {
  return deviceFromSecrets(
    server,
    username,
    accountId,
    collectionId,
    device.device_id,
    "",
    device.hpke_sk,
    device.mldsa_seed,
    device.ed25519_sk,
  );
}

export function deviceBody(device: DeviceOut) {
  return {
    device_id: device.device_id,
    mldsa_pk: device.mldsa_pk,
    ed25519_pk: device.ed25519_pk,
    xwing_hpke_pk: device.hpke_pk,
  };
}

export function enrollSig(device: DeviceOut) {
  return {
    mldsa: device.enrollment_mldsa,
    ed25519: device.enrollment_ed25519,
  };
}
