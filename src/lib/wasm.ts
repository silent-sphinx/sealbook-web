import init, {
  account_op_sign,
  create_device,
  create_enrollment,
  decrypt_contact,
  encrypt_contact,
  generate_new_phrase,
  new_collection_key,
  new_uuid,
  opaque_login_finish,
  opaque_login_start,
  opaque_register_finish,
  opaque_register_start,
  login_start_proof,
  manifest_digest_of,
  manifest_sign,
  manifest_verify,
  object_content_digest,
  open_object,
  pair_confirmation_code,
  payload_schema_version,
  protocol_version,
  pair_grant_sign,
  phrase_lookup_id_b64,
  phrase_recovery_json,
  phrase_recovery_proof_json,
  reseal_object,
  roster_seal_device,
  roster_seal_phrase,
  roster_verify,
  rotation_sign,
  seal_object,
  sealed_content_type,
  unwrap_ck,
  unwrap_phrase,
  wrap_ck_for_device,
  wrap_ck_for_password,
} from "../pkg/sealbook_wasm.js";
import { log } from "./log";
import { PAYLOAD_SCHEMA_VERSION } from "./payload";
import { PROTOCOL_VERSION } from "./protocol";
import type {
  DeviceOut,
  DevicePublic,
  DualSignature,
  Enrollment,
  KeyWrap,
  LoginProof,
  LoginStartProof,
  ManifestBody,
  ManifestEntry,
  OpaqueStart,
  EncryptedOut,
  OpenedObject,
  PasswordWrapOut,
  PhraseRecovery,
  PhraseWrapOut,
  Roster,
  RosterVerified,
  RotatedObject,
} from "./types";

/**
 * Loads the crypto module and checks its versions against this build's copies.
 *
 * `src/pkg` is generated from the `sealbook` repository rather than built from
 * this one, so it can be left behind by a protocol change. The constants in
 * `protocol.ts` and `payload.ts` are hand-mirrored from the same source, so a
 * disagreement between them means the package is stale. Said here, rather than
 * left to surface as a transcript that will not verify.
 */
export async function initWasm(): Promise<void> {
  await init();
  const built = { protocol: protocol_version(), payload_schema: payload_schema_version() };
  if (built.protocol !== PROTOCOL_VERSION || built.payload_schema !== PAYLOAD_SCHEMA_VERSION) {
    log.error("crypto module disagrees with this build; rebuild it with npm run wasm", {
      module_protocol: built.protocol,
      app_protocol: PROTOCOL_VERSION,
      module_payload_schema: built.payload_schema,
      app_payload_schema: PAYLOAD_SCHEMA_VERSION,
    });
    return;
  }
  log.debug("crypto module versions match", { ...built });
}

export function wrapCkForPassword(ck: string, password: string): PasswordWrapOut {
  return JSON.parse(wrap_ck_for_password(ck, password)) as PasswordWrapOut;
}

/**
 * The pairing code both screens show.
 *
 * `rosterSeq` and `rosterTranscript` are the roster anchor the code commits to,
 * which is what makes the user's comparison authenticate the approver to the
 * joining device as well as the other way round. The joining side uses the anchor
 * `pair/join` served; the approving side must use the pin of a roster it verified
 * itself, never one the server handed it.
 */
export function pairConfirmationCode(
  pairId: string,
  deviceId: string,
  mldsaPk: string,
  ed25519Pk: string,
  hpkePk: string,
  rosterSeq: number,
  rosterTranscript: string,
): string {
  return pair_confirmation_code(
    pairId,
    deviceId,
    mldsaPk,
    ed25519Pk,
    hpkePk,
    BigInt(rosterSeq),
    rosterTranscript,
  );
}

export function generateNewPhrase(ck: string): PhraseWrapOut {
  return JSON.parse(generate_new_phrase(ck)) as PhraseWrapOut;
}

export function opaqueRegisterStart(password: string): OpaqueStart {
  return JSON.parse(opaque_register_start(password)) as OpaqueStart;
}

export function opaqueRegisterFinish(state: string, password: string, response: string): string {
  return opaque_register_finish(state, password, response);
}

export function createEnrollment(password: string): Enrollment {
  return JSON.parse(create_enrollment(password)) as Enrollment;
}

export function createDevice(): DeviceOut {
  return JSON.parse(create_device()) as DeviceOut;
}

export function wrapCkForDevice(
  ck: string,
  hpkePk: string,
): { enc: string; wrapped_ck: string; ciphersuite: string } {
  return JSON.parse(wrap_ck_for_device(ck, hpkePk)) as {
    enc: string;
    wrapped_ck: string;
    ciphersuite: string;
  };
}

export function unwrapPhrase(phrase: string, nonce: string, wrappedCk: string): string {
  return unwrap_phrase(phrase, nonce, wrappedCk);
}

/**
 * The opaque handle used to look up a phrase key wrap. Safe to send before a
 * recovery proof, unlike the verification keys.
 */
export function phraseLookupId(phrase: string): string {
  return phrase_lookup_id_b64(phrase);
}

/** The hybrid ML-DSA-65 + Ed25519 recovery material to register for a phrase. */
export function phraseRecovery(phrase: string): PhraseRecovery {
  return JSON.parse(phrase_recovery_json(phrase)) as PhraseRecovery;
}

/**
 * The phrase's proof for a recovery.
 *
 * It covers the replacement password as well as the enrolling device: a recovery
 * exists for the case where the password is what was lost, so it resets the
 * password rather than asking for it, and the new verifier, salt and
 * password-wrapped key are all signed so none of them can be substituted in
 * flight.
 */
export function phraseRecoveryProof(
  phrase: string,
  username: string,
  recoveryId: string,
  challenge: string,
  deviceId: string,
  mldsaPk: string,
  ed25519Pk: string,
  hpkePk: string,
  upload: string,
  kdfSalt: string,
  recoveryNonce: string,
  recoveryWrappedCk: string,
  recoveryCiphersuite: string,
): DualSignature {
  return JSON.parse(
    phrase_recovery_proof_json(
      phrase,
      username,
      recoveryId,
      challenge,
      deviceId,
      mldsaPk,
      ed25519Pk,
      hpkePk,
      upload,
      kdfSalt,
      recoveryNonce,
      recoveryWrappedCk,
      recoveryCiphersuite,
    ),
  ) as DualSignature;
}

/**
 * Signs a device roster with this device's keys and MACs it under the collection
 * key.
 *
 * Sent with a registration, a pairing approval and a rotation: the signature is
 * what lets the next device accept the list without taking the server's word for
 * it, and the MAC is what an unpinned device anchors on, since the server cannot
 * produce it.
 */
export function rosterSealDevice(
  collectionId: string,
  rosterSeq: number,
  keyEpoch: number,
  devices: DevicePublic[],
  phraseMldsaPk: string,
  phraseEd25519Pk: string,
  signerDeviceId: string,
  mldsaSeed: string,
  ed25519Sk: string,
  ck: string,
): Roster {
  return JSON.parse(
    roster_seal_device(
      collectionId,
      BigInt(rosterSeq),
      BigInt(keyEpoch),
      JSON.stringify(devices),
      phraseMldsaPk,
      phraseEd25519Pk,
      signerDeviceId,
      mldsaSeed,
      ed25519Sk,
      ck,
    ),
  ) as Roster;
}

/**
 * Signs a device roster with the recovery phrase's key, for a recovery.
 *
 * A recovering device has no enrolled signing key of its own yet, so the phrase
 * is the only member of the previous roster available to sign the step that adds
 * it.
 */
export function rosterSealPhrase(
  collectionId: string,
  rosterSeq: number,
  keyEpoch: number,
  devices: DevicePublic[],
  phrase: string,
  ck: string,
): Roster {
  return JSON.parse(
    roster_seal_phrase(
      collectionId,
      BigInt(rosterSeq),
      BigInt(keyEpoch),
      JSON.stringify(devices),
      phrase,
      ck,
    ),
  ) as Roster;
}

/**
 * Verifies a served roster history from this device's pin, and returns the
 * newest roster with the pin to keep in place of the old one.
 *
 * `pinSeq` 0 means nothing is pinned yet, in which case the chain's head can
 * only be checked against itself and the collection key of the newest roster's
 * epoch is required: the MAC is keyed from it, so it is the one part of a roster
 * the server cannot forge. Throws on any failure, which is never transient.
 */
export function rosterVerify(
  collectionId: string,
  pinSeq: number,
  pinTranscript: string,
  rosters: Roster[],
  ck: string,
  keyEpoch: number,
  selfDeviceId: string,
): RosterVerified {
  return JSON.parse(
    roster_verify(
      collectionId,
      BigInt(pinSeq),
      pinTranscript,
      JSON.stringify(rosters),
      ck,
      BigInt(keyEpoch),
      selfDeviceId,
    ),
  ) as RosterVerified;
}

export function pairGrantSign(
  mldsaSeed: string,
  ed25519Sk: string,
  pairId: string,
  approverDeviceId: string,
  newDeviceId: string,
  mldsaPk: string,
  ed25519Pk: string,
  hpkePk: string,
  confirm: string,
): { mldsa: string; ed25519: string } {
  return JSON.parse(
    pair_grant_sign(
      mldsaSeed,
      ed25519Sk,
      pairId,
      approverDeviceId,
      newDeviceId,
      mldsaPk,
      ed25519Pk,
      hpkePk,
      confirm,
    ),
  ) as { mldsa: string; ed25519: string };
}

export function opaqueLoginStart(password: string): OpaqueStart {
  return JSON.parse(opaque_login_start(password)) as OpaqueStart;
}

/**
 * Step 2 of login: open the challenge sealed to this device and sign it
 * together with the OPAQUE request. The server releases no credential response
 * until this proof verifies.
 */
export function loginStartProof(
  hpkeSk: string,
  challengeEnc: string,
  challengeCt: string,
  challengeId: string,
  username: string,
  deviceId: string,
  request: string,
  mldsaSeed: string,
  ed25519Sk: string,
): LoginStartProof {
  return JSON.parse(
    login_start_proof(
      hpkeSk,
      challengeEnc,
      challengeCt,
      challengeId,
      username,
      deviceId,
      request,
      mldsaSeed,
      ed25519Sk,
    ),
  ) as LoginStartProof;
}

/**
 * Step 3 of login. `challenge` is the value returned by {@link loginStartProof},
 * so the sealed challenge is opened only once.
 */
export function opaqueLoginFinish(
  state: string,
  password: string,
  response: string,
  challenge: string,
  loginId: string,
  username: string,
  deviceId: string,
  mldsaSeed: string,
  ed25519Sk: string,
): LoginProof {
  return JSON.parse(
    opaque_login_finish(
      state,
      password,
      response,
      challenge,
      loginId,
      username,
      deviceId,
      mldsaSeed,
      ed25519Sk,
    ),
  ) as LoginProof;
}

export function unwrapCk(
  password: string,
  kdfSalt: string,
  hpkeSk: string,
  deviceId: string,
  wrapsJson: string,
): string {
  return unwrap_ck(password, kdfSalt, hpkeSk, deviceId, wrapsJson);
}

export function encryptContact(
  ck: string,
  objectId: string,
  collectionId: string,
  plaintext: string,
): EncryptedOut {
  return JSON.parse(encrypt_contact(ck, objectId, collectionId, plaintext)) as EncryptedOut;
}

export function decryptContact(
  ck: string,
  objectId: string,
  collectionId: string,
  nonce: string,
  ciphertext: string,
  paddedSize: number,
): string {
  return decrypt_contact(ck, objectId, collectionId, nonce, ciphertext, paddedSize);
}

/**
 * The only `content_type` an object is `PUT` under. The real type is sealed in
 * the envelope, so the server is told the same thing about every object.
 */
export function sealedContentType(): string {
  return sealed_content_type();
}

/**
 * The versions the Rust protocol crate declares, for checking the copies in
 * `protocol.ts` and `payload.ts` against their source.
 */
export function protocolVersion(): string {
  return protocol_version();
}

export function payloadSchemaVersion(): string {
  return payload_schema_version();
}

/** Seals `payload` under `contentType` and encrypts the envelope. */
export function sealObject(
  ck: string,
  objectId: string,
  collectionId: string,
  contentType: string,
  payload: string,
): EncryptedOut {
  return JSON.parse(seal_object(ck, objectId, collectionId, contentType, payload)) as EncryptedOut;
}

/** Decrypts an object and opens its envelope. */
export function openObject(
  ck: string,
  objectId: string,
  collectionId: string,
  nonce: string,
  ciphertext: string,
  paddedSize: number,
): OpenedObject {
  return JSON.parse(
    open_object(ck, objectId, collectionId, nonce, ciphertext, paddedSize),
  ) as OpenedObject;
}

/**
 * Re-encrypts one stored object from the old collection key to the new one.
 *
 * The plaintext stays inside wasm: decoding it as a JavaScript string would
 * rewrite any payload that is not valid UTF-8, and a rotation touches the whole
 * vault at once.
 */
export function resealObject(
  oldCk: string,
  newCk: string,
  objectId: string,
  collectionId: string,
  nonce: string,
  ciphertext: string,
  paddedSize: number,
): EncryptedOut {
  return JSON.parse(
    reseal_object(oldCk, newCk, objectId, collectionId, nonce, ciphertext, paddedSize),
  ) as EncryptedOut;
}

export function newUuid(): string {
  return new_uuid();
}

/** A fresh collection key, base64. Used when rotating after a device revocation. */
export function newCollectionKey(): string {
  return new_collection_key();
}

/**
 * Signs a key rotation. The transcript covers the revoked device, the new key
 * epoch, and digests of every key wrap and re-encrypted object, so the server
 * can confirm the whole rotation came from a device that holds the signing key.
 */
export type RotationRecovery = {
  kdf_salt: string;
  phrase_mldsa_pk: string;
  phrase_ed25519_pk: string;
  phrase_lookup_id: string;
  phrase_scheme: string;
};

export function rotationSign(
  mldsaSeed: string,
  ed25519Sk: string,
  collectionId: string,
  /** Empty to rotate without revoking a device, as a phrase change does. */
  revokedDeviceId: string,
  keyEpoch: number,
  wraps: KeyWrap[],
  objects: RotatedObject[],
  manifestDigest: string,
  /**
   * The KDF salt and phrase record this rotation installs. Signed, so a modified
   * request body cannot swap in recovery material the account holder never
   * produced, which is why it is not optional.
   */
  recovery: RotationRecovery,
): DualSignature {
  return JSON.parse(
    rotation_sign(
      mldsaSeed,
      ed25519Sk,
      collectionId,
      revokedDeviceId,
      BigInt(keyEpoch),
      JSON.stringify(wraps),
      JSON.stringify(objects),
      manifestDigest,
      JSON.stringify(recovery),
    ),
  ) as DualSignature;
}

/** `SHA-256(nonce || ciphertext)`, the per-object commitment in a manifest. */
export function objectContentDigest(nonce: string, ciphertext: string): string {
  return object_content_digest(nonce, ciphertext);
}

/**
 * Digest of a whole collection.
 *
 * Computed in Rust so the canonical ordering and length-prefixed framing cannot
 * drift from what the server computes.
 */
export function manifestDigestOf(entries: ManifestEntry[]): string {
  return manifest_digest_of(JSON.stringify(entries));
}

/** Signs a manifest describing the state a write produces. */
export function manifestSign(
  mldsaSeed: string,
  ed25519Sk: string,
  collectionId: string,
  deviceId: string,
  manifestSeq: number,
  keyEpoch: number,
  latestRevision: number,
  entries: ManifestEntry[],
): ManifestBody {
  return JSON.parse(
    manifest_sign(
      mldsaSeed,
      ed25519Sk,
      collectionId,
      deviceId,
      BigInt(manifestSeq),
      BigInt(keyEpoch),
      BigInt(latestRevision),
      JSON.stringify(entries),
    ),
  ) as ManifestBody;
}

/**
 * Checks a served manifest against the entries it claims to describe.
 *
 * Throws when they disagree. That is not a transient error: it means the server
 * served something no device signed for — an object withheld, rolled back or
 * substituted.
 */
export function manifestVerify(
  signerMldsaPk: string,
  signerEd25519Pk: string,
  collectionId: string,
  manifest: ManifestBody,
  entries: ManifestEntry[],
): void {
  manifest_verify(
    signerMldsaPk,
    signerEd25519Pk,
    collectionId,
    BigInt(manifest.manifest_seq),
    BigInt(manifest.key_epoch),
    BigInt(manifest.latest_revision),
    JSON.stringify(entries),
    manifest.digest,
    manifest.signature.mldsa,
    manifest.signature.ed25519,
  );
}

export type AccountOp = "username" | "password" | "delete";

/** Signs an account mutation: `"username"`, `"password"` or `"delete"`. */
export function accountOpSign(
  mldsaSeed: string,
  ed25519Sk: string,
  op: AccountOp,
  challengeId: string,
  challenge: string,
  accountId: string,
  deviceId: string,
  payload: Record<string, string>,
): DualSignature {
  return JSON.parse(
    account_op_sign(
      mldsaSeed,
      ed25519Sk,
      op,
      challengeId,
      challenge,
      accountId,
      deviceId,
      JSON.stringify(payload),
    ),
  ) as DualSignature;
}
