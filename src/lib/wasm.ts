import init, {
  create_device,
  create_enrollment,
  decrypt_contact,
  encrypt_contact,
  generate_new_phrase,
  new_uuid,
  opaque_login_finish,
  opaque_login_start,
  opaque_register_finish,
  opaque_register_start,
  pair_confirmation_code,
  pair_grant_sign,
  phrase_recovery_pk_b64,
  phrase_recovery_proof_b64,
  unwrap_ck,
  unwrap_phrase,
  wrap_ck_for_device,
  wrap_ck_for_password,
} from "../pkg/sealbook_wasm.js";
import type {
  DeviceOut,
  Enrollment,
  LoginProof,
  OpaqueStart,
  EncryptedOut,
  PasswordWrapOut,
  PhraseWrapOut,
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

export function phraseVerifierB64(phrase: string): string {
  return phrase_recovery_pk_b64(phrase);
}

export function phraseRecoveryProofB64(
  phrase: string,
  username: string,
  recoveryId: string,
  challenge: string,
  deviceId: string,
  mldsaPk: string,
  ed25519Pk: string,
  hpkePk: string,
): string {
  return phrase_recovery_proof_b64(
    phrase,
    username,
    recoveryId,
    challenge,
    deviceId,
    mldsaPk,
    ed25519Pk,
    hpkePk,
  );
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

export function opaqueLoginFinish(
  state: string,
  password: string,
  response: string,
  challengeEnc: string,
  challengeCt: string,
  hpkeSk: string,
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
      challengeEnc,
      challengeCt,
      hpkeSk,
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
