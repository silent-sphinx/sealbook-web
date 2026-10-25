import init, {
  account_op_sign,
  core_accept_manifest_seq,
  core_manifest_absence_ok,
  core_manifest_accept,
  core_manifest_apply,
  core_manifest_buckets_accept,
  core_manifest_buckets_from_whole,
  core_manifest_buckets_request,
  core_manifest_entry_for,
  core_manifest_request,
  core_manifest_sign,
  core_manifest_sign_root,
  core_manifest_signer,
  core_manifest_verify,
  core_pin_roster,
  core_roster_accept,
  core_roster_accept_sealed,
  core_roster_answers_for,
  core_roster_request,
  AttachmentHash,
  create_device,
  create_enrollment,
  decrypt_contact,
  encrypt_contact,
  generate_new_phrase,
  new_attachment_key,
  new_collection_key,
  new_uuid,
  open_attachment_chunk,
  seal_attachment_chunk,
  opaque_login_finish,
  opaque_login_start,
  opaque_register_finish,
  opaque_register_start,
  login_start_proof,
  manifest_bucket_of_id,
  manifest_buckets_blob,
  manifest_digest_of,
  manifest_sign,
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
import type {
  AppliedManifest,
  BucketedManifest,
  BucketsOutcome,
  CoreDevice,
  CoreError,
  CoreManifestEntry,
  CoreRoster,
  CoreRosterPin,
  HttpRequest,
  ManifestContext,
  ManifestOutcome,
  ManifestPlan,
  ManifestSigner,
  RosterContext,
  SignedManifest,
  VerifiedRoster,
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

/** A fresh attachment data key, base64url, to store in the owning note. */
export function newAttachmentKey(): string {
  return new_attachment_key();
}

/**
 * Seals one attachment chunk. Returns the 24-byte nonce prepended to the
 * ciphertext; callers split the nonce off with `ATTACHMENT_NONCE_LEN`.
 */
export function sealAttachmentChunk(
  adk: string,
  attachmentId: string,
  collectionId: string,
  chunkIndex: number,
  chunkCount: number,
  plaintext: Uint8Array,
): Uint8Array<ArrayBuffer> {
  // wasm-bindgen copies its return into a fresh, non-shared buffer.
  return seal_attachment_chunk(
    adk,
    attachmentId,
    collectionId,
    chunkIndex,
    chunkCount,
    plaintext,
  ) as Uint8Array<ArrayBuffer>;
}

/** The nonce length `sealAttachmentChunk` prepends to its ciphertext. */
export const ATTACHMENT_NONCE_LEN = 24;

/** Opens one attachment chunk, returning its plaintext bytes. */
export function openAttachmentChunk(
  adk: string,
  attachmentId: string,
  collectionId: string,
  chunkIndex: number,
  chunkCount: number,
  nonce: string,
  ciphertext: Uint8Array,
): Uint8Array<ArrayBuffer> {
  return open_attachment_chunk(
    adk,
    attachmentId,
    collectionId,
    chunkIndex,
    chunkCount,
    nonce,
    ciphertext,
  ) as Uint8Array<ArrayBuffer>;
}

/**
 * Rolls per-chunk plaintext hashes into one attachment content hash. Fed chunk
 * by chunk on both upload and download, so the two paths produce the identical
 * hash the Rust server-side client also computes.
 */
export class AttachmentHasher {
  // Null once the wasm handle has gone, so `free` after a `finalize` that
  // already consumed the pointer cannot hand the same pointer back to Rust.
  private inner: AttachmentHash | null;
  constructor() {
    this.inner = new AttachmentHash();
  }
  update(chunkPlaintext: Uint8Array): void {
    if (!this.inner) {
      throw new Error("attachment hasher used after it was finalized");
    }
    this.inner.update(chunkPlaintext);
  }
  /** Consumes the hasher; it must not be used again afterward. */
  finalize(): string {
    if (!this.inner) {
      throw new Error("attachment hasher used after it was finalized");
    }
    const inner = this.inner;
    this.inner = null;
    return inner.finalize();
  }
  /** Releases the handle unless `finalize` already took it. Idempotent. */
  free(): void {
    const inner = this.inner;
    this.inner = null;
    inner?.free();
  }
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

/** The manifest bucket an object id falls in. */
export function manifestBucketOf(id: string): number {
  return manifest_bucket_of_id(id);
}

/** The 256 bucket digests of a whole entry set, concatenated and base64url. */
export function manifestBucketsBlob(entries: ManifestEntry[]): string {
  return manifest_buckets_blob(JSON.stringify(entries));
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

// ── Core: manifest ──

/** The manifest request to send, with a server-relative path. */
export function coreManifestRequest(context: ManifestContext): HttpRequest {
  return core_manifest_request(context);
}

/** The request for only the buckets these objects fall in. */
export function coreManifestBucketsRequest(
  context: ManifestContext,
  ids: string[],
): HttpRequest {
  return core_manifest_buckets_request(context, ids);
}

/**
 * The epoch and device a served manifest must be checked against.
 *
 * Read before the roster is fetched, because the manifest is what says which
 * roster to fetch. `undefined` is a collection with no manifest, which needs
 * no roster.
 */
export function coreManifestSigner(body: string): ManifestSigner | undefined {
  return core_manifest_signer(body);
}

/**
 * Checks a served manifest against the entry set it is supposed to describe.
 *
 * The body crosses as the text the server sent: `Vec<u8>` crosses as `number[]`
 * and a whole collection's entry set is larger than a roster history.
 */
export function coreManifestAccept(
  context: ManifestContext,
  body: string,
  devices: CoreDevice[],
): ManifestOutcome {
  return core_manifest_accept(context, body, devices);
}

/** Checks a bucketed manifest answer and returns what a write needs from it. */
export function coreManifestBucketsAccept(
  context: ManifestContext,
  ids: string[],
  body: string,
  devices: CoreDevice[],
): BucketsOutcome {
  return core_manifest_buckets_accept(context, ids, body, devices);
}

/**
 * Checks a manifest served alongside pages of objects against the entry set
 * those pages produced.
 */
export function coreManifestVerify(
  context: ManifestContext,
  manifestJson: string,
  entries: CoreManifestEntry[],
  devices: CoreDevice[],
): ManifestPlan {
  return core_manifest_verify(context, manifestJson, entries, devices);
}

/** The rule for a server that served objects with no manifest at all. */
export function coreManifestAbsenceOk(context: ManifestContext): void {
  core_manifest_absence_ok(context);
}

/** The bucketed view of a collection whose every entry is in hand. */
export function coreManifestBucketsFromWhole(
  plan: ManifestPlan,
  entries: CoreManifestEntry[],
): BucketedManifest {
  return core_manifest_buckets_from_whole(plan, entries);
}

/** Folds written entries in and returns what the next manifest must commit to. */
export function coreManifestApply(
  held: BucketedManifest,
  written: CoreManifestEntry[],
): AppliedManifest {
  return core_manifest_apply(held, written);
}

/** Signs a manifest over an entry set, for the caller that holds all of it. */
export function coreManifestSign(
  mldsaSeed: string,
  ed25519Sk: string,
  context: ManifestContext,
  plan: ManifestPlan,
  entries: CoreManifestEntry[],
): SignedManifest {
  return core_manifest_sign(mldsaSeed, ed25519Sk, context, plan, entries);
}

/** Signs a manifest over a root already derived from the bucket digests. */
export function coreManifestSignRoot(
  mldsaSeed: string,
  ed25519Sk: string,
  context: ManifestContext,
  plan: ManifestPlan,
  applied: AppliedManifest,
): SignedManifest {
  return core_manifest_sign_root(mldsaSeed, ed25519Sk, context, plan, applied);
}

/** The manifest entry a sealed object produces. */
export function coreManifestEntryFor(
  id: string,
  revision: number,
  tombstone: boolean,
  nonce: string,
  ciphertext: string,
): CoreManifestEntry {
  return core_manifest_entry_for(id, BigInt(revision), tombstone, nonce, ciphertext);
}

/** The sequence to persist once a manifest has been verified. */
export function coreAcceptManifestSeq(current: number, seq: number): number {
  return Number(core_accept_manifest_seq(BigInt(current), BigInt(seq)));
}

// ── Core: roster ──

/**
 * The error core raised, or `null` for anything else.
 *
 * Core serializes its error across the boundary so a caller maps a variant onto
 * its own error class rather than matching on a sentence. See `CoreError` in
 * `sealbook-core`: a variant is renamed only together with its callers.
 */
export function coreErrorOf(err: unknown): CoreError | null {
  if (!(err instanceof Error)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(err.message);
    if (typeof parsed === "object" && parsed !== null && "kind" in parsed) {
      return parsed as CoreError;
    }
  } catch {
    return null;
  }
  return null;
}

/** The roster request to send, with a server-relative path. */
export function coreRosterRequest(context: RosterContext): HttpRequest {
  return core_roster_request(context);
}

/**
 * Verifies a served roster history from this device's pin.
 *
 * `ck` empty means no collection key is held, which only an already pinned
 * device can verify from. Does not move the pin; `corePinRoster` does.
 */
export function coreRosterAccept(
  context: RosterContext,
  ck: string,
  keyEpoch: number,
  status: number,
  body: string,
): VerifiedRoster {
  return core_roster_accept(context, ck, BigInt(keyEpoch), status, body);
}

/** Verifies a roster this device sealed itself, at the roster's own key epoch. */
export function coreRosterAcceptSealed(
  context: RosterContext,
  ck: string,
  rosterJson: string,
): VerifiedRoster {
  return core_roster_accept_sealed(context, ck, rosterJson);
}

/** The roster fields to persist, refusing a pin that would move backwards. */
export function corePinRoster(context: RosterContext, pin: CoreRosterPin): RosterContext {
  return core_pin_roster(context, pin);
}

/**
 * Whether a roster in hand answers the caller, or the chain must be rewalked.
 *
 * A constraint left out is not checked, for the caller that wants whatever
 * roster this session has verified.
 */
export function coreRosterAnswersFor(
  cached: CoreRoster,
  keyEpoch?: number,
  signer?: string,
): boolean {
  return core_roster_answers_for(
    cached,
    keyEpoch === undefined ? undefined : BigInt(keyEpoch),
    signer,
  );
}
