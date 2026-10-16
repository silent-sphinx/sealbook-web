import { bytesFromJson } from "./bytes";
import {
  generateNewPhrase,
  manifestSign,
  newCollectionKey,
  resealObject,
  rosterSealDevice,
  rotationSign,
  sealedContentType,
  wrapCkForDevice,
  wrapCkForPassword,
} from "./wasm";
import { elapsed, log } from "./log";
import { pinSealedRoster, verifiedRoster } from "./roster";
import { apiRoot, postJson } from "./transport";
import {
  alignKeyEpoch,
  entryFor,
  manifestState,
  rememberManifestSeq,
  serializeVault,
  type Session,
} from "./clientCore";
import { walkChanges } from "./clientVault";
import type { RotatedObject, SealedObject } from "./types";

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
  revokeDeviceId: string | null,
  password: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ session: Session; phrase: string }> {
  return serializeVault(fresh.state.collection_id, () =>
    rotateAuthenticatedInner(fresh, revokeDeviceId, password, onProgress),
  );
}

async function rotateAuthenticatedInner(
  fresh: Session,
  revokeDeviceId: string | null,
  password: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ session: Session; phrase: string }> {
  const root = apiRoot(fresh.state.server);
  const collectionId = fresh.state.collection_id;

  const { seq, latestRevision } = await manifestState(fresh);
  // Paged like any other full read. The server's own ceiling is the rotation
  // body, which it holds every write to, so the vault it accepted writes for is
  // one it can rotate: what used to stop here at a single page was this
  // client's own read, not anything the protocol could not carry.
  const walk = await walkChanges(fresh);
  // Everything below is re-encrypted from the current key, so this session has
  // to be holding it rather than one a rotation elsewhere has retired.
  await alignKeyEpoch(fresh, walk.keyEpoch);
  const { live, tombstones, retired } = splitForRotation(walk.objects, walk.tombstoneFloor);
  const rotationStarted = performance.now();
  log.info("rotating the vault key", {
    revoking: revokeDeviceId !== null,
    live: live.length,
    tombstones: tombstones.length,
    retiring: retired.length,
    from_epoch: walk.keyEpoch,
  });
  // `manifestState` verified the collection above, so what is re-encrypted below
  // is what a device signed for rather than whatever the server chose to serve.
  //
  // The devices come from the verified roster: taken from the server's list, a
  // device the server had added would be handed a wrap of the new key, which is
  // the whole reason the roster exists.
  const currentRoster = await verifiedRoster(fresh);
  const devices = currentRoster.devices;
  if (revokeDeviceId && !devices.some((device) => device.device_id === revokeDeviceId)) {
    throw new Error("That device has already been removed.");
  }
  const remaining = devices.filter((device) => device.device_id !== revokeDeviceId);
  if (remaining.length === 0) {
    throw new Error("You cannot revoke the last device.");
  }
  if (!remaining.some((device) => device.device_id === fresh.state.device_id)) {
    throw new Error("This device is not in the account's roster; sign in again.");
  }

  const newCk = newCollectionKey();
  const passwordWrap = wrapCkForPassword(newCk, password);
  const phraseOut = generateNewPhrase(newCk);

  const keyWraps = [
    ...remaining.map((device) => {
      const wrap = wrapCkForDevice(newCk, device.xwing_hpke_pk);
      return {
        recipient_kind: "device",
        recipient_id: device.device_id,
        hpke_enc: wrap.enc,
        wrapped_ck: wrap.wrapped_ck,
        ciphersuite: wrap.ciphersuite,
      };
    }),
    {
      recipient_kind: "recovery",
      recipient_id: fresh.state.username,
      hpke_enc: passwordWrap.recovery_nonce,
      wrapped_ck: passwordWrap.recovery_wrapped_ck,
      ciphersuite: passwordWrap.recovery_ciphersuite,
    },
    {
      recipient_kind: "phrase",
      recipient_id: fresh.state.username,
      hpke_enc: phraseOut.phrase_nonce,
      wrapped_ck: phraseOut.phrase_wrapped_ck,
      ciphersuite: phraseOut.phrase_ciphersuite,
    },
  ];

  const total = live.length;
  // Rotation assigns consecutive revisions from the collection's next one, and the
  // manifest commits to each of them.
  const firstRevision = latestRevision + 1;
  const objects: RotatedObject[] = [];
  let done = 0;
  for (const object of live) {
    // Re-encrypted inside wasm, so the plaintext never becomes a JavaScript
    // string: decoding it as text would rewrite any payload that is not valid
    // UTF-8, and a rotation touches the whole vault at once.
    const sealed = resealObject(
      fresh.collectionKey,
      newCk,
      object.id,
      collectionId,
      object.nonce,
      object.ciphertext,
      object.padded_size,
    );
    objects.push({
      id: object.id,
      revision: firstRevision + objects.length,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
      padded_size: sealed.padded_size,
      content_type: sealedContentType(),
      // Always live: a rotation re-encrypts plaintext, and the server refuses a
      // rotated object that claims to be a tombstone.
      tombstone: false,
    });
    done += 1;
    onProgress?.(done, total);
  }

  const keyEpoch = walk.keyEpoch + 1;
  // Tombstones are not re-encrypted, since there is no plaintext left to
  // re-encrypt, but the ones this rotation keeps are still rows the manifest
  // commits to, so they carry their stored revision and digest through
  // unchanged. Leaving them out made the manifest short and the rotation refused
  // on any vault that had ever had a deletion.
  //
  // The ones below the floor are left out on purpose and named in
  // `drop_tombstones`. This manifest is what authorises that: the server retires
  // exactly those rows and recomputes the digest from what it then holds, so a
  // list that does not match this entry set is refused.
  const manifestEntries = [...objects.map(entryFor), ...tombstones.map(entryFor)];
  const manifest = manifestSign(
    bytesFromJson(fresh.state.mldsa_seed),
    bytesFromJson(fresh.state.ed25519_sk),
    collectionId,
    fresh.state.device_id,
    seq + 1,
    keyEpoch,
    firstRevision + objects.length - 1,
    manifestEntries,
  );
  const newRoster = rosterSealDevice(
    collectionId,
    currentRoster.roster_seq + 1,
    keyEpoch,
    remaining,
    phraseOut.phrase_mldsa_pk,
    phraseOut.phrase_ed25519_pk,
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
    revokeDeviceId ?? "",
    keyEpoch,
    keyWraps,
    objects,
    manifest.digest,
    {
      kdf_salt: passwordWrap.kdf_salt,
      phrase_mldsa_pk: phraseOut.phrase_mldsa_pk,
      phrase_ed25519_pk: phraseOut.phrase_ed25519_pk,
      phrase_lookup_id: phraseOut.phrase_lookup_id,
      phrase_scheme: phraseOut.phrase_scheme,
    },
  );

  const response = await postJson<{ key_epoch: number; latest_revision: number }>(
    `${root}/v1/collections/${collectionId}/rotate`,
    {
      key_epoch: keyEpoch,
      revoke_device_id: revokeDeviceId,
      kdf_salt: passwordWrap.kdf_salt,
      key_wraps: keyWraps,
      phrase_recovery: {
        mldsa_pk: phraseOut.phrase_mldsa_pk,
        ed25519_pk: phraseOut.phrase_ed25519_pk,
        lookup_id: phraseOut.phrase_lookup_id,
        scheme: phraseOut.phrase_scheme,
      },
      objects,
      manifest,
      rotation_signature: rotationSignature,
      roster: newRoster,
      drop_tombstones: retired,
    },
    fresh.token,
  );

  rememberManifestSeq(fresh, seq + 1);
  fresh.collectionKey = newCk;
  fresh.keyEpoch = response.key_epoch;
  fresh.latestRevision = response.latest_revision;
  fresh.state = { ...fresh.state, kdf_salt: passwordWrap.kdf_salt };
  // The rotation carried a roster at the new epoch, so the pin moves with it.
  // Done after the key and epoch are updated, because the pin is computed from
  // the MAC under the new key.
  pinSealedRoster(fresh, newRoster);
  // A rotation is exactly what an unfinished recovery owes, whatever prompted
  // it: a new collection key, a new phrase, and everything re-encrypted.
  fresh.recoveryPending = false;
  log.info("vault key rotated", {
    key_epoch: fresh.keyEpoch,
    devices: newRoster.devices.length,
    ms: elapsed(rotationStarted),
  });
  return { session: fresh, phrase: phraseOut.phrase };
}

/**
 * Splits a collection into what a rotation does with each part.
 *
 * `live` is re-encrypted under the new key. `tombstones` are not, but the
 * manifest still commits to them, so they are carried through at their stored
 * revision and digest. `retired` are the tombstones below the collection's
 * floor: no incremental sync can still carry those deletes, so the rotation
 * drops the rows instead of signing for them again, and it is the only
 * operation that can, since only a device can sign the manifest that leaves one
 * out.
 */
export function splitForRotation(
  objects: SealedObject[],
  tombstoneFloor: number,
): { live: SealedObject[]; tombstones: SealedObject[]; retired: string[] } {
  const live: SealedObject[] = [];
  const tombstones: SealedObject[] = [];
  const retired: string[] = [];
  for (const object of objects) {
    if (!object.tombstone) {
      live.push(object);
    } else if (object.revision < tombstoneFloor) {
      retired.push(object.id);
    } else {
      tombstones.push(object);
    }
  }
  return { live, tombstones, retired };
}
