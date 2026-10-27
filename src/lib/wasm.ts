import init, {
  core_accept_manifest_seq,
  core_account_challenge_request,
  core_change_password_request,
  core_change_username_request,
  core_changes_request,
  core_delete_account_request,
  core_login_accept,
  core_login_challenge_request,
  core_login_finish_request,
  core_login_start_request,
  core_new_device,
  core_new_registration,
  core_normalize_phrase,
  core_normalize_username,
  core_opaque_login_start,
  core_opaque_register_start,
  core_opaque_register_upload,
  core_password_change_start_accept,
  core_password_change_start_request,
  core_recover_accept,
  core_recover_finish_request,
  core_recover_start_accept,
  core_recover_start_request,
  core_register_accept,
  core_register_finish_request,
  core_register_start_accept,
  core_register_start_request,
  core_latest_revisions,
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
  core_confirmation_groups,
  core_format_confirmation,
  core_normalize_confirmation,
  core_open_row,
  core_pair_approve,
  core_pair_approve_path,
  core_pair_join_accept,
  core_pair_join_body,
  core_pair_path,
  core_pair_preview,
  core_pair_status,
  core_pin_roster,
  core_roster_accept,
  core_roster_accept_sealed,
  core_roster_answers_for,
  core_roster_request,
  core_require_key_epoch,
  core_reseal_row,
  core_rotation_entries,
  core_rotation_plan,
  core_rotation_recipients,
  core_walk_page,
  core_walk_start,
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
  manifest_bucket_of_id,
  manifest_buckets_blob,
  manifest_digest_of,
  manifest_sign,
  object_content_digest,
  open_object,
  pair_confirmation_code,
  payload_schema_version,
  protocol_version,
  roster_seal_device,
  roster_verify,
  rotation_sign,
  seal_object,
  sealed_content_type,
  unwrap_ck,
  wrap_ck_for_device,
  wrap_ck_for_password,
} from "../pkg/sealbook_wasm.js";
import type {
  AppliedManifest,
  AuthRequest,
  BucketedManifest,
  BucketsOutcome,
  ChangesPage,
  CoreDevice,
  CoreDeviceSecrets,
  CoreDeviceState,
  CoreError,
  CoreManifestEntry,
  CorePairPreview,
  CoreRoster,
  CoreRosterPin,
  CoreSealedRow,
  HttpRequest,
  LoggedIn,
  LoginStarting,
  ManifestContext,
  ManifestOutcome,
  ManifestPlan,
  ManifestSigner,
  PairApproval,
  PairJoined,
  PairStatus,
  PasswordChange,
  PasswordChangeStarted,
  RecoverStarted,
  Recovering,
  RegisterIdentity,
  Registering,
  ResealRow,
  RosterContext,
  RotationPlan,
  RotationState,
  RowOutcome,
  RowRef,
  SignedManifest,
  VerifiedRoster,
  WalkCursor,
  WalkStep,
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
  ManifestBody,
  ManifestEntry,
  OpaqueStart,
  EncryptedOut,
  OpenedObject,
  PasswordWrapOut,
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

// ── Core: the read path ──

export type { ChangesPage, CoreSealedRow, RowOutcome, WalkCursor, WalkStep };

/** A walk that starts after `after`, or from nothing when that is 0. */
export function coreWalkStart(after: number): WalkCursor {
  return core_walk_start(BigInt(after));
}

/**
 * The request for the next page of a walk.
 *
 * `path` is server-relative: the caller prefixes its own API root and adds the
 * bearer token, which core never sees.
 */
export function coreChangesRequest(collectionId: string, cursor: WalkCursor): HttpRequest {
  return core_changes_request(collectionId, cursor);
}

/**
 * What the walk does with the page it was just served: another page, a restart
 * that drops the rows read so far, or the walk being complete.
 */
export function coreWalkPage(cursor: WalkCursor, page: ChangesPage): WalkStep {
  return core_walk_page(cursor, page);
}

/**
 * The rows to keep out of a walk, as indices into the rows walked.
 *
 * Indices rather than the rows, so a collection's ciphertexts do not cross this
 * boundary again to be deduplicated.
 */
export function coreLatestRevisions(rows: RowRef[]): number[] {
  return [...core_latest_revisions(rows)];
}

/**
 * Decrypts one served row and opens its envelope.
 *
 * Only an unusable collection key throws: every other failure is one row's and
 * comes back as `Unreadable`, so one object this device cannot read does not
 * cost it the rest of the collection.
 */
export function coreOpenRow(
  ck: string,
  collectionId: string,
  row: CoreSealedRow,
): RowOutcome {
  return core_open_row(ck, collectionId, row);
}

/** The rule for a collection key that moved while a read was in flight. */
export function coreRequireKeyEpoch(expected: number, held: number): void {
  core_require_key_epoch(BigInt(expected), BigInt(held));
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

// ── Core: rotation ──

export type { ResealRow, RotationPlan, RotationState };

/**
 * What a rotation does with the collection it just read: which rows are
 * re-sealed and at which revision, which tombstones the manifest carries, which
 * rows it retires, and the sequence and epoch it advances to.
 *
 * Throws on a live row this device cannot open, which no other read does: a
 * rotation re-encrypts each row from its plaintext, so counting one it cannot
 * read would drop the object from the collection for good.
 */
export function coreRotationPlan(
  ck: string,
  collectionId: string,
  state: RotationState,
  rows: CoreSealedRow[],
): RotationPlan {
  return core_rotation_plan(ck, collectionId, state, rows);
}

/** The devices a rotation re-wraps the new key for, from the verified roster. */
export function coreRotationRecipients(
  selfDeviceId: string,
  revokeDeviceId: string | null,
  devices: CoreDevice[],
): CoreDevice[] {
  return core_rotation_recipients(selfDeviceId, revokeDeviceId, devices);
}

/**
 * One planned row re-sealed under the new key, at the revision the plan gave it.
 *
 * The plaintext stays inside wasm: decoding it as a JavaScript string would
 * rewrite any payload that is not valid UTF-8, and a rotation touches the whole
 * vault at once.
 */
export function coreResealRow(
  oldCk: string,
  newCk: string,
  collectionId: string,
  row: ResealRow,
): CoreSealedRow {
  return core_reseal_row(oldCk, newCk, collectionId, row);
}

/**
 * The manifest entry set for a rotation, from its plan and the rows just
 * re-sealed.
 */
export function coreRotationEntries(
  plan: RotationPlan,
  resealed: CoreSealedRow[],
): CoreManifestEntry[] {
  return core_rotation_entries(plan, resealed);
}

// ── Core: pairing ──

export type { CoreDevice, CorePairPreview, PairApproval, PairJoined, PairStatus };

/** The join request body, with the enrollment signature over the new keys. */
export function corePairJoinBody(
  username: string,
  device: CoreDevice,
  mldsaSeed: string,
  ed25519Sk: string,
): string {
  return core_pair_join_body(username, device, mldsaSeed, ed25519Sk);
}

/**
 * Checks the join response and computes the code the joining device shows.
 *
 * The code is this device's own, not the server's copy: a server that
 * substituted the keys could show the real code and keep the ones it swapped
 * in. Throws when the two do not agree.
 */
export function corePairJoinAccept(device: CoreDevice, body: string): PairJoined {
  return core_pair_join_accept(device, body);
}

/**
 * Where a poll says the pairing has got to.
 *
 * Takes the status code as well as the body: an expired code is a 404, so a
 * poll that read only the body would wait on a pairing that is gone.
 */
export function corePairStatus(status: number, body: string): PairStatus {
  return core_pair_status(status, body);
}

/** The server-relative path that looks a pairing up, from a code as typed. */
export function corePairPath(pairKey: string): string {
  return core_pair_path(pairKey);
}

/** The server-relative path an approval posts to. */
export function corePairApprovePath(pairKey: string): string {
  return core_pair_approve_path(pairKey);
}

/**
 * Reads a pairing request and checks everything that does not need the typed
 * code, against a roster this device verified from its own pin.
 */
export function corePairPreview(
  ck: string,
  keyEpoch: number,
  verified: VerifiedRoster,
  body: string,
): CorePairPreview {
  return core_pair_preview(ck, BigInt(keyEpoch), verified, body);
}

/**
 * Approves a joining device: wraps the collection key for it, signs the grant,
 * and signs the roster step that adds it.
 */
export function corePairApprove(
  mldsaSeed: string,
  ed25519Sk: string,
  context: RosterContext,
  ck: string,
  keyEpoch: number,
  verified: VerifiedRoster,
  preview: CorePairPreview,
  typed: string,
): PairApproval {
  return core_pair_approve(
    mldsaSeed,
    ed25519Sk,
    context,
    ck,
    BigInt(keyEpoch),
    verified,
    preview,
    typed,
  );
}

/** Strips spacing and case differences from a typed confirmation code. */
export function coreNormalizeConfirmation(entered: string): string {
  return core_normalize_confirmation(entered);
}

/** A confirmation code split into display groups. */
export function coreConfirmationGroups(code: string): string[] {
  return core_confirmation_groups(code);
}

/** A confirmation code grouped for display. */
export function coreFormatConfirmation(code: string): string {
  return core_format_confirmation(code);
}

export type {
  AuthRequest,
  CoreDeviceSecrets,
  CoreDeviceState,
  LoggedIn,
  LoginStarting,
  PasswordChange,
  PasswordChangeStarted,
  RecoverStarted,
  Recovering,
  RegisterIdentity,
  Registering,
};

/**
 * The username to send, which is the one the user typed without surrounding
 * whitespace. The server rejects a username with a space in it.
 */
export function coreNormalizeUsername(raw: string): string {
  return core_normalize_username(raw);
}

/**
 * The phrase to derive from: lowercase and single-spaced, because BIP-39 words
 * are lowercase and a pasted phrase often is not.
 */
export function coreNormalizePhrase(raw: string): string {
  return core_normalize_phrase(raw);
}

/**
 * Begins registering a password. Also the first round of a password change, a
 * username change and a recovery.
 */
export function coreOpaqueRegisterStart(password: string): OpaqueStart {
  return core_opaque_register_start(password);
}

/** Finishes a registration, giving the verifier upload the server stores. */
export function coreOpaqueRegisterUpload(
  state: string,
  password: string,
  response: string,
): string {
  return core_opaque_register_upload(state, password, response);
}

/** Begins a login. */
export function coreOpaqueLoginStart(password: string): OpaqueStart {
  return core_opaque_login_start(password);
}

/** A new device's keys, for this app to persist. */
export function coreNewDevice(): CoreDeviceSecrets {
  return core_new_device();
}

/**
 * Everything a registration mints: a device, a collection, a collection key, a
 * KDF salt and a recovery phrase.
 */
export function coreNewRegistration(): RegisterIdentity {
  return core_new_registration();
}

export function coreRegisterStartRequest(username: string, opaqueRequest: string): AuthRequest {
  return core_register_start_request(username, opaqueRequest);
}

export function coreRegisterStartAccept(body: string): string {
  return core_register_start_accept(body);
}

/**
 * The register finish request: the genesis roster, the first manifest and the
 * three wraps of the collection key, with the anchor to pin.
 */
export function coreRegisterFinishRequest(
  username: string,
  password: string,
  upload: string,
  identity: RegisterIdentity,
): Registering {
  return core_register_finish_request(username, password, upload, identity);
}

/** Reads the register finish response into the state this device persists. */
export function coreRegisterAccept(
  server: string,
  username: string,
  identity: RegisterIdentity,
  pin: CoreRosterPin,
  body: string,
): CoreDeviceState {
  return core_register_accept(server, username, identity, pin, body);
}

export function coreLoginChallengeRequest(username: string, deviceId: string): AuthRequest {
  return core_login_challenge_request(username, deviceId);
}

/** Login step 2: open the sealed challenge and sign it with the OPAQUE request. */
export function coreLoginStartRequest(
  state: CoreDeviceState,
  opaqueRequest: string,
  body: string,
): LoginStarting {
  return core_login_start_request(state, opaqueRequest, body);
}

/** Login step 3: complete OPAQUE and bind the finalization to this device. */
export function coreLoginFinishRequest(
  state: CoreDeviceState,
  opaqueState: string,
  password: string,
  challenge: string,
  body: string,
): AuthRequest {
  return core_login_finish_request(state, opaqueState, password, challenge, body);
}

/**
 * Opens the collection key and returns the state to persist. The caller must
 * sync the roster before anything reads or writes the vault.
 */
export function coreLoginAccept(
  state: CoreDeviceState,
  password: string,
  body: string,
): LoggedIn {
  return core_login_accept(state, password, body);
}

export function coreRecoverStartRequest(
  username: string,
  phrase: string,
  opaqueRequest: string,
): AuthRequest {
  return core_recover_start_request(username, phrase, opaqueRequest);
}

/**
 * Opens the phrase wrap and checks the roster the account is on under the key
 * it opened.
 */
export function coreRecoverStartAccept(phrase: string, body: string): RecoverStarted {
  return core_recover_start_accept(phrase, body);
}

/** Enrols the recovering device and signs the roster step with the phrase. */
export function coreRecoverFinishRequest(
  username: string,
  phrase: string,
  password: string,
  started: RecoverStarted,
  device: CoreDeviceSecrets,
  upload: string,
): Recovering {
  return core_recover_finish_request(username, phrase, password, started, device, upload);
}

export function coreRecoverAccept(
  server: string,
  username: string,
  started: RecoverStarted,
  device: CoreDeviceSecrets,
  recovering: Recovering,
  body: string,
): CoreDeviceState {
  return core_recover_accept(server, username, started, device, recovering, body);
}

/** The challenge a username change or a deletion is signed over. */
export function coreAccountChallengeRequest(): AuthRequest {
  return core_account_challenge_request();
}

export function coreChangeUsernameRequest(
  state: CoreDeviceState,
  newUsername: string,
  upload: string,
  challengeBody: string,
): AuthRequest {
  return core_change_username_request(state, newUsername, upload, challengeBody);
}

export function corePasswordChangeStartRequest(opaqueRequest: string): AuthRequest {
  return core_password_change_start_request(opaqueRequest);
}

export function corePasswordChangeStartAccept(body: string): PasswordChangeStarted {
  return core_password_change_start_accept(body);
}

/**
 * The new verifier and the collection key re-wrapped under the new password,
 * with a signature covering both.
 */
export function coreChangePasswordRequest(
  state: CoreDeviceState,
  ck: string,
  newPassword: string,
  upload: string,
  started: PasswordChangeStarted,
): PasswordChange {
  return core_change_password_request(state, ck, newPassword, upload, started);
}

export function coreDeleteAccountRequest(
  state: CoreDeviceState,
  challengeBody: string,
): AuthRequest {
  return core_delete_account_request(state, challengeBody);
}
