import { b64ToByteArray, bytesFromJson } from "./bytes";
import {
  createEnrollment,
  manifestBucketOf,
  manifestBucketsApply,
  manifestBucketsBlob,
  manifestBucketsRoot,
  manifestVerify,
  manifestVerifyRoot,
  objectContentDigest,
  sealObject,
  unwrapCk,
} from "./wasm";
import { describeError, log, serverHost } from "./log";
import { ManifestError, rosterDevices } from "./roster";
import { apiRoot, getJson } from "./transport";
import { PROTOCOL_VERSION, speaksProtocol } from "./protocol";
import type {
  DeviceOut,
  DeviceState,
  KeyWrap,
  ManifestBody,
  ManifestEntry,
  Roster,
} from "./types";

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
  session.manifestSeq = seq;
  session.state.manifest_seq = seq;
}

type ManifestResponse = {
  manifest: ManifestBody | null;
  entries: ManifestEntry[];
};

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
  const { state, token } = session;
  const response = await getJson<ManifestResponse>(
    `${apiRoot(state.server)}/v1/collections/${state.collection_id}/manifest`,
    token,
  );
  if (!response.manifest) {
    // A collection no v3 client has written yet. Accepted only while this device
    // has never seen a manifest, so the server cannot pretend one away.
    if (session.manifestSeq > 0) {
      throw new ManifestError(
        `The server has no manifest for this vault, but this device has already seen ` +
          `sequence ${session.manifestSeq}. Refusing to continue.`,
      );
    }
    const latest = response.entries.reduce((high, entry) => Math.max(high, entry.revision), 0);
    return { seq: 0, keyEpoch: session.keyEpoch, latestRevision: latest, entries: response.entries };
  }
  await verifyManifest(session, response.manifest, response.entries);
  return {
    seq: response.manifest.manifest_seq,
    keyEpoch: response.manifest.key_epoch,
    latestRevision: response.manifest.latest_revision,
    entries: response.entries,
  };
}

/**
 * Verifies a manifest's signature and that it describes the given entries.
 *
 * The signature says an enrolled device vouched for this shape of the collection;
 * the digest says the shape is the one being served. A valid signature over a
 * different state is exactly what a rollback looks like, so both are required.
 */
export async function verifyManifest(
  session: Session,
  manifest: ManifestBody,
  entries: ManifestEntry[],
): Promise<void> {
  if (manifest.manifest_seq < session.manifestSeq) {
    log.error("vault manifest went backwards", {
      seen_seq: session.manifestSeq,
      served_seq: manifest.manifest_seq,
    });
    throw new ManifestError(
      `The vault went backwards: this device has seen manifest ${session.manifestSeq} but the ` +
        `server served ${manifest.manifest_seq}.`,
    );
  }
  if (manifest.object_count !== entries.length) {
    log.error("vault manifest commits to a different object count", {
      served_objects: entries.length,
      manifest_objects: manifest.object_count,
    });
    throw new ManifestError(
      `Server sent ${entries.length} objects but the manifest commits to ${manifest.object_count}.`,
    );
  }
  const devices = await rosterDevices(session, manifest.key_epoch, manifest.device_id);
  const signer = devices.find((device) => device.device_id === manifest.device_id);
  if (!signer) {
    log.error("vault manifest was signed by a device outside the roster", {
      roster_devices: devices.length,
    });
    throw new ManifestError(
      "The vault manifest was signed by a device that is not in this account's signed roster.",
    );
  }
  try {
    manifestVerify(
      signer.mldsa_pk,
      signer.ed25519_pk,
      session.state.collection_id,
      manifest,
      entries,
    );
  } catch (err) {
    log.error("vault manifest signature did not verify", {
      seq: manifest.manifest_seq,
      objects: entries.length,
      reason: describeError(err),
    });
    throw new ManifestError(err instanceof Error ? err.message : String(err));
  }
  log.debug("vault manifest verified", {
    seq: manifest.manifest_seq,
    objects: entries.length,
    key_epoch: manifest.key_epoch,
  });
  rememberManifestSeq(session, manifest.manifest_seq);
}

/** The manifest's bucket count, which the server's digest blob is sized by. */
const MANIFEST_BUCKETS = 256;

type ManifestBucketsResponse = {
  manifest: ManifestBody | null;
  /** The 256 bucket digests concatenated, 32 bytes each, base64url. */
  buckets: string;
  object_count: number;
  served: number[];
  entries: ManifestEntry[];
};

/**
 * The collection as one write needs to see it.
 *
 * A write changes one bucket per object, so it needs those buckets' entries and
 * the remaining digests, not the whole collection. `apply` folds the write in
 * and returns what the next manifest has to commit to.
 */
export type BucketedManifest = {
  seq: number;
  keyEpoch: number;
  latestRevision: number;
  apply: (written: ManifestEntry[]) => { objectCount: number; root: string };
};

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
  const { state, token } = session;
  const wanted = [...new Set(ids.map(manifestBucketOf))].sort((a, b) => a - b);
  const query = wanted.map((bucket) => bucket.toString(16).padStart(2, "0")).join("");
  const response = await getJson<ManifestBucketsResponse>(
    `${apiRoot(state.server)}/v1/collections/${state.collection_id}` +
      `/manifest/buckets?buckets=${query}`,
    token,
  );
  // Both lists are sorted and deduplicated, so this is the whole check that
  // every bucket asked for was answered for.
  if (
    response.served.length !== wanted.length ||
    response.served.some((bucket, index) => bucket !== wanted[index])
  ) {
    log.error("vault served manifest buckets other than the ones asked for", {
      asked: wanted.length,
      served: response.served.length,
    });
    throw new ManifestError(
      "The server answered for manifest buckets other than the ones this write asked for.",
    );
  }
  let root: string;
  try {
    root = manifestBucketsRoot(
      response.buckets,
      response.object_count,
      response.served,
      response.entries,
    );
  } catch (err) {
    log.error("vault manifest buckets did not match their digests", {
      reason: describeError(err),
    });
    throw new ManifestError(err instanceof Error ? err.message : String(err));
  }

  // A collection no v3 client has written yet. The revision a write takes has to
  // be the collection's next one, and a bucket answer carries no revision for
  // the entries it did not serve, so this legacy case reads the whole set. It
  // costs an extra request, on a path that stops being taken once anything has
  // written a manifest.
  if (!response.manifest) {
    const whole = await manifestState(session);
    const buckets = manifestBucketsBlob(whole.entries);
    const all = Array.from({ length: MANIFEST_BUCKETS }, (_, bucket) => bucket);
    return {
      seq: whole.seq,
      keyEpoch: whole.keyEpoch,
      latestRevision: whole.latestRevision,
      apply: (written: ManifestEntry[]) =>
        applied(buckets, whole.entries.length, all, whole.entries, written),
    };
  }

  const manifest = response.manifest;
  if (manifest.object_count !== response.object_count) {
    log.error("vault manifest commits to a different object count", {
      served_objects: response.object_count,
      manifest_objects: manifest.object_count,
    });
    throw new ManifestError(
      `Server says ${response.object_count} objects but the manifest commits to ` +
        `${manifest.object_count}.`,
    );
  }
  await verifyManifestRoot(session, manifest, root);

  return {
    seq: manifest.manifest_seq,
    keyEpoch: manifest.key_epoch,
    latestRevision: manifest.latest_revision,
    apply: (written: ManifestEntry[]) =>
      applied(response.buckets, response.object_count, wanted, response.entries, written),
  };
}

/** The object count and root the manifest after a write must carry. */
function applied(
  buckets: string,
  objectCount: number,
  held: number[],
  entries: ManifestEntry[],
  written: ManifestEntry[],
): { objectCount: number; root: string } {
  const next = manifestBucketsApply(buckets, objectCount, held, entries, written);
  return { objectCount: next.object_count, root: next.root };
}

/**
 * Verifies a manifest's signature against a root derived from the bucket
 * digests, and pins its sequence number.
 *
 * The root is already known to describe the digests served, so what is left is
 * that an enrolled device vouched for it.
 */
async function verifyManifestRoot(
  session: Session,
  manifest: ManifestBody,
  root: string,
): Promise<void> {
  if (manifest.manifest_seq < session.manifestSeq) {
    log.error("vault manifest went backwards", {
      seen_seq: session.manifestSeq,
      served_seq: manifest.manifest_seq,
    });
    throw new ManifestError(
      `The vault went backwards: this device has seen manifest ${session.manifestSeq} but the ` +
        `server served ${manifest.manifest_seq}.`,
    );
  }
  const devices = await rosterDevices(session, manifest.key_epoch, manifest.device_id);
  const signer = devices.find((device) => device.device_id === manifest.device_id);
  if (!signer) {
    log.error("vault manifest was signed by a device outside the roster", {
      roster_devices: devices.length,
    });
    throw new ManifestError(
      "The vault manifest was signed by a device that is not in this account's signed roster.",
    );
  }
  try {
    manifestVerifyRoot(
      signer.mldsa_pk,
      signer.ed25519_pk,
      session.state.collection_id,
      manifest,
      root,
    );
  } catch (err) {
    log.error("vault manifest signature did not verify", {
      seq: manifest.manifest_seq,
      objects: manifest.object_count,
      reason: describeError(err),
    });
    throw new ManifestError(err instanceof Error ? err.message : String(err));
  }
  log.debug("vault manifest verified", {
    seq: manifest.manifest_seq,
    objects: manifest.object_count,
    key_epoch: manifest.key_epoch,
  });
  rememberManifestSeq(session, manifest.manifest_seq);
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
