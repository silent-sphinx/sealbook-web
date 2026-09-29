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
  pair_confirmation_code,
  pair_grant_sign,
  phrase_lookup_id_b64,
  phrase_recovery_json,
  phrase_recovery_proof_json,
  rotation_sign,
  unwrap_ck,
  unwrap_phrase,
  wrap_ck_for_device,
  wrap_ck_for_password,
} from "../pkg/sealbook_wasm.js";
import type {
  DeviceOut,
  DualSignature,
  Enrollment,
  KeyWrap,
  LoginProof,
  LoginStartProof,
  ManifestBody,
  ManifestEntry,
  OpaqueStart,
  EncryptedOut,
  PasswordWrapOut,
  PhraseRecovery,
  PhraseWrapOut,
  RotatedObject,
} from "./types";

export async function initWasm(): Promise<void> {
  await init();
}

export function wrapCkForPassword(ck: string, password: string): PasswordWrapOut {
  return JSON.parse(wrap_ck_for_password(ck, password)) as PasswordWrapOut;
}

export function pairConfirmationCode(
  pairId: string,
  deviceId: string,
  mldsaPk: string,
  ed25519Pk: string,
  hpkePk: string,
): string {
  return pair_confirmation_code(pairId, deviceId, mldsaPk, ed25519Pk, hpkePk);
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

export function phraseRecoveryProof(
  phrase: string,
  username: string,
  recoveryId: string,
  challenge: string,
  deviceId: string,
  mldsaPk: string,
  ed25519Pk: string,
  hpkePk: string,
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
    ),
  ) as DualSignature;
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
