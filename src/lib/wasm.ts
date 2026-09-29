import init, {
  account_op_sign,
  create_device,
  create_enrollment,
  decrypt_contact,
  encrypt_contact,
  generate_new_phrase,
  login_start_proof,
  manifest_sign,
  manifest_verify,
  new_collection_key,
  new_uuid,
  object_content_digest,
  opaque_login_finish,
  opaque_login_start,
  opaque_register_finish,
  opaque_register_start,
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

export function phraseLookupId(phrase: string): string {
  return phrase_lookup_id_b64(phrase);
}

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

export function newCollectionKey(): string {
  return new_collection_key();
}

export function objectContentDigest(nonce: string, ciphertext: string): string {
  return object_content_digest(nonce, ciphertext);
}

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

/** Throws if the manifest does not match `entries` or its signature does not verify. */
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

export function rotationSign(
  mldsaSeed: string,
  ed25519Sk: string,
  collectionId: string,
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

export type AccountOp = "username" | "password" | "delete";

export function accountOpSign(
  mldsaSeed: string,
  ed25519Sk: string,
  op: AccountOp,
  challengeId: string,
  challenge: string,
  accountId: string,
  deviceId: string,
  payload: object,
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
