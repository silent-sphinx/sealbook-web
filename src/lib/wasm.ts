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
  core_address_book_keys,
  core_address_book_name_by_id,
  core_address_book_parse,
  core_address_book_write,
  core_calendar_event_keys,
  core_calendar_keys,
  core_calendar_name_by_id,
  core_calendar_parse,
  core_calendar_write,
  core_bookmark_collection_keys,
  core_bookmark_collection_name_by_id,
  core_bookmark_collection_parse,
  core_bookmark_collection_tone,
  core_bookmark_collection_write,
  core_bookmark_keys,
  core_bookmark_parse,
  core_bookmark_write,
  core_default_bookmark_collection_id,
  core_default_task_list_id,
  core_normalize_due_date,
  core_resolve_task_list_id,
  core_task_keys,
  core_task_list_keys,
  core_task_list_name_by_id,
  core_task_list_parse,
  core_task_list_tone,
  core_account_settings_keys,
  core_can_disable_feature,
  core_default_account_settings,
  core_settings_parse,
  core_settings_with_feature,
  core_settings_write,
  core_task_list_write,
  core_task_parse,
  core_task_write,
  core_normalize_tags,
  core_normalize_url,
  core_resolve_collection_id,
  core_contact_keys,
  core_contact_parse,
  core_contact_profile_keys,
  core_contact_profile_parse,
  core_contact_profile_write,
  core_contact_write,
  core_default_address_book_id,
  core_default_calendar_id,
  core_default_notebook_id,
  core_resolve_address_book_id,
  core_event_parse,
  core_is_calendar_day,
  core_account_export_filename,
  core_account_export_parse,
  core_account_export_write,
  core_recurrence_days,
  core_recurrence_next,
  core_event_write,
  core_new_device,
  core_new_registration,
  core_note_keys,
  core_note_parse,
  core_note_write,
  core_notebook_keys,
  core_notebook_name_by_id,
  core_notebook_tone,
  core_notebook_parse,
  core_notebook_write,
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
  core_pair_poll,
  core_pair_status,
  core_pin_roster,
  core_roster_accept,
  core_attachment_chunk_digest,
  core_attachment_chunk_nonce,
  core_attachment_chunk_path,
  core_attachment_commit_accept,
  core_attachment_commit_request,
  core_attachment_content_hash,
  core_attachment_create_accept,
  core_attachment_create_request,
  core_attachment_delete_request,
  core_attachment_limits,
  core_attachment_meta_accept,
  core_attachment_meta_request,
  core_attachment_plan,
  core_attachment_ranges,
  core_attachment_sweep_orphans,
  core_attachment_sweep_page,
  core_attachment_sweep_request,
  core_attachment_sweep_start,
  core_attachment_verify,
  core_open_attachment_chunk,
  core_seal_attachment_chunk,
  core_roster_accept_sealed,
  core_roster_answers_for,
  core_roster_request,
  core_require_key_epoch,
  core_resolve_notebook_id,
  core_reseal_row,
  core_rotation_entries,
  core_rotation_plan,
  core_rotation_recipients,
  core_rotation_wraps,
  core_changes_page_read,
  core_walk_page,
  core_walk_start,
  create_device,
  create_enrollment,
  decrypt_contact,
  encrypt_contact,
  new_collection_key,
  new_uuid,
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
  CoreAddressBook,
  CoreAddressBookDraft,
  CoreCalendar,
  CoreCalendarDraft,
  CoreCalendarEvent,
  CoreCalendarEventDraft,
  CoreBookmark,
  CoreBookmarkCollection,
  CoreBookmarkCollectionDraft,
  CoreBookmarkDraft,
  CoreContact,
  CoreContactChannel,
  CoreContactDraft,
  CoreContactProfile,
  CoreManifestEntry,
  CoreNote,
  CoreNoteAttachment,
  CoreNoteDraft,
  CoreNotebook,
  CoreTask,
  CoreTaskDraft,
  CoreTaskList,
  CoreTaskListDraft,
  CoreAccountSettings,
  CoreAccountSettingsDraft,
  CoreFeatureFlag,
  CoreAccountImport,
  CoreExportAccount,
  CoreExportObject,
  CoreRecurrence,
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
  PairPoll,
  PairStatus,
  PasswordChange,
  PasswordChangeStarted,
  RecoverStarted,
  Recovering,
  RegisterIdentity,
  Registering,
  ResealRow,
  RosterContext,
  CoreRotationWraps,
  RotationPlan,
  AttachmentLimits,
  AttachmentPlan,
  AttachmentRow,
  ChunkRange,
  SweepCursor,
  SweepPage,
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
/** What a walk reads out of a `/changes` response body. */
export function coreChangesPageRead(body: string): ChangesPage {
  return core_changes_page_read(body);
}

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

export type { CoreRotationWraps, ResealRow, RotationPlan, RotationState };

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

/**
 * The new key wrapped for the recipients, the password and a fresh phrase, in
 * the order the rotation signature covers.
 */
export function coreRotationWraps(
  newCk: string,
  recipients: CoreDevice[],
  username: string,
  password: string,
): CoreRotationWraps {
  return core_rotation_wraps(newCk, recipients, username, password);
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

export type { CoreDevice, CorePairPreview, PairApproval, PairJoined, PairPoll, PairStatus };

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
 * What a joining device does after a poll: stop because it was approved or has
 * expired, or ask again after the stated wait. `status` is undefined when the
 * request got no answer.
 */
export function corePairPoll(status: number | undefined, body: string): PairPoll {
  return core_pair_poll(status, body);
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

// ── Core: attachments ──

export type { AttachmentLimits, AttachmentPlan, AttachmentRow, ChunkRange, SweepCursor, SweepPage };

/**
 * The protocol's ceiling, the chunk size, the nonce header and the sweep's
 * grace period. This client's own lower ceiling is `MAX_ATTACHMENT_SIZE`.
 */
export function coreAttachmentLimits(): AttachmentLimits {
  return core_attachment_limits();
}

/**
 * Decides an upload: a fresh id and key, and how the plaintext is cut up.
 *
 * Throws on an empty file and on one over the protocol ceiling, so neither
 * becomes a server error with nothing the user can do about it.
 */
export function coreAttachmentPlan(totalPlaintextSize: number): AttachmentPlan {
  return core_attachment_plan(BigInt(totalPlaintextSize));
}

/** The slices of plaintext the plan's chunks are taken from, in order. */
export function coreAttachmentRanges(plan: AttachmentPlan): ChunkRange[] {
  return core_attachment_ranges(plan);
}

export function coreAttachmentCreateRequest(
  collectionId: string,
  plan: AttachmentPlan,
): HttpRequest {
  return core_attachment_create_request(collectionId, plan);
}

export function coreAttachmentCreateAccept(plan: AttachmentPlan, body: string): void {
  core_attachment_create_accept(plan, body);
}

export function coreAttachmentChunkPath(
  collectionId: string,
  attachmentId: string,
  index: number,
): string {
  return core_attachment_chunk_path(collectionId, attachmentId, index);
}

/**
 * Seals one chunk, returning its nonce prepended to its ciphertext. The caller
 * splits the first `nonce_len` bytes off: the two travel apart on the wire, and
 * a second call would seal under a second nonce.
 */
export function coreSealAttachmentChunk(
  key: string,
  attachmentId: string,
  collectionId: string,
  index: number,
  chunkCount: number,
  plaintext: Uint8Array,
): Uint8Array<ArrayBuffer> {
  // wasm-bindgen copies its return into a fresh, non-shared buffer.
  return core_seal_attachment_chunk(
    key,
    attachmentId,
    collectionId,
    index,
    chunkCount,
    plaintext,
  ) as Uint8Array<ArrayBuffer>;
}

/** Opens one chunk. A chunk that will not open is a tampered or corrupt download. */
export function coreOpenAttachmentChunk(
  key: string,
  attachmentId: string,
  collectionId: string,
  index: number,
  chunkCount: number,
  nonce: string,
  ciphertext: Uint8Array,
): Uint8Array<ArrayBuffer> {
  return core_open_attachment_chunk(
    key,
    attachmentId,
    collectionId,
    index,
    chunkCount,
    nonce,
    ciphertext,
  ) as Uint8Array<ArrayBuffer>;
}

/** The nonce a chunk response carried, or a refusal for one that carried none. */
export function coreAttachmentChunkNonce(header: string | null): string {
  return core_attachment_chunk_nonce(header ?? undefined);
}

export function coreAttachmentCommitRequest(
  collectionId: string,
  attachmentId: string,
): HttpRequest {
  return core_attachment_commit_request(collectionId, attachmentId);
}

export function coreAttachmentCommitAccept(attachmentId: string, body: string): void {
  core_attachment_commit_accept(attachmentId, body);
}

export function coreAttachmentMetaRequest(
  collectionId: string,
  attachmentId: string,
): HttpRequest {
  return core_attachment_meta_request(collectionId, attachmentId);
}

/**
 * Whether the server is holding the attachment this note references, checked
 * against the chunk count the note carries rather than the server's own.
 */
export function coreAttachmentMetaAccept(
  attachmentId: string,
  chunkCount: number,
  body: string,
): void {
  core_attachment_meta_accept(attachmentId, chunkCount, body);
}

export function coreAttachmentDeleteRequest(
  collectionId: string,
  attachmentId: string,
): HttpRequest {
  return core_attachment_delete_request(collectionId, attachmentId);
}

/**
 * One chunk's plaintext digest, rolled up later by `coreAttachmentContentHash`.
 *
 * Replaces the hasher object this module used to construct and free: the
 * digests are values, so a download that throws part way leaks nothing.
 */
export function coreAttachmentChunkDigest(plaintext: Uint8Array): string {
  return core_attachment_chunk_digest(plaintext);
}

/** The hash the owning note commits to, rolled from every chunk's digest. */
export function coreAttachmentContentHash(digests: string[]): string {
  return core_attachment_content_hash(digests);
}

/** Checks a download reproduced what the note committed to. */
export function coreAttachmentVerify(
  attachmentId: string,
  expectedHash: string,
  digests: string[],
): void {
  core_attachment_verify(attachmentId, expectedHash, digests);
}

export function coreAttachmentSweepStart(): SweepCursor {
  return core_attachment_sweep_start();
}

export function coreAttachmentSweepRequest(
  collectionId: string,
  cursor: SweepCursor,
): HttpRequest {
  return core_attachment_sweep_request(collectionId, cursor);
}

/**
 * One page of the listing, and where to ask next. `next` is absent once the
 * listing is exhausted, which includes a cursor the sweep already followed.
 */
export function coreAttachmentSweepPage(cursor: SweepCursor, body: string): SweepPage {
  return core_attachment_sweep_page(cursor, body);
}

/**
 * Which listed attachments are safe to delete. `nowSecs` is the caller's clock:
 * core has none.
 */
export function coreAttachmentSweepOrphans(
  rows: AttachmentRow[],
  referenced: string[],
  nowSecs: number,
): string[] {
  return [...core_attachment_sweep_orphans(rows, referenced, BigInt(nowSecs))];
}

// ── Core: payload schemas ──
//
// The one layer with no server check behind it: objects are sealed before they
// leave, so the content type string is all the server ever sees. Core owns the
// key list, the writer and the lenient reader; this client keeps its own view
// models and maps to and from the core record.

export type { CoreNote, CoreNoteAttachment, CoreNoteDraft, CoreNotebook };

/**
 * Every key a note writer owns: the union across all four clients, not the
 * subset this one's editor can show. `notePayloadKeys` in `note.ts` is held to
 * this list by `noteParity.test.ts`.
 */
export function coreNoteKeys(): string[] {
  return [...core_note_keys()];
}

export function coreNotebookKeys(): string[] {
  return [...core_notebook_keys()];
}

export function coreDefaultNotebookId(): string {
  return core_default_notebook_id();
}

export function coreResolveNotebookId(notebookId?: string): string {
  return core_resolve_notebook_id(notebookId);
}

/**
 * Reads a stored note payload. Lenient throughout: one that will not parse comes
 * back under a title the user can still find and delete the note by.
 */
export function coreNoteParse(id: string, raw: string): CoreNote {
  return core_note_parse(id, raw);
}

/**
 * Serialises a note onto `draft.raw`, so a field this build does not manage
 * survives the save. `now` is the caller's clock: core has none.
 *
 * Throws `PayloadSchema` for a note written by a newer client, which this build
 * may read but must not write over.
 */
export function coreNoteWrite(draft: CoreNoteDraft, now: string): string {
  return core_note_write(draft, now);
}

export function coreNotebookParse(id: string, raw: string): CoreNotebook {
  return core_notebook_parse(id, raw);
}

export function coreNotebookWrite(name: string, previousRaw?: string): string {
  return core_notebook_write(name, previousRaw);
}

/**
 * The name to show for a note's notebook. A notebook that is gone shows the
 * default notebook's name rather than nothing, since a missing notebook and a
 * blank one look the same to the user.
 */
export function coreNotebookNameById(notebooks: CoreNotebook[], notebookId?: string): string {
  return core_notebook_name_by_id(notebooks, notebookId);
}

/** A notebook's colour, derived from its id. */
export function coreNotebookTone(id: string): string {
  return core_notebook_tone(id);
}

export type {
  CoreCalendar,
  CoreCalendarDraft,
  CoreCalendarEvent,
  CoreCalendarEventDraft,
  CoreRecurrence,
};

/**
 * Every key a calendar writer owns, and every key an event writer owns. Both
 * are the union across every client; `calendarParity.test.ts` holds this
 * client's view models to them.
 */
export function coreCalendarKeys(): string[] {
  return [...core_calendar_keys()];
}

export function coreCalendarEventKeys(): string[] {
  return [...core_calendar_event_keys()];
}

export function coreDefaultCalendarId(): string {
  return core_default_calendar_id();
}

/**
 * Reads a stored calendar payload. Lenient throughout: one that will not parse
 * comes back as a named row the user can still find and delete.
 */
export function coreCalendarParse(id: string, raw: string): CoreCalendar {
  return core_calendar_parse(id, raw);
}

/**
 * Serialises a calendar onto `draft.raw`, so the colour and the flags this write
 * does not change survive it.
 *
 * Throws `PayloadSchema` for a calendar written by a newer client, which this
 * build may read but must not write over.
 */
export function coreCalendarWrite(draft: CoreCalendarDraft): string {
  return core_calendar_write(draft);
}

/** The days a rule lands on from `from` to `to` inclusive, as `YYYY-MM-DD`. */
export function coreRecurrenceDays(anchor: string, rule: CoreRecurrence, from: string, to: string): string[] {
  return core_recurrence_days(anchor, rule, from, to);
}

/** The first day of a rule after `after`, or null once the rule is spent. */
export function coreRecurrenceNext(anchor: string, rule: CoreRecurrence, after: string): string | null {
  return core_recurrence_next(anchor, rule, after) ?? null;
}

/** Whether the text is a real calendar day; `Date.parse` accepts `2026-02-30`. */
export function coreIsCalendarDay(text: string): boolean {
  return core_is_calendar_day(text);
}

export function coreEventParse(id: string, raw: string): CoreCalendarEvent {
  return core_event_parse(id, raw);
}

/**
 * Serialises an event onto `draft.raw`. A repeat rule core cannot name rides
 * through in `unreadable_recurrence` rather than being dropped.
 */
export function coreEventWrite(draft: CoreCalendarEventDraft): string {
  return core_event_write(draft);
}

/**
 * The name to show for an event's calendar. A calendar that is gone shows the
 * default calendar's name; an event in no calendar at all has no name to show.
 */
export function coreCalendarNameById(calendars: CoreCalendar[], calendarId?: string): string | undefined {
  return core_calendar_name_by_id(calendars, calendarId);
}

export type {
  CoreAddressBook,
  CoreAddressBookDraft,
  CoreContact,
  CoreContactChannel,
  CoreContactDraft,
  CoreContactProfile,
};

/**
 * Every key a card writer owns: the union across every client, legacy spellings
 * included. `contactParity.test.ts` holds this client's constants to it.
 */
export function coreContactKeys(): string[] {
  return [...core_contact_keys()];
}

export function coreAddressBookKeys(): string[] {
  return [...core_address_book_keys()];
}

export function coreContactProfileKeys(): string[] {
  return [...core_contact_profile_keys()];
}

export function coreDefaultAddressBookId(): string {
  return core_default_address_book_id();
}

/** A blank id, or the sidebar's `all`, is the default address book. */
export function coreResolveAddressBookId(id?: string): string {
  return core_resolve_address_book_id(id);
}

/**
 * Reads a stored card. Lenient throughout: one that will not parse comes back as
 * a named row the user can still find and delete.
 */
export function coreContactParse(id: string, raw: string): CoreContact {
  return core_contact_parse(id, raw);
}

/**
 * Serialises a card onto `draft.raw`, so the entries the editor does not show
 * (a second address, a second note, a key from a later build) survive the write.
 * `now` is this client's clock.
 *
 * Throws `PayloadSchema` for a card written by a newer client, which this build
 * may read but must not write over.
 */
export function coreContactWrite(draft: CoreContactDraft, now: string): string {
  return core_contact_write(draft, now);
}

/** A profile off its JSON text, for the importers. Undefined if it is not one. */
export function coreContactProfileParse(raw: string): CoreContactProfile | undefined {
  return core_contact_profile_parse(raw);
}

/** A profile as JSON text, or undefined when nothing in it would be written. */
export function coreContactProfileWrite(profile: CoreContactProfile): string | undefined {
  return core_contact_profile_write(profile);
}

export function coreAddressBookParse(id: string, raw: string): CoreAddressBook {
  return core_address_book_parse(id, raw);
}

export function coreAddressBookWrite(draft: CoreAddressBookDraft): string {
  return core_address_book_write(draft);
}

/** A book that is gone, or a card in none, shows the default book's name. */
export function coreAddressBookNameById(books: CoreAddressBook[], addressBookId?: string): string {
  return core_address_book_name_by_id(books, addressBookId);
}

export type {
  CoreBookmark,
  CoreBookmarkCollection,
  CoreBookmarkCollectionDraft,
  CoreBookmarkDraft,
};

/** Every key a bookmark writer owns, and every key a collection writer owns. */
export function coreBookmarkKeys(): string[] {
  return [...core_bookmark_keys()];
}

export function coreBookmarkCollectionKeys(): string[] {
  return [...core_bookmark_collection_keys()];
}

export function coreDefaultBookmarkCollectionId(): string {
  return core_default_bookmark_collection_id();
}

export function coreResolveCollectionId(collectionId?: string): string {
  return core_resolve_collection_id(collectionId);
}

export function coreNormalizeUrl(url: string): string {
  return core_normalize_url(url);
}

export function coreNormalizeTags(tags: string[]): string[] {
  return [...core_normalize_tags(tags)];
}

/** Reads a stored bookmark. Lenient: one that will not parse is still a row. */
export function coreBookmarkParse(id: string, raw: string): CoreBookmark {
  return core_bookmark_parse(id, raw);
}

/**
 * Serialises a bookmark onto `draft.raw`. `now` is the caller's clock. Throws
 * `PayloadSchema` for a bookmark written by a newer client.
 */
export function coreBookmarkWrite(draft: CoreBookmarkDraft, now: string): string {
  return core_bookmark_write(draft, now);
}

export function coreBookmarkCollectionParse(id: string, raw: string): CoreBookmarkCollection {
  return core_bookmark_collection_parse(id, raw);
}

export function coreBookmarkCollectionWrite(draft: CoreBookmarkCollectionDraft): string {
  return core_bookmark_collection_write(draft);
}

export function coreBookmarkCollectionNameById(
  collections: CoreBookmarkCollection[],
  collectionId?: string,
): string {
  return core_bookmark_collection_name_by_id(collections, collectionId);
}

export function coreBookmarkCollectionTone(
  collections: CoreBookmarkCollection[],
  id: string,
): string {
  return core_bookmark_collection_tone(collections, id);
}

export type { CoreTask, CoreTaskDraft, CoreTaskList, CoreTaskListDraft };

/** Every key a task writer owns, and every key a task list writer owns. */
export function coreTaskKeys(): string[] {
  return [...core_task_keys()];
}

export function coreTaskListKeys(): string[] {
  return [...core_task_list_keys()];
}

export function coreDefaultTaskListId(): string {
  return core_default_task_list_id();
}

export function coreResolveTaskListId(taskListId?: string): string {
  return core_resolve_task_list_id(taskListId);
}

/** A due value as it should be stored, or undefined where it names no moment. */
export function coreNormalizeDueDate(value: string): string | undefined {
  return core_normalize_due_date(value) ?? undefined;
}

/** Reads a stored task. Lenient: one that will not parse is still a row. */
export function coreTaskParse(id: string, raw: string): CoreTask {
  return core_task_parse(id, raw);
}

/**
 * Serialises a task onto `draft.raw`. `now` is the caller's clock. Throws
 * `PayloadSchema` for a task written by a newer client.
 */
export function coreTaskWrite(draft: CoreTaskDraft, now: string): string {
  return core_task_write(draft, now);
}

export function coreTaskListParse(id: string, raw: string): CoreTaskList {
  return core_task_list_parse(id, raw);
}

export function coreTaskListWrite(draft: CoreTaskListDraft): string {
  return core_task_list_write(draft);
}

export function coreTaskListNameById(lists: CoreTaskList[], taskListId?: string): string {
  return core_task_list_name_by_id(lists, taskListId);
}

export function coreTaskListTone(lists: CoreTaskList[], id: string): string {
  return core_task_list_tone(lists, id);
}

export type { CoreAccountSettings, CoreAccountSettingsDraft, CoreFeatureFlag };

/** Every key the account settings writer owns. */
export function coreAccountSettingsKeys(): string[] {
  return [...core_account_settings_keys()];
}

export function coreDefaultAccountSettings(): CoreAccountSettings {
  return core_default_account_settings();
}

/** Reads a stored settings payload. Lenient: one that will not parse is the defaults. */
export function coreSettingsParse(raw: string): CoreAccountSettings {
  return core_settings_parse(raw);
}

/**
 * Serialises settings onto `draft.raw`. Throws `PayloadSchema` over a payload
 * from a newer schema major.
 */
export function coreSettingsWrite(draft: CoreAccountSettingsDraft): string {
  return core_settings_write(draft);
}

export function coreSettingsWithFeature(
  settings: CoreAccountSettings,
  feature: string,
  enabled: boolean,
): CoreAccountSettings {
  return core_settings_with_feature(settings, feature, enabled);
}

export function coreCanDisableFeature(settings: CoreAccountSettings, feature: string): boolean {
  return core_can_disable_feature(settings, feature);
}

// ── Core: the account export document ──

export type { CoreAccountImport, CoreExportAccount, CoreExportObject };

export function coreAccountExportWrite(
  account: CoreExportAccount,
  objects: CoreExportObject[],
  unreadable: number,
  exportedAt: string,
): string {
  return core_account_export_write(account, objects, unreadable, exportedAt);
}

/** Throws the core error, whose `detail` is a sentence fit to show the user. */
export function coreAccountExportParse(document: string): CoreAccountImport {
  return core_account_export_parse(document);
}

export function coreAccountExportFilename(username: string, day: string): string {
  return core_account_export_filename(username, day);
}
