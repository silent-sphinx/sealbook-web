import { bytesFromJson } from "./bytes";
import {
  coreManifestSign,
  coreResealRowUpgrading,
  coreRotationEntries,
  coreRotationPlan,
  coreRotationRecipients,
  newCollectionKey,
  rosterSealDevice,
  rotationSign,
  sealedContentType,
  coreRotationWraps,
} from "./wasm";
import { elapsed, log } from "./log";
import { pinSealedRoster, verifiedRoster } from "./roster";
import { apiRoot, postJson } from "./transport";
import {
  alignKeyEpoch,
  entryFor,
  manifestContext,
  manifestState,
  rememberManifestSeq,
  refuseMissingManifest,
  serializeVault,
  verifyManifest,
  type Session,
} from "./clientCore";
import { walkChanges, type ChangesWalk } from "./clientVault";
import type { CoreSealedRow } from "./wasm";
import type { ManifestBody, RotatedObject } from "./types";

/**
 * Shows the new phrase to the user and resolves once they have proved they hold
 * it, or rejects to abandon the rotation. Called before anything is posted: the
 * rotation replaces the phrase, and one shown only after the server has
 * committed is lost if the tab closes on that screen, leaving a wrap for a
 * phrase nobody holds.
 */
export type PhraseConfirm = (phrase: string) => Promise<void>;

export type RotationOutcome = {
  session: Session;
  phrase: string;
  /** Objects moved to the current payload schema on the way through. */
  upgraded: number;
};

/**
 * The rotation proper, on a session that has just authenticated.
 *
 * Split from `rotateVault`, which is "sign in again, then rotate", so that what
 * a rotation assembles can be exercised without an OPAQUE exchange: which
 * objects are re-encrypted, which tombstones the manifest still commits to,
 * which ones it retires, and the roster it signs.
 */
export function rotateAuthenticated(
  fresh: Session,
  revokeDeviceIds: string[],
  confirmPhrase: PhraseConfirm,
  onProgress?: (done: number, total: number) => void,
): Promise<RotationOutcome> {
  // The protocol wants the revoked ids strictly ascending so a roster has one
  // canonical form; callers hand them over in whatever order the UI lists them.
  const canonicalRevokeIds = [...new Set(revokeDeviceIds)].sort();
  return serializeVault(fresh.state.collection_id, () =>
    rotateAuthenticatedInner(fresh, canonicalRevokeIds, confirmPhrase, onProgress),
  );
}

/**
 * Checks a full walk against the manifest it came with, and that this is the
 * manifest `manifestState` verified, so the rows and the sequence the plan is
 * built on describe one state of the collection.
 */
export async function verifyWalk(session: Session, walk: ChangesWalk, seq: number): Promise<void> {
  if (!walk.manifestJson) {
    refuseMissingManifest(session);
  }
  await verifyManifest(session, walk.manifestJson, walk.objects.map(entryFor));
  const walkSeq = (JSON.parse(walk.manifestJson) as ManifestBody).manifest_seq;
  if (walkSeq !== seq) {
    throw new Error("The vault changed while the key was being rotated. Try again.");
  }
}

async function rotateAuthenticatedInner(
  fresh: Session,
  revokeDeviceIds: string[],
  confirmPhrase: PhraseConfirm,
  onProgress?: (done: number, total: number) => void,
): Promise<RotationOutcome> {
  const root = apiRoot(fresh.state.server);
  const collectionId = fresh.state.collection_id;

  const { seq, keyEpoch: fromEpoch, latestRevision } = await manifestState(fresh);
  // Everything below is re-encrypted from the current key, so this session has
  // to be holding it rather than one a rotation elsewhere has retired.
  await alignKeyEpoch(fresh, fromEpoch);
  // The devices come from the verified roster: taken from the server's list, a
  // device the server had added would be handed a wrap of the new key, which is
  // the whole reason the roster exists. Core decides which of them keep one, and
  // it is asked before the collection is read, so a rotation that cannot start
  // does not read the whole vault first.
  const currentRoster = await verifiedRoster(fresh);
  const remaining = coreRotationRecipients(
    fresh.state.device_id,
    revokeDeviceIds,
    currentRoster.devices,
  );
  // Paged like any other full read. The server's own ceiling is the rotation
  // body, which it holds every write to, so the vault it accepted writes for is
  // one it can rotate: what used to stop here at a single page was this
  // client's own read, not anything the protocol could not carry.
  //
  // The walk is a separate read from `manifestState`, so its rows are checked
  // against the manifest it was served with before anything is re-encrypted.
  // Opening a row proves nothing here: a tombstone needs no ciphertext, and an
  // older ciphertext relabelled with the current revision opens like the real
  // one. Without this the rotation would sign the server's forgeries as its own.
  const walk = await walkChanges(fresh);
  await verifyWalk(fresh, walk, seq);
  const plan = coreRotationPlan(
    fresh.collectionKey,
    collectionId,
    {
      manifest_seq: seq,
      key_epoch: fromEpoch,
      latest_revision: latestRevision,
      tombstone_floor: walk.tombstoneFloor,
    },
    walk.objects,
  );
  const rotationStarted = performance.now();
  log.info("rotating the vault key", {
    revoking: revokeDeviceIds.length,
    live: plan.reseal.length,
    tombstones: plan.carried.length,
    retiring: plan.retired.length,
    from_epoch: fromEpoch,
  });

  const newCk = newCollectionKey();
  const wraps = coreRotationWraps(
    newCk,
    fresh.state.collection_id,
    fromEpoch + 1,
    remaining,
    fresh.state.username,
  );
  const keyWraps = wraps.key_wraps;

  const total = plan.reseal.length;
  const resealed: CoreSealedRow[] = [];
  let upgraded = 0;
  const objects: RotatedObject[] = [];
  for (const row of plan.reseal) {
    const outcome = coreResealRowUpgrading(fresh.collectionKey, newCk, collectionId, row);
    const sealed = outcome.row;
    if (outcome.upgraded) upgraded += 1;
    resealed.push(sealed);
    objects.push({
      id: sealed.id,
      revision: sealed.revision,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
      padded_size: sealed.padded_size,
      content_type: sealedContentType(),
      tombstone: sealed.tombstone,
    });
    onProgress?.(objects.length, total);
  }

  const keyEpoch = plan.manifest.key_epoch;
  const manifestEntries = coreRotationEntries(plan, resealed);
  const manifest = JSON.parse(
    coreManifestSign(
      bytesFromJson(fresh.state.mldsa_seed),
      bytesFromJson(fresh.state.ed25519_sk),
      manifestContext(fresh),
      plan.manifest,
      manifestEntries,
    ).manifest_json,
  ) as ManifestBody;
  const newRoster = rosterSealDevice(
    collectionId,
    currentRoster.roster_seq + 1,
    keyEpoch,
    remaining,
    wraps.phrase_mldsa_pk,
    wraps.phrase_ed25519_pk,
    fresh.state.device_id,
    bytesFromJson(fresh.state.mldsa_seed),
    bytesFromJson(fresh.state.ed25519_sk),
    newCk,
  );
  const rotationSignature = rotationSign(
    // Stored key material may be a legacy byte array rather than base64.
    bytesFromJson(fresh.state.mldsa_seed),
    bytesFromJson(fresh.state.ed25519_sk),
    collectionId,
    revokeDeviceIds,
    keyEpoch,
    keyWraps,
    objects,
    manifest.digest,
    {
      phrase_mldsa_pk: wraps.phrase_mldsa_pk,
      phrase_ed25519_pk: wraps.phrase_ed25519_pk,
      phrase_lookup_id: wraps.phrase_lookup_id,
      phrase_scheme: wraps.phrase_scheme,
    },
  );
  // Everything is signed, but nothing is sent until the user has shown they hold
  // the phrase; abandoning here leaves the account exactly as it was.
  await confirmPhrase(wraps.phrase);

  const response = await postJson<{ key_epoch: number; latest_revision: number }>(
    `${root}/v2/collections/${collectionId}/rotate`,
    {
      key_epoch: keyEpoch,
      revoke_device_ids: revokeDeviceIds,
      key_wraps: keyWraps,
      phrase_recovery: {
        mldsa_pk: wraps.phrase_mldsa_pk,
        ed25519_pk: wraps.phrase_ed25519_pk,
        lookup_id: wraps.phrase_lookup_id,
        scheme: wraps.phrase_scheme,
      },
      objects,
      manifest,
      rotation_signature: rotationSignature,
      roster: newRoster,
      drop_tombstones: plan.retired,
    },
    fresh.token,
  );

  rememberManifestSeq(fresh, plan.manifest.manifest_seq);
  fresh.collectionKey = newCk;
  fresh.keyEpoch = response.key_epoch;
  fresh.latestRevision = response.latest_revision;
  // The rotation carried a roster at the new epoch, so the pin moves with it.
  // Done after the key and epoch are updated, because the pin is computed from
  // the MAC under the new key.
  pinSealedRoster(fresh, newRoster);
  // A rotation is exactly what an unfinished recovery or a migration owes,
  // whatever prompted it: a new collection key, a new phrase, and everything re-encrypted.
  fresh.rotationOwed = undefined;
  log.info("vault key rotated", {
    key_epoch: fresh.keyEpoch,
    devices: newRoster.devices.length,
    upgraded,
    ms: elapsed(rotationStarted),
  });
  return { session: fresh, phrase: wraps.phrase, upgraded };
}
