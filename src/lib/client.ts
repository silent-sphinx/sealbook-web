import { b64ToByteArray, bytesFromJson } from "./bytes";
import {
  accountOpSign,
  createDevice,
  createEnrollment,
  decryptContact,
  encryptContact,
  generateNewPhrase,
  loginStartProof,
  manifestSign,
  manifestVerify,
  newCollectionKey,
  newUuid,
  objectContentDigest,
  opaqueLoginFinish,
  opaqueLoginStart,
  opaqueRegisterFinish,
  opaqueRegisterStart,
  pairConfirmationCode,
  pairGrantSign,
  phraseLookupId,
  phraseRecoveryProof,
  rotationSign,
  unwrapCk,
  unwrapPhrase,
  wrapCkForDevice,
  wrapCkForPassword,
} from "./wasm";
import { parseContact, serializeCard, sortContacts } from "./contact";
import { normalizeConfirmation } from "./pairing";
import {
  ADDRESS_BOOK_CONTENT_TYPE,
  DEFAULT_ADDRESS_BOOK_ID,
  DEFAULT_ADDRESS_BOOK_NAME,
  JSCONTACT_CONTENT_TYPE,
  parseAddressBook,
  serializeAddressBook,
  sortAddressBooks,
} from "./addressBook";
import {
  DEFAULT_NOTEBOOK_ID,
  DEFAULT_NOTEBOOK_NAME,
  NOTEBOOK_CONTENT_TYPE,
  NOTE_CONTENT_TYPE,
  parseNote,
  parseNotebook,
  serializeNote,
  serializeNotebook,
  sortNotebooks,
  sortNotes,
} from "./note";
import type {
  AddressBook,
  Calendar,
  CalendarEvent,
  Contact,
  ContactDraft,
  DeviceOut,
  DevicePublic,
  DeviceState,
  KeyWrap,
  ManifestBody,
  ManifestEntry,
  Note,
  NoteDraft,
  Notebook,
  RotatedObject,
  SealedObject,
} from "./types";
import { DEFAULT_CALENDAR_COLOR } from "./types";

export const CALENDAR_EVENT_CONTENT_TYPE = "application/sealbook.calendar-event+json";
export const CALENDAR_CONTENT_TYPE = "application/sealbook.calendar+json";

class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    try {
      const body = JSON.parse(text) as { error?: string };
      throw new ApiError(body.error ?? text);
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(text || res.statusText);
    }
  }
  return JSON.parse(text) as T;
}

export function normalizeServer(server: string): string {
  const trimmed = server.trim().replace(/\/$/u, "");
  if (!trimmed) {
    return "";
  }
  const candidate = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Connection domain must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Connection domain cannot contain credentials.");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/$/u, "")}`;
}

function apiRoot(server: string): string {
  const trimmed = normalizeServer(server);
  if (
    !trimmed ||
    trimmed === "https://127.0.0.1:8443" ||
    trimmed === "https://localhost:8443"
  ) {
    return "";
  }
  return trimmed;
}

async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return parse<T>(
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function putJson<T>(url: string, body: unknown, token: string): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

async function getJson<T>(url: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return parse<T>(await fetch(url, { headers }));
}

async function deleteJson<T>(url: string, token: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

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
  offline?: boolean;
};

/** The server served something no enrolled device signed for. Never transient. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/**
 * Records the highest manifest sequence this device has accepted.
 *
 * Written through to the device state, not just the session, so that closing the
 * app and reopening it cannot be used to rewind the high-water mark.
 */
function rememberManifestSeq(session: Session, seq: number): void {
  session.manifestSeq = seq;
  session.state.manifest_seq = seq;
}

/** The collection's signed manifest and the entries it commits to. */
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
async function manifestState(session: Session): Promise<{
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
async function verifyManifest(
  session: Session,
  manifest: ManifestBody,
  entries: ManifestEntry[],
): Promise<void> {
  if (manifest.manifest_seq < session.manifestSeq) {
    throw new ManifestError(
      `The vault went backwards: this device has seen manifest ${session.manifestSeq} but the ` +
        `server served ${manifest.manifest_seq}.`,
    );
  }
  if (manifest.object_count !== entries.length) {
    throw new ManifestError(
      `Server sent ${entries.length} objects but the manifest commits to ${manifest.object_count}.`,
    );
  }
  const devices = await listDevices(session);
  const signer = devices.find((device) => device.device_id === manifest.device_id);
  if (!signer) {
    throw new ManifestError("The vault manifest was signed by a device this account does not have.");
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
    throw new ManifestError(err instanceof Error ? err.message : String(err));
  }
  rememberManifestSeq(session, manifest.manifest_seq);
}

/** The manifest entry a sealed object contributes. */
function entryFor(object: {
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

type SealedPayload = {
  version: 1;
  contentType: string;
  tombstone: boolean;
  revision: number;
  payload: string;
};

function sealPayload(
  session: Session,
  id: string,
  contentType: string,
  tombstone: boolean,
  payload: string,
  revision: number,
) {
  const envelope: SealedPayload = {
    version: 1,
    contentType,
    tombstone,
    revision,
    payload,
  };
  return { revision, encrypted: encryptContact(session.collectionKey, id, session.state.collection_id, JSON.stringify(envelope)) };
}

/**
 * Writes one object, signing a manifest for the state the write leaves behind.
 *
 * The revision is chosen here rather than by the server, because the manifest has
 * to commit to it. If another device wrote first the server answers `409` and the
 * write is retried against the manifest that device left.
 */
async function putSealed(
  session: Session,
  id: string,
  contentType: string,
  tombstone: boolean,
  payload: string,
): Promise<number> {
  const attempt = async (): Promise<number> => {
    const { seq, keyEpoch, latestRevision, entries } = await manifestState(session);
    const revision = latestRevision + 1;
    const sealed = sealPayload(session, id, contentType, tombstone, payload, revision);
    const entry: ManifestEntry = {
      id,
      revision,
      tombstone,
      content_digest: objectContentDigest(sealed.encrypted.nonce, sealed.encrypted.ciphertext),
    };
    const next = entries.filter((existing) => existing.id !== id);
    next.push(entry);
    const manifest = manifestSign(
      bytesFromJson(session.state.mldsa_seed),
      bytesFromJson(session.state.ed25519_sk),
      session.state.collection_id,
      session.state.device_id,
      seq + 1,
      keyEpoch,
      revision,
      next,
    );
    const response = await putJson<{ revision: number }>(
      `${apiRoot(session.state.server)}/v1/collections/${session.state.collection_id}/objects`,
      {
        id,
        revision,
        nonce: sealed.encrypted.nonce,
        ciphertext: sealed.encrypted.ciphertext,
        padded_size: sealed.encrypted.padded_size,
        content_type: contentType,
        tombstone,
        manifest,
      },
      session.token,
    );
    session.latestRevision = response.revision;
    rememberManifestSeq(session, seq + 1);
    return response.revision;
  };

  try {
    return await attempt();
  } catch (error) {
    // A conflict means another device wrote between reading the manifest and
    // writing. Rebuild against the new one and try once more.
    if (error instanceof Error && /stale (revision|manifest)/iu.test(error.message)) {
      return attempt();
    }
    throw error;
  }
}

export async function revokeSession(session: Session): Promise<void> {
  await deleteJson(`${apiRoot(session.state.server)}/v1/session`, session.token);
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
  };
}

function deviceFromEnrollment(
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

function deviceFromKeys(
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

function deviceBody(device: DeviceOut) {
  return {
    device_id: device.device_id,
    mldsa_pk: device.mldsa_pk,
    ed25519_pk: device.ed25519_pk,
    xwing_hpke_pk: device.hpke_pk,
  };
}

function enrollSig(device: DeviceOut) {
  return {
    mldsa: device.enrollment_mldsa,
    ed25519: device.enrollment_ed25519,
  };
}

export type RegisterResult = {
  session: Session;
  phrase: string;
};

export async function registerAccount(
  server: string,
  username: string,
  password: string,
): Promise<RegisterResult> {
  const root = apiRoot(server);
  // Chosen here, not by the server, so the initial manifest can be signed over it
  // before the account exists.
  const collectionId = newUuid();
  const start = opaqueRegisterStart(password);
  const started = await postJson<{ response: string }>(`${root}/v1/opaque/register/start`, {
    username,
    request: start.request,
  });
  const upload = opaqueRegisterFinish(start.state, password, started.response);
  const enrollment = createEnrollment(password);
  const finished = await postJson<{ account_id: string; collection_id: string }>(
    `${root}/v1/opaque/register/finish`,
    {
      username,
      upload,
      kdf_salt: enrollment.kdf_salt,
      device: {
        device_id: enrollment.device_id,
        mldsa_pk: enrollment.mldsa_pk,
        ed25519_pk: enrollment.ed25519_pk,
        xwing_hpke_pk: enrollment.hpke_pk,
      },
      enrollment_signature: {
        mldsa: enrollment.enrollment_mldsa,
        ed25519: enrollment.enrollment_ed25519,
      },
      key_wraps: [
        {
          recipient_kind: "device",
          recipient_id: enrollment.device_id,
          hpke_enc: enrollment.device_enc,
          wrapped_ck: enrollment.device_wrapped_ck,
          ciphersuite: enrollment.xwing_ciphersuite,
        },
        {
          recipient_kind: "recovery",
          recipient_id: username,
          hpke_enc: enrollment.recovery_nonce,
          wrapped_ck: enrollment.recovery_wrapped_ck,
          ciphersuite: enrollment.recovery_ciphersuite,
        },
        {
          recipient_kind: "phrase",
          recipient_id: username,
          hpke_enc: enrollment.phrase_nonce,
          wrapped_ck: enrollment.phrase_wrapped_ck,
          ciphersuite: enrollment.phrase_ciphersuite,
        },
      ],
      phrase_recovery: {
        mldsa_pk: enrollment.phrase_mldsa_pk,
        ed25519_pk: enrollment.phrase_ed25519_pk,
        lookup_id: enrollment.phrase_lookup_id,
        scheme: enrollment.phrase_scheme,
      },
      collection_id: collectionId,
      // An account has a signed manifest from the moment it exists, so a client is
      // never asked to accept an unsigned "your vault is empty".
      manifest: manifestSign(
        enrollment.mldsa_seed,
        enrollment.ed25519_sk,
        collectionId,
        enrollment.device_id,
        1,
        1,
        0,
        [],
      ),
    },
  );
  const state = deviceFromEnrollment(
    root,
    username,
    finished.account_id,
    finished.collection_id,
    enrollment,
  );
  return {
    session: await loginAccount(state, password),
    phrase: enrollment.phrase,
  };
}

export async function pairJoin(
  server: string,
  username: string,
): Promise<{ pairId: string; pairCode: string; confirm: string; state: DeviceState }> {
  const root = apiRoot(server);
  const device = createDevice();
  const joined = await postJson<{ pair_id: string; pair_code: string; confirm: string }>(`${root}/v1/pair/join`, {
    username,
    device: deviceBody(device),
    enrollment_signature: enrollSig(device),
  });
  const confirm = pairConfirmationCode(
    joined.pair_id,
    device.device_id,
    device.mldsa_pk,
    device.ed25519_pk,
    device.hpke_pk,
  );
  if (joined.confirm !== confirm) {
    throw new Error("Pairing confirmation mismatch");
  }
  return {
    pairId: joined.pair_id,
    pairCode: joined.pair_code,
    confirm,
    state: deviceFromKeys(root, username, "", "", device),
  };
}

export async function pairReady(server: string, pairCode: string): Promise<boolean> {
  const status = await getJson<{ status: string }>(`${apiRoot(server)}/v1/pair/${encodeURIComponent(pairCode)}`);
  return status.status === "ready";
}

export type PairPreview = {
  pairId: string;
  confirm: string;
  device: DevicePublic;
};

export async function pairPreview(
  session: Session,
  pairCode: string,
): Promise<PairPreview> {
  const resp = await getJson<{
    pair_id: string;
    confirm: string;
    device?: DevicePublic | null;
  }>(`${apiRoot(session.state.server)}/v1/pair/${encodeURIComponent(pairCode)}`, session.token);
  if (!resp.device) {
    throw new Error("expired");
  }
  return { pairId: resp.pair_id, confirm: resp.confirm, device: resp.device };
}

export async function pairApprove(
  session: Session,
  pairCode: string,
  preview: PairPreview,
  confirmation: string,
): Promise<string> {
  const wrap = wrapCkForDevice(session.collectionKey, preview.device.xwing_hpke_pk);
  const confirm = pairConfirmationCode(
    preview.pairId,
    preview.device.device_id,
    preview.device.mldsa_pk,
    preview.device.ed25519_pk,
    preview.device.xwing_hpke_pk,
  );
  // Codes are 26 characters and shown in groups, so compare on the normalized
  // form but always send the canonical one.
  if (preview.confirm !== confirm || normalizeConfirmation(confirmation) !== confirm) {
    throw new Error("Pairing confirmation mismatch");
  }
  const grant = pairGrantSign(
    bytesFromJson(session.state.mldsa_seed),
    bytesFromJson(session.state.ed25519_sk),
    preview.pairId,
    session.state.device_id,
    preview.device.device_id,
    preview.device.mldsa_pk,
    preview.device.ed25519_pk,
    preview.device.xwing_hpke_pk,
    confirm,
  );
  await postJson(
    `${apiRoot(session.state.server)}/v1/pair/${encodeURIComponent(pairCode)}/approve`,
    {
      wrap: {
        recipient_kind: "device",
        recipient_id: preview.device.device_id,
        hpke_enc: wrap.enc,
        wrapped_ck: wrap.wrapped_ck,
        ciphersuite: wrap.ciphersuite,
      },
      grant,
      confirmation: confirm,
    },
    session.token,
  );
  return preview.confirm;
}

/**
 * Recovers an account onto a fresh device and rotates the vault key.
 *
 * Returns the **new** recovery phrase, which the caller must show to the user: the
 * one they just used no longer works.
 */
export async function recoverAccount(
  server: string,
  username: string,
  phrase: string,
  password: string,
): Promise<{ session: Session; phrase: string }> {
  const root = apiRoot(server);
  const words = phrase.trim().toLowerCase().split(/\s+/u).join(" ");
  const started = await postJson<{
    wrap: KeyWrap;
    recovery_id: string;
    challenge: string;
  }>(`${root}/v1/recover/start`, {
    username,
    lookup_id: phraseLookupId(words),
  });
  const ck = unwrapPhrase(words, started.wrap.hpke_enc, started.wrap.wrapped_ck);
  const device = createDevice();
  const wrap = wrapCkForDevice(ck, device.hpke_pk);
  const finished = await postJson<{ account_id: string; collection_id: string }>(
    `${root}/v1/recover/finish`,
    {
      username,
      recovery_id: started.recovery_id,
      challenge: started.challenge,
      phrase_proof: phraseRecoveryProof(
        words,
        username,
        started.recovery_id,
        started.challenge,
        device.device_id,
        device.mldsa_pk,
        device.ed25519_pk,
        device.hpke_pk,
      ),
      device: deviceBody(device),
      enrollment_signature: enrollSig(device),
      wrap: {
        recipient_kind: "device",
        recipient_id: device.device_id,
        hpke_enc: wrap.enc,
        wrapped_ck: wrap.wrapped_ck,
        ciphersuite: wrap.ciphersuite,
      },
    },
  );
  const state = deviceFromKeys(
    root,
    username,
    finished.account_id,
    finished.collection_id,
    device,
  );
  const session = await loginAccount(state, password);
  // The phrase just used would otherwise keep working, and so would any copy of it
  // someone else kept: enrolling a device does not change the key the phrase
  // unwraps. Rotate, which issues a fresh phrase and retires the old one.
  return rotateVault(session, null, password);
}

export async function loginAccount(
  state: DeviceState,
  password: string,
): Promise<Session> {
  const root = apiRoot(state.server);
  const hpkeSk = bytesFromJson(state.hpke_sk);
  const mldsaSeed = bytesFromJson(state.mldsa_seed);
  const ed25519Sk = bytesFromJson(state.ed25519_sk);
  const start = opaqueLoginStart(password);

  // Step 1: ask for a challenge sealed to this device's X-Wing key.
  const challenged = await postJson<{
    challenge_id: string;
    challenge_enc: string;
    challenge_ct: string;
  }>(`${root}/v1/opaque/login/challenge`, {
    username: state.username,
    device_id: state.device_id,
  });

  // Step 2: prove device possession. The server withholds the OPAQUE
  // credential response until this verifies, which is what keeps the password
  // out of reach of an attacker who can break Ristretto255.
  const startProof = loginStartProof(
    hpkeSk,
    challenged.challenge_enc,
    challenged.challenge_ct,
    challenged.challenge_id,
    state.username,
    state.device_id,
    start.request,
    mldsaSeed,
    ed25519Sk,
  );
  const started = await postJson<{
    login_id: string;
    response: string;
  }>(`${root}/v1/opaque/login/start`, {
    challenge_id: challenged.challenge_id,
    username: state.username,
    device_id: state.device_id,
    challenge: startProof.challenge,
    request: start.request,
    device_signature: {
      mldsa: startProof.mldsa,
      ed25519: startProof.ed25519,
    },
  });

  // Step 3: complete OPAQUE and bind the finalization to the device.
  const proof = opaqueLoginFinish(
    start.state,
    password,
    started.response,
    startProof.challenge,
    started.login_id,
    state.username,
    state.device_id,
    mldsaSeed,
    ed25519Sk,
  );
  const finished = await postJson<{
    account_id: string;
    collection_id: string;
    session_token: string;
    kdf_salt: string;
    key_wraps: KeyWrap[];
    key_epoch: number;
  }>(`${root}/v1/opaque/login/finish`, {
    login_id: started.login_id,
    username: state.username,
    device_id: state.device_id,
    finalization: proof.finalization,
    device_signature: {
      mldsa: proof.mldsa,
      ed25519: proof.ed25519,
    },
  });
  const collectionKey = unwrapCk(
    password,
    finished.kdf_salt,
    hpkeSk,
    state.device_id,
    JSON.stringify(finished.key_wraps),
  );
  return {
    collectionKey,
    token: finished.session_token,
    latestRevision: 0,
    // Login hands back wraps for the current key, so start in sync: a refresh
    // should only happen when a rotation actually moves the epoch.
    keyEpoch: finished.key_epoch,
    // Seeded from the device state, not from zero: the high-water mark has to
    // outlive the session or a restart would reopen the rollback window.
    manifestSeq: state.manifest_seq ?? 0,
    state: {
      ...state,
      server: root,
      account_id: finished.account_id,
      collection_id: finished.collection_id,
      kdf_salt: b64ToByteArray(finished.kdf_salt),
      session_token: finished.session_token,
    },
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
  session.keyEpoch = resp.key_epoch;
  return resp.key_epoch;
}

export async function listVault(
  session: Session,
): Promise<{ sealed: SealedObject[]; addressBooks: AddressBook[]; contacts: Contact[]; calendars: Calendar[]; calendarEvents: CalendarEvent[]; notes: Note[]; notebooks: Notebook[] }> {
  const { state, token } = session;
  // Walk every page before verifying: the manifest commits to the collection, not
  // to any one page of it.
  let after = 0;
  let keyEpoch = session.keyEpoch;
  let latestRevision = session.latestRevision;
  let manifest: ManifestBody | null = null;
  const pageObjects: SealedObject[] = [];
  for (;;) {
    const page = await getJson<{
      latest_revision: number;
      key_epoch: number;
      objects: SealedObject[];
      has_more: boolean;
      manifest: ManifestBody | null;
    }>(
      `${apiRoot(state.server)}/v1/collections/${state.collection_id}/changes?after=${after}&limit=500`,
      token,
    );
    keyEpoch = page.key_epoch;
    latestRevision = Math.max(latestRevision, page.latest_revision);
    manifest = page.manifest;
    pageObjects.push(...page.objects);
    const high = page.objects.reduce((top, object) => Math.max(top, object.revision), 0);
    if (!page.has_more || high <= after) break;
    after = high;
  }
  const resp = { latest_revision: latestRevision, key_epoch: keyEpoch, objects: pageObjects };
  session.latestRevision = resp.latest_revision;
  // If another device revoked someone, the key was rotated and everything was
  // re-encrypted. Pick up the new key before decrypting, otherwise every object
  // would fail to open and the vault would look empty.
  if (resp.key_epoch !== session.keyEpoch) {
    await refreshCollectionKey(session);
  }
  const { collectionKey } = session;
  const sealed: SealedObject[] = [];
  const addressBooks: AddressBook[] = [];
  const contacts: Contact[] = [];
  const calendarEvents: CalendarEvent[] = [];
  const calendars: Calendar[] = [];
  const notes: Note[] = [];
  const notebooks: Notebook[] = [];
  const latestByObject = new Map<string, SealedObject>();
  for (const obj of resp.objects) {
    const previous = latestByObject.get(obj.id);
    if (!previous || obj.revision > previous.revision) {
      latestByObject.set(obj.id, obj);
    }
  }
  // Check what was served against what a device signed for, before decrypting any
  // of it. A failure here means an object was withheld, rolled back or
  // substituted, and must not be presented as an empty or partial vault.
  if (manifest) {
    await verifyManifest(session, manifest, [...latestByObject.values()].map(entryFor));
  } else if (session.manifestSeq > 0) {
    throw new ManifestError(
      "The server served this vault with no manifest, but this device has seen one. Refusing to continue.",
    );
  }
  for (const obj of latestByObject.values()) {
    let raw: string;
    let contentType = obj.content_type;
    let tombstone = obj.tombstone;
    try {
      const decrypted = decryptContact(collectionKey, obj.id, state.collection_id, obj.nonce, obj.ciphertext, obj.padded_size);
      const envelope = JSON.parse(decrypted) as Partial<SealedPayload>;
      if (envelope.version === 1) {
        if (typeof envelope.payload !== "string" || typeof envelope.contentType !== "string" || typeof envelope.tombstone !== "boolean") continue;
        raw = envelope.payload;
        contentType = envelope.contentType;
        tombstone = envelope.tombstone;
      } else {
        raw = decrypted;
      }
    } catch {
      continue;
    }
    if (tombstone) continue;
    try {
      sealed.push(obj);
      if (contentType === CALENDAR_EVENT_CONTENT_TYPE || isCalendarEventPayload(raw)) {
        const value = JSON.parse(raw) as { title?: string; start?: string; end?: string; notes?: string; location?: string; participants?: string[]; timezone?: string; calendarId?: string; recurrence?: CalendarEvent["recurrence"] };
        calendarEvents.push({ id: obj.id, title: value.title?.trim() || "Untitled event", start: value.start ?? "", end: value.end, notes: value.notes, location: value.location, participants: value.participants, timezone: value.timezone, calendarId: value.calendarId, recurrence: value.recurrence });
      } else if (contentType === CALENDAR_CONTENT_TYPE || isCalendarPayload(raw)) {
        const value = JSON.parse(raw) as { name?: string; color?: string; favorite?: boolean };
        calendars.push({ id: obj.id, name: value.name?.trim() || "Untitled calendar", color: value.color || DEFAULT_CALENDAR_COLOR, favorite: value.favorite === true });
      } else if (contentType === ADDRESS_BOOK_CONTENT_TYPE || isAddressBookPayload(raw)) {
        addressBooks.push(parseAddressBook(obj.id, raw));
      } else if (contentType === NOTE_CONTENT_TYPE || isPayloadOfType(raw, "Note")) {
        notes.push(parseNote(obj.id, raw));
      } else if (contentType === NOTEBOOK_CONTENT_TYPE || isPayloadOfType(raw, "Notebook")) {
        notebooks.push(parseNotebook(obj.id, raw));
      } else if (isContactPayload(raw)) {
        contacts.push(parseContact(obj.id, raw, obj.ciphertext, obj.padded_size));
      } else {
        // Not a shape this build knows. Skipping it is the only safe answer: the
        // old behaviour of falling through to a contact turned any newer content
        // type into a blank contact whose edit or delete destroyed the original.
        sealed.pop();
      }
    } catch {
      sealed.pop();
    }
  }
  return {
    sealed,
    addressBooks: sortAddressBooks(addressBooks),
    contacts: sortContacts(contacts),
    calendars,
    calendarEvents,
    notes: sortNotes(notes),
    notebooks: sortNotebooks(notebooks),
  };
}

export async function ensureDefaultAddressBook(
  session: Session,
  books: AddressBook[],
): Promise<AddressBook[]> {
  if (books.some((book) => book.id === DEFAULT_ADDRESS_BOOK_ID)) {
    return sortAddressBooks(books);
  }
  await putAddressBook(session, DEFAULT_ADDRESS_BOOK_NAME, DEFAULT_ADDRESS_BOOK_ID);
  return sortAddressBooks([
    {
      id: DEFAULT_ADDRESS_BOOK_ID,
      name: DEFAULT_ADDRESS_BOOK_NAME,
      raw: serializeAddressBook(DEFAULT_ADDRESS_BOOK_NAME),
    },
    ...books,
  ]);
}

export async function putAddressBook(
  session: Session,
  name: string,
  id = newUuid(),
): Promise<string> {
  const plaintext = serializeAddressBook(name);
  await putSealed(session, id, ADDRESS_BOOK_CONTENT_TYPE, false, plaintext);
  return id;
}

export async function deleteAddressBook(
  session: Session,
  id: string,
): Promise<void> {
  await putSealed(session, id, ADDRESS_BOOK_CONTENT_TYPE, true, "");
}

export async function putContact(
  session: Session,
  draft: ContactDraft,
  existingId?: string,
): Promise<string> {
  const id = existingId ?? newUuid();
  const plaintext = serializeCard(draft);
  await putSealed(session, id, JSCONTACT_CONTENT_TYPE, false, plaintext);
  return id;
}

export async function deleteContact(
  session: Session,
  id: string,
): Promise<void> {
  await putSealed(session, id, JSCONTACT_CONTENT_TYPE, true, "");
}

export async function putCalendarEvent(session: Session, event: Omit<CalendarEvent, "id">, existingId?: string): Promise<string> {
  const id = existingId ?? newUuid();
  const plaintext = JSON.stringify({ "@type": "CalendarEvent", version: "1.0", ...event });
  await putSealed(session, id, CALENDAR_EVENT_CONTENT_TYPE, false, plaintext);
  return id;
}

export async function putCalendar(session: Session, calendar: Omit<Calendar, "id">, existingId?: string): Promise<string> {
  const id = existingId ?? newUuid();
  const plaintext = JSON.stringify({ "@type": "Calendar", version: "1.0", ...calendar });
  await putSealed(session, id, CALENDAR_CONTENT_TYPE, false, plaintext);
  return id;
}

export async function deleteCalendarEvent(session: Session, id: string): Promise<void> {
  await putSealed(session, id, CALENDAR_EVENT_CONTENT_TYPE, true, "");
}

export async function deleteCalendar(session: Session, id: string): Promise<void> {
  await putSealed(session, id, CALENDAR_CONTENT_TYPE, true, "");
}

export async function putNote(
  session: Session,
  draft: NoteDraft,
  existingId?: string,
): Promise<string> {
  const id = existingId ?? newUuid();
  await putSealed(session, id, NOTE_CONTENT_TYPE, false, serializeNote(draft));
  return id;
}

export async function deleteNote(session: Session, id: string): Promise<void> {
  await putSealed(session, id, NOTE_CONTENT_TYPE, true, "");
}

export async function putNotebook(
  session: Session,
  name: string,
  existingId?: string,
): Promise<string> {
  const id = existingId ?? newUuid();
  await putSealed(session, id, NOTEBOOK_CONTENT_TYPE, false, serializeNotebook(name));
  return id;
}

export async function deleteNotebook(session: Session, id: string): Promise<void> {
  await putSealed(session, id, NOTEBOOK_CONTENT_TYPE, true, "");
}

/**
 * Returns the notebook list with the default one present, creating it if needed.
 *
 * Unlike `ensureDefaultAddressBook` this is called when the Notes tab is first
 * opened rather than on every vault refresh. A write here can fail (quota, rate
 * limit, an older server), and on the refresh path that failure would stop the
 * whole vault loading, contacts included.
 */
export async function ensureDefaultNotebook(
  session: Session,
  notebooks: Notebook[],
): Promise<Notebook[]> {
  if (notebooks.some((notebook) => notebook.id === DEFAULT_NOTEBOOK_ID)) {
    return sortNotebooks(notebooks);
  }
  await putNotebook(session, DEFAULT_NOTEBOOK_NAME, DEFAULT_NOTEBOOK_ID);
  return sortNotebooks([
    {
      id: DEFAULT_NOTEBOOK_ID,
      name: DEFAULT_NOTEBOOK_NAME,
      raw: serializeNotebook(DEFAULT_NOTEBOOK_NAME),
    },
    ...notebooks,
  ]);
}


function isAddressBookPayload(raw: string): boolean {
  return isPayloadOfType(raw, "AddressBook");
}

function isPayloadOfType(raw: string, type: string): boolean {
  try {
    return (JSON.parse(raw) as { "@type"?: string })["@type"] === type;
  } catch {
    return false;
  }
}

/**
 * A `Card`, or the untagged legacy shape that predates `@type`. Anything else is
 * not a contact, which is what keeps a future content type from being rendered,
 * and then overwritten, as one.
 */
function isContactPayload(raw: string): boolean {
  try {
    const body = JSON.parse(raw) as { "@type"?: string; name?: unknown };
    if (typeof body["@type"] === "string") return body["@type"] === "Card";
    return typeof body.name === "object" && body.name !== null;
  } catch {
    return false;
  }
}

function isCalendarEventPayload(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { "@type"?: string })["@type"] === "CalendarEvent";
  } catch {
    return false;
  }
}

function isCalendarPayload(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { "@type"?: string })["@type"] === "Calendar";
  } catch {
    return false;
  }
}

/**
 * Asks for a nonce to sign an account mutation over.
 *
 * Account changes are authorised by a device signature, not by how recently the
 * session was created: a bearer token alone must not be able to rename the
 * account, replace its password verifier or delete it.
 */
async function accountChallenge(
  session: Session,
): Promise<{ challenge_id: string; challenge: string }> {
  return postJson<{ challenge_id: string; challenge: string }>(
    `${apiRoot(session.state.server)}/v1/account/challenge`,
    {},
    session.token,
  );
}

export async function changeUsername(
  session: Session,
  newUsername: string,
  currentPassword: string,
): Promise<Session> {
  const freshSession = await loginAccount(session.state, currentPassword);
  const root = apiRoot(session.state.server);
  const start = opaqueRegisterStart(currentPassword);
  const startRes = await postJson<{ response: string }>(
    `${root}/v1/opaque/register/start`,
    {
      username: newUsername,
      request: start.request,
    },
  );
  const upload = opaqueRegisterFinish(
    start.state,
    currentPassword,
    startRes.response,
  );
  const challenge = await accountChallenge(freshSession);
  await postJson<{ status: string }>(
    `${root}/v1/account/username`,
    {
      new_username: newUsername,
      upload,
      challenge_id: challenge.challenge_id,
      challenge: challenge.challenge,
      signature: accountOpSign(
        bytesFromJson(freshSession.state.mldsa_seed),
        bytesFromJson(freshSession.state.ed25519_sk),
        "username",
        challenge.challenge_id,
        challenge.challenge,
        freshSession.state.account_id,
        freshSession.state.device_id,
        { new_username: newUsername, upload },
      ),
    },
    freshSession.token,
  );
  const updatedState = { ...freshSession.state, username: newUsername };
  return loginAccount(updatedState, currentPassword);
}

export async function changePassword(
  session: Session,
  currentPassword: string,
  newPassword: string,
): Promise<Session> {
  const freshSession = await loginAccount(session.state, currentPassword);
  const root = apiRoot(freshSession.state.server);
  const start = opaqueRegisterStart(newPassword);
  const startRes = await postJson<{
    password_change_id: string;
    response: string;
    challenge: string;
  }>(
    `${root}/v1/account/password/start`,
    {
      request: start.request,
    },
    freshSession.token,
  );
  const upload = opaqueRegisterFinish(
    start.state,
    newPassword,
    startRes.response,
  );
  const wrap = wrapCkForPassword(freshSession.collectionKey, newPassword);
  // The signature covers the replacement recovery wrap as well as the new
  // verifier, so nobody holding only a token can swap in key material the account
  // holder never produced and quietly destroy password-based recovery.
  await postJson<{ status: string }>(
    `${root}/v1/account/password`,
    {
      password_change_id: startRes.password_change_id,
      challenge: startRes.challenge,
      signature: accountOpSign(
        bytesFromJson(freshSession.state.mldsa_seed),
        bytesFromJson(freshSession.state.ed25519_sk),
        "password",
        startRes.password_change_id,
        startRes.challenge,
        freshSession.state.account_id,
        freshSession.state.device_id,
        {
          upload,
          kdf_salt: wrap.kdf_salt,
          recovery_nonce: wrap.recovery_nonce,
          recovery_wrapped_ck: wrap.recovery_wrapped_ck,
          recovery_ciphersuite: wrap.recovery_ciphersuite,
        },
      ),
      upload,
      kdf_salt: wrap.kdf_salt,
      recovery_nonce: wrap.recovery_nonce,
      recovery_wrapped_ck: wrap.recovery_wrapped_ck,
      recovery_ciphersuite: wrap.recovery_ciphersuite,
    },
    freshSession.token,
  );
  const updatedState = { ...freshSession.state, kdf_salt: wrap.kdf_salt };
  return loginAccount(updatedState, newPassword);
}

/**
 * Issues a new recovery phrase, rotating the vault key onto it.
 *
 * Replacing the phrase without rotating would leave anyone who has ever seen the
 * old one still able to decrypt, because the key their wrap opens would not have
 * changed. Needs the password, since the new key must be re-wrapped for it.
 */
export async function rotatePhrase(
  session: Session,
  password: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ session: Session; phrase: string }> {
  return rotateVault(session, null, password, onProgress);
}

export async function deleteAccount(session: Session, currentPassword: string): Promise<void> {
  const freshSession = await loginAccount(session.state, currentPassword);
  const root = apiRoot(freshSession.state.server);
  const challenge = await accountChallenge(freshSession);
  await deleteJson<{ status: string }>(`${root}/v1/account`, freshSession.token, {
    challenge_id: challenge.challenge_id,
    challenge: challenge.challenge,
    signature: accountOpSign(
      bytesFromJson(freshSession.state.mldsa_seed),
      bytesFromJson(freshSession.state.ed25519_sk),
      "delete",
      challenge.challenge_id,
      challenge.challenge,
      freshSession.state.account_id,
      freshSession.state.device_id,
      {},
    ),
  });
}

export type DeviceSummary = {
  device_id: string;
  mldsa_pk: string;
  ed25519_pk: string;
  xwing_hpke_pk: string;
};

export async function listDevices(session: Session): Promise<DeviceSummary[]> {
  return getJson<DeviceSummary[]>(
    `${apiRoot(session.state.server)}/v1/account/devices`,
    session.token,
  );
}

/**
 * Revokes another device and rotates the vault key away from it.
 *
 * Removing a device is not enough on its own: it still holds the collection key
 * and any copy of the ciphertext it kept. So the key is replaced, every object
 * is re-encrypted under the new one, and the new key is wrapped afresh for each
 * device that keeps access. The old recovery phrase was wrapped to the old key,
 * so a new phrase is issued in the same operation and returned here — the
 * caller must show it to the user, because the previous one stops working.
 *
 * `onProgress` reports re-encryption progress; a large vault takes a while.
 */
export async function revokeDevice(
  session: Session,
  deviceId: string,
  password: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ session: Session; phrase: string }> {
  if (deviceId === session.state.device_id) {
    throw new Error("You cannot revoke the device you are signed in on.");
  }
  return rotateVault(session, deviceId, password, onProgress);
}

/**
 * Replaces the vault key and re-encrypts everything under it.
 *
 * One path for every operation that has to invalidate the old key, because they
 * all need the same work: revoking a device that already holds it, changing the
 * recovery phrase, and finishing a recovery — where the phrase just used, and any
 * copy of it someone else kept, must stop being able to decrypt.
 *
 * Returns the replacement recovery phrase. The caller must show it to the user:
 * the previous one no longer works, and no client holds it to re-wrap.
 */
export async function rotateVault(
  session: Session,
  revokeDeviceId: string | null,
  password: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ session: Session; phrase: string }> {
  // The server requires a recently authenticated session, and re-asking for the
  // password is what proves intent for a destructive change.
  const fresh = await loginAccount(session.state, password);
  rememberManifestSeq(fresh, session.manifestSeq);
  const root = apiRoot(fresh.state.server);
  const collectionId = fresh.state.collection_id;

  const { seq, latestRevision } = await manifestState(fresh);
  const listed = await getJson<{
    latest_revision: number;
    key_epoch: number;
    objects: SealedObject[];
    has_more: boolean;
  }>(`${root}/v1/collections/${collectionId}/changes?after=0&limit=2000`, fresh.token);
  if (listed.has_more) {
    throw new Error(
      "This vault is too large to rotate in one request. Rotation cannot yet be split across " +
        "requests, so it has to be done from a client that can send the whole vault at once.",
    );
  }

  // Only the newest revision of each object is carried across.
  const latestByObject = new Map<string, SealedObject>();
  for (const object of listed.objects) {
    const previous = latestByObject.get(object.id);
    if (!previous || object.revision > previous.revision) {
      latestByObject.set(object.id, object);
    }
  }
  // `manifestState` verified the collection above, so what is re-encrypted below
  // is what a device signed for rather than whatever the server chose to serve.
  const devices = await listDevices(fresh);
  if (revokeDeviceId && !devices.some((device) => device.device_id === revokeDeviceId)) {
    throw new Error("That device has already been removed.");
  }
  const remaining = devices.filter((device) => device.device_id !== revokeDeviceId);

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

  const total = latestByObject.size;
  // Rotation assigns consecutive revisions from the collection's next one, and the
  // manifest commits to each of them.
  const firstRevision = latestRevision + 1;
  const objects: RotatedObject[] = [];
  let done = 0;
  for (const object of latestByObject.values()) {
    // Decrypt under the old key and immediately re-seal under the new one. The
    // stored envelope is re-encrypted verbatim, so nothing inside it changes.
    const plaintext = decryptContact(
      fresh.collectionKey,
      object.id,
      collectionId,
      object.nonce,
      object.ciphertext,
      object.padded_size,
    );
    const sealed = encryptContact(newCk, object.id, collectionId, plaintext);
    objects.push({
      id: object.id,
      revision: firstRevision + objects.length,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
      padded_size: sealed.padded_size,
      content_type: object.content_type,
      tombstone: object.tombstone,
    });
    done += 1;
    onProgress?.(done, total);
  }

  const keyEpoch = listed.key_epoch + 1;
  const manifest = manifestSign(
    bytesFromJson(fresh.state.mldsa_seed),
    bytesFromJson(fresh.state.ed25519_sk),
    collectionId,
    fresh.state.device_id,
    seq + 1,
    keyEpoch,
    firstRevision + objects.length - 1,
    objects.map(entryFor),
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
    },
    fresh.token,
  );

  rememberManifestSeq(fresh, seq + 1);
  fresh.collectionKey = newCk;
  fresh.keyEpoch = response.key_epoch;
  fresh.latestRevision = response.latest_revision;
  fresh.state = { ...fresh.state, kdf_salt: passwordWrap.kdf_salt };
  return { session: fresh, phrase: phraseOut.phrase };
}
