import { b64ToByteArray, bytesFromJson } from "./bytes";
import {
  accountOpSign,
  createDevice,
  createEnrollment,
  decryptContact,
  encryptContact,
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
  generateNewPhrase,
  type AccountOp,
} from "./wasm";
import { parseContact, serializeCard, sortContacts } from "./contact";
import {
  ADDRESS_BOOK_CONTENT_TYPE,
  DEFAULT_ADDRESS_BOOK_ID,
  DEFAULT_ADDRESS_BOOK_NAME,
  JSCONTACT_CONTENT_TYPE,
  parseAddressBook,
  serializeAddressBook,
  sortAddressBooks,
} from "./addressBook";
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
  RotatedObject,
  SealedObject,
} from "./types";

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
  /** The epoch `collectionKey` belongs to; a newer one on the server means a rotation. */
  keyEpoch?: number;
  offline?: boolean;
};

/** The server served something no enrolled device signed for. Never transient. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

function signingKeys(state: DeviceState): { mldsaSeed: string; ed25519Sk: string } {
  return {
    mldsaSeed: bytesFromJson(state.mldsa_seed),
    ed25519Sk: bytesFromJson(state.ed25519_sk),
  };
}

function collectionUrl(session: Session, path: string): string {
  return `${apiRoot(session.state.server)}/v1/collections/${session.state.collection_id}/${path}`;
}

export async function listDevices(session: Session): Promise<DevicePublic[]> {
  return getJson<DevicePublic[]>(`${apiRoot(session.state.server)}/v1/account/devices`, session.token);
}

type ObjectChange = SealedObject;

function entryOf(object: ObjectChange): ManifestEntry {
  return {
    id: object.id,
    revision: object.revision,
    tombstone: object.tombstone,
    content_digest: objectContentDigest(object.nonce, object.ciphertext),
  };
}

/**
 * Checks a served manifest against the entries it should describe: the object
 * count, the digest, the signature of an enrolled device, and that the sequence
 * has not gone backwards from what this device has already seen.
 */
function verifyManifest(
  session: Session,
  manifest: ManifestBody,
  entries: ManifestEntry[],
  devices: DevicePublic[],
): void {
  if (manifest.object_count !== entries.length) {
    throw new ManifestError(
      `Server sent ${entries.length} objects but the manifest commits to ${manifest.object_count}.`,
    );
  }
  const signer = devices.find((device) => device.device_id === manifest.device_id);
  if (!signer) {
    throw new ManifestError("Manifest signed by a device this account does not have.");
  }
  try {
    manifestVerify(signer.mldsa_pk, signer.ed25519_pk, session.state.collection_id, manifest, entries);
  } catch (err) {
    throw new ManifestError(err instanceof Error ? err.message : String(err));
  }
  const seen = session.state.manifest_seq ?? 0;
  if (manifest.manifest_seq < seen) {
    throw new ManifestError(
      `Manifest went backwards: this device has seen sequence ${seen} but was served ${manifest.manifest_seq}.`,
    );
  }
  session.state.manifest_seq = manifest.manifest_seq;
}

function requireNoManifestYet(session: Session): void {
  const seen = session.state.manifest_seq ?? 0;
  if (seen > 0) {
    throw new ManifestError(
      `Server has no manifest, but this device has seen sequence ${seen}.`,
    );
  }
}

type ManifestState = {
  seq: number;
  keyEpoch: number;
  latestRevision: number;
  entries: ManifestEntry[];
};

/** The collection's verified manifest state, which the next write builds on. */
async function manifestState(session: Session): Promise<ManifestState> {
  const resp = await getJson<{ manifest: ManifestBody | null; entries: ManifestEntry[] }>(
    collectionUrl(session, "manifest"),
    session.token,
  );
  if (resp.manifest) {
    verifyManifest(session, resp.manifest, resp.entries, await listDevices(session));
    return {
      seq: resp.manifest.manifest_seq,
      keyEpoch: resp.manifest.key_epoch,
      latestRevision: resp.manifest.latest_revision,
      entries: resp.entries,
    };
  }
  requireNoManifestYet(session);
  const keys = await getJson<{ key_epoch: number }>(collectionUrl(session, "keys"), session.token);
  return {
    seq: 0,
    keyEpoch: keys.key_epoch,
    latestRevision: resp.entries.reduce((max, entry) => Math.max(max, entry.revision), 0),
    entries: resp.entries,
  };
}

/**
 * Every object in the collection (latest revision of each, tombstones
 * included), checked against the signed manifest. Pages are walked to the end
 * first, because the manifest commits to the whole collection, not a page.
 */
async function fetchVerifiedObjects(
  session: Session,
): Promise<{ objects: ObjectChange[]; latestRevision: number; keyEpoch: number }> {
  const all: ObjectChange[] = [];
  let after = 0;
  let manifest: ManifestBody | null = null;
  let latestRevision = 0;
  let keyEpoch = 0;
  for (;;) {
    const page = await getJson<{
      latest_revision: number;
      key_epoch: number;
      objects: ObjectChange[];
      has_more: boolean;
      manifest: ManifestBody | null;
    }>(collectionUrl(session, `changes?after=${after}&limit=500`), session.token);
    manifest = page.manifest;
    latestRevision = page.latest_revision;
    keyEpoch = page.key_epoch;
    all.push(...page.objects);
    const high = page.objects.reduce((max, object) => Math.max(max, object.revision), 0);
    if (!page.has_more || high <= after) break;
    after = high;
  }
  const latest = new Map<string, ObjectChange>();
  for (const object of all) {
    const previous = latest.get(object.id);
    if (!previous || object.revision > previous.revision) {
      latest.set(object.id, object);
    }
  }
  const objects = [...latest.values()];
  if (manifest) {
    verifyManifest(session, manifest, objects.map(entryOf), await listDevices(session));
  } else {
    requireNoManifestYet(session);
  }
  return { objects, latestRevision, keyEpoch };
}

/** Re-fetches this device's collection-key wrap after another device rotated. */
async function refreshCollectionKey(session: Session): Promise<void> {
  const resp = await getJson<{ key_epoch: number; key_wraps: KeyWrap[] }>(
    collectionUrl(session, "keys"),
    session.token,
  );
  // Only the device wrap is needed, so no password.
  session.collectionKey = unwrapCk(
    "",
    "",
    bytesFromJson(session.state.hpke_sk),
    session.state.device_id,
    JSON.stringify(resp.key_wraps.filter((wrap) => wrap.recipient_kind === "device")),
  );
  session.keyEpoch = resp.key_epoch;
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

async function putSealed(
  session: Session,
  id: string,
  contentType: string,
  tombstone: boolean,
  payload: string,
): Promise<number> {
  const current = await manifestState(session);
  if (session.keyEpoch !== undefined && current.keyEpoch !== session.keyEpoch) {
    await refreshCollectionKey(session);
  }
  const revision = current.latestRevision + 1;
  const sealed = sealPayload(session, id, contentType, tombstone, payload, revision);
  const entry: ManifestEntry = {
    id,
    revision,
    tombstone,
    content_digest: objectContentDigest(sealed.encrypted.nonce, sealed.encrypted.ciphertext),
  };
  const entries = current.entries.filter((existing) => existing.id !== id);
  entries.push(entry);
  const { mldsaSeed, ed25519Sk } = signingKeys(session.state);
  const manifest = manifestSign(
    mldsaSeed,
    ed25519Sk,
    session.state.collection_id,
    session.state.device_id,
    current.seq + 1,
    current.keyEpoch,
    revision,
    entries,
  );
  const response = await putJson<{ revision: number }>(
    collectionUrl(session, "objects"),
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
  session.state.manifest_seq = manifest.manifest_seq;
  return response.revision;
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
  const start = opaqueRegisterStart(password);
  const started = await postJson<{ response: string }>(`${root}/v1/opaque/register/start`, {
    username,
    request: start.request,
  });
  const upload = opaqueRegisterFinish(start.state, password, started.response);
  const enrollment = createEnrollment(password);
  // Chosen here rather than by the server so the empty collection's manifest
  // can be signed before the account exists.
  const collectionId = newUuid();
  const manifest = manifestSign(
    enrollment.mldsa_seed,
    enrollment.ed25519_sk,
    collectionId,
    enrollment.device_id,
    1,
    1,
    0,
    [],
  );
  const finished = await postJson<{ account_id: string; collection_id: string }>(
    `${root}/v1/opaque/register/finish`,
    {
      username,
      upload,
      kdf_salt: enrollment.kdf_salt,
      collection_id: collectionId,
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
      manifest,
    },
  );
  const state = deviceFromEnrollment(
    root,
    username,
    finished.account_id,
    finished.collection_id,
    enrollment,
  );
  state.manifest_seq = manifest.manifest_seq;
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
  if (preview.confirm !== confirm || confirmation.trim() !== confirm) {
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

export async function recoverAccount(
  server: string,
  username: string,
  phrase: string,
  password: string,
): Promise<RotationResult> {
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
  // The phrase just used would otherwise keep working, for anyone else holding a
  // copy of it too, because enrolling a device does not change the key it
  // unwraps. Rotating issues a fresh phrase and retires the old one.
  return rotateCollectionKey(await loginAccount(state, password), password);
}

export async function loginAccount(
  state: DeviceState,
  password: string,
): Promise<Session> {
  const root = apiRoot(state.server);
  const hpkeSk = bytesFromJson(state.hpke_sk);
  const mldsaSeed = bytesFromJson(state.mldsa_seed);
  const ed25519Sk = bytesFromJson(state.ed25519_sk);
  // Step 1: a challenge sealed to this device's X-Wing key.
  const sealed = await postJson<{
    challenge_id: string;
    challenge_enc: string;
    challenge_ct: string;
  }>(`${root}/v1/opaque/login/challenge`, {
    username: state.username,
    device_id: state.device_id,
  });
  // Step 2: prove device possession before the server releases an OPAQUE
  // credential response.
  const start = opaqueLoginStart(password);
  const startProof = loginStartProof(
    hpkeSk,
    sealed.challenge_enc,
    sealed.challenge_ct,
    sealed.challenge_id,
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
    challenge_id: sealed.challenge_id,
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
    keyEpoch: finished.key_epoch,
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

export async function listVault(
  session: Session,
): Promise<{ sealed: SealedObject[]; addressBooks: AddressBook[]; contacts: Contact[]; calendars: Calendar[]; calendarEvents: CalendarEvent[] }> {
  const fetched = await fetchVerifiedObjects(session);
  session.latestRevision = fetched.latestRevision;
  if (session.keyEpoch === undefined || fetched.keyEpoch !== session.keyEpoch) {
    await refreshCollectionKey(session);
  }
  const { state, collectionKey } = session;
  const sealed: SealedObject[] = [];
  const addressBooks: AddressBook[] = [];
  const contacts: Contact[] = [];
  const calendarEvents: CalendarEvent[] = [];
  const calendars: Calendar[] = [];
  for (const obj of fetched.objects) {
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
        calendars.push({ id: obj.id, name: value.name?.trim() || "Untitled calendar", color: value.color || "#7aa2f7", favorite: value.favorite === true });
      } else if (contentType === ADDRESS_BOOK_CONTENT_TYPE || isAddressBookPayload(raw)) {
        addressBooks.push(parseAddressBook(obj.id, raw));
      } else {
        contacts.push(parseContact(obj.id, raw, obj.ciphertext, obj.padded_size));
      }
    } catch {
      sealed.pop();
    }
  }
  return { sealed, addressBooks: sortAddressBooks(addressBooks), contacts: sortContacts(contacts), calendars, calendarEvents };
}

export async function listContacts(session: Session): Promise<{ sealed: SealedObject[]; open: Contact[] }> {
  const listed = await listVault(session);
  return { sealed: listed.sealed, open: listed.contacts };
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


function isAddressBookPayload(raw: string): boolean {
  try {
    const body = JSON.parse(raw) as { "@type"?: string };
    return body["@type"] === "AddressBook";
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
 * Signs an account mutation. A bearer token alone cannot change or delete an
 * account; the server wants a device signature over its own challenge too.
 */
function signAccountOp(
  session: Session,
  op: AccountOp,
  challengeId: string,
  challenge: string,
  payload: object,
) {
  const { mldsaSeed, ed25519Sk } = signingKeys(session.state);
  return accountOpSign(
    mldsaSeed,
    ed25519Sk,
    op,
    challengeId,
    challenge,
    session.state.account_id,
    session.state.device_id,
    payload,
  );
}

async function accountChallenge(
  session: Session,
): Promise<{ challenge_id: string; challenge: string }> {
  return postJson(`${apiRoot(session.state.server)}/v1/account/challenge`, {}, session.token);
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
      signature: signAccountOp(freshSession, "username", challenge.challenge_id, challenge.challenge, {
        new_username: newUsername,
        upload,
      }),
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
  const startRes = await postJson<{ password_change_id: string; response: string; challenge: string }>(
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
  const payload = {
    upload,
    kdf_salt: wrap.kdf_salt,
    recovery_nonce: wrap.recovery_nonce,
    recovery_wrapped_ck: wrap.recovery_wrapped_ck,
    recovery_ciphersuite: wrap.recovery_ciphersuite,
  };
  await postJson<{ status: string }>(
    `${root}/v1/account/password`,
    {
      password_change_id: startRes.password_change_id,
      // The start response's challenge doubles as the account-op challenge.
      challenge: startRes.challenge,
      signature: signAccountOp(
        freshSession,
        "password",
        startRes.password_change_id,
        startRes.challenge,
        payload,
      ),
      ...payload,
    },
    freshSession.token,
  );
  const updatedState = { ...freshSession.state, kdf_salt: wrap.kdf_salt };
  return loginAccount(updatedState, newPassword);
}

export type RotationResult = {
  session: Session;
  /** The new recovery phrase. The previous one no longer opens anything. */
  phrase: string;
};

/**
 * Replaces the collection key and re-encrypts the vault under it: the one path
 * for everything that has to invalidate the old key (a phrase change, a
 * completed recovery, revoking a device). Every remaining device, the password
 * and a fresh phrase get a wrap of the new key; the old phrase cannot be
 * re-wrapped because no client holds it.
 */
export async function rotateCollectionKey(
  session: Session,
  password: string,
  revokeDeviceId?: string,
): Promise<RotationResult> {
  const { state } = session;
  if (revokeDeviceId === state.device_id) {
    throw new Error("You cannot revoke the device you are signed in on.");
  }
  // Read everything under the current key before replacing it.
  const fetched = await fetchVerifiedObjects(session);
  if (session.keyEpoch === undefined || fetched.keyEpoch !== session.keyEpoch) {
    await refreshCollectionKey(session);
  }
  const live = fetched.objects.filter((object) => !object.tombstone);
  const stored = live.map((object) => ({
    object,
    plaintext: decryptContact(
      session.collectionKey,
      object.id,
      state.collection_id,
      object.nonce,
      object.ciphertext,
      object.padded_size,
    ),
  }));
  const current = await manifestState(session);
  const remaining = (await listDevices(session)).filter(
    (device) => device.device_id !== revokeDeviceId,
  );
  if (remaining.length === 0) {
    throw new Error("You cannot revoke the last device.");
  }
  if (!remaining.some((device) => device.device_id === state.device_id)) {
    throw new Error("This device is not enrolled.");
  }

  const newCk = newCollectionKey();
  const passwordWrap = wrapCkForPassword(newCk, password);
  const phraseOut = generateNewPhrase(newCk);
  const keyWraps: KeyWrap[] = remaining.map((device) => {
    const wrap = wrapCkForDevice(newCk, device.xwing_hpke_pk);
    return {
      recipient_kind: "device",
      recipient_id: device.device_id,
      hpke_enc: wrap.enc,
      wrapped_ck: wrap.wrapped_ck,
      ciphersuite: wrap.ciphersuite,
    };
  });
  keyWraps.push(
    {
      recipient_kind: "recovery",
      recipient_id: state.username,
      hpke_enc: passwordWrap.recovery_nonce,
      wrapped_ck: passwordWrap.recovery_wrapped_ck,
      ciphersuite: passwordWrap.recovery_ciphersuite,
    },
    {
      recipient_kind: "phrase",
      recipient_id: state.username,
      hpke_enc: phraseOut.phrase_nonce,
      wrapped_ck: phraseOut.phrase_wrapped_ck,
      ciphersuite: phraseOut.phrase_ciphersuite,
    },
  );

  // Rotation assigns consecutive revisions from the collection's next one.
  const firstRevision = current.latestRevision + 1;
  const objects: RotatedObject[] = stored.map(({ object, plaintext }, index) => {
    const encrypted = encryptContact(newCk, object.id, state.collection_id, plaintext);
    return {
      id: object.id,
      revision: firstRevision + index,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      padded_size: encrypted.padded_size,
      content_type: object.content_type,
      tombstone: false,
    };
  });
  const keyEpoch = current.keyEpoch + 1;
  const { mldsaSeed, ed25519Sk } = signingKeys(state);
  const manifest = manifestSign(
    mldsaSeed,
    ed25519Sk,
    state.collection_id,
    state.device_id,
    current.seq + 1,
    keyEpoch,
    firstRevision + objects.length - 1,
    objects.map(entryOf),
  );
  const rotationSignature = rotationSign(
    mldsaSeed,
    ed25519Sk,
    state.collection_id,
    revokeDeviceId ?? "",
    keyEpoch,
    keyWraps,
    objects,
    manifest.digest,
  );
  const response = await postJson<{ key_epoch: number; latest_revision: number }>(
    collectionUrl(session, "rotate"),
    {
      key_epoch: keyEpoch,
      revoke_device_id: revokeDeviceId ?? null,
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
    session.token,
  );
  return {
    phrase: phraseOut.phrase,
    session: {
      ...session,
      collectionKey: newCk,
      keyEpoch: response.key_epoch,
      latestRevision: response.latest_revision,
      state: {
        ...state,
        kdf_salt: b64ToByteArray(passwordWrap.kdf_salt),
        manifest_seq: manifest.manifest_seq,
      },
    },
  };
}

/** Issues a new recovery phrase, rotating the collection key so the old phrase stops working. */
export async function rotatePhrase(session: Session, password: string): Promise<RotationResult> {
  // Signing in first proves the password: the rotation wraps the new key under
  // it, and a typo would silently break password recovery.
  return rotateCollectionKey(await loginAccount(session.state, password), password);
}

export async function deleteAccount(session: Session, currentPassword: string): Promise<void> {
  const freshSession = await loginAccount(session.state, currentPassword);
  const root = apiRoot(freshSession.state.server);
  const challenge = await accountChallenge(freshSession);
  await deleteJson<{ status: string }>(`${root}/v1/account`, freshSession.token, {
    challenge_id: challenge.challenge_id,
    challenge: challenge.challenge,
    signature: signAccountOp(freshSession, "delete", challenge.challenge_id, challenge.challenge, {}),
  });
}

