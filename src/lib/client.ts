import { b64ToByteArray, bytesFromJson } from "./bytes";
import {
  accountOpSign,
  createDevice,
  createEnrollment,
  generateNewPhrase,
  loginStartProof,
  manifestSign,
  manifestVerify,
  newCollectionKey,
  newUuid,
  objectContentDigest,
  openObject,
  opaqueLoginFinish,
  opaqueLoginStart,
  opaqueRegisterFinish,
  opaqueRegisterStart,
  pairConfirmationCode,
  pairGrantSign,
  phraseLookupId,
  phraseRecovery,
  phraseRecoveryProof,
  resealObject,
  rosterSealDevice,
  rosterSealPhrase,
  rosterVerify,
  rotationSign,
  sealedContentType,
  sealObject,
  unwrapCk,
  unwrapPhrase,
  wrapCkForDevice,
  wrapCkForPassword,
} from "./wasm";
import {
  contactFitsObjectLimit,
  parseContact,
  serializeCard,
  sortContacts,
} from "./contact";
import {
  ACCOUNT_SETTINGS_CONTENT_TYPE,
  ACCOUNT_SETTINGS_ID,
  DEFAULT_ACCOUNT_SETTINGS,
  LEGACY_ACCOUNT_SETTINGS_ID,
  parseAccountSettings,
  serializeAccountSettings,
} from "./accountSettings";
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
  DEFAULT_CALENDAR_ID,
  DEFAULT_CALENDAR_NAME,
  sortCalendars,
} from "./calendar";
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
import { describeError, elapsed, log, logPath, serverHost } from "./log";
import { mergePayload, PAYLOAD_SCHEMA_VERSION } from "./payload";
import { PROTOCOL_VERSION, speaksProtocol } from "./protocol";
import type {
  AccountSettings,
  AddressBook,
  Calendar,
  CalendarEvent,
  Contact,
  ContactDraft,
  DeviceOut,
  DevicePublic,
  DeviceState,
  Enrollment,
  KeyWrap,
  ManifestBody,
  ManifestEntry,
  Note,
  NoteDraft,
  Notebook,
  Roster,
  RosterVerified,
  RotatedObject,
  SealedObject,
} from "./types";
import { DEFAULT_CALENDAR_COLOR } from "./types";

/** Most objects to ask for per `/changes` page; the server clamps above this. */
const CHANGES_PAGE_LIMIT = 500;

export const CALENDAR_EVENT_CONTENT_TYPE = "application/sealbook.calendar-event+json";
export const CALENDAR_CONTENT_TYPE = "application/sealbook.calendar+json";

class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * How long a single call to the server may take before it is abandoned.
 *
 * A server that accepts the connection and then never answers, which is what a
 * suspended machine or a captive portal looks like, would otherwise leave the
 * promise pending for as long as the tab is open: the caller's spinner stays up
 * and there is nothing for the user to act on. Generous enough that no healthy
 * request reaches it, since a `/changes` page is bounded by
 * `CHANGES_PAGE_LIMIT` rows rather than by the size of the vault.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The request never reached a server: wrong address, nothing listening, TLS
 * refused, or the network dropped mid-flight.
 *
 * Named rather than left as the `TypeError` `fetch` rejects with, whose message
 * is "Failed to fetch" in Chrome and "Load failed" in Safari. `friendlyError`
 * matches on the name, so neither wording has to be guessed at there.
 */
export class ServerUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerUnreachableError";
  }
}

/** The connection was accepted but nothing came back inside the timeout. */
export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

function errorMessage(text: string, statusText: string): string {
  try {
    const body = JSON.parse(text) as { error?: string };
    return body.error ?? text;
  } catch {
    return text || statusText;
  }
}

/**
 * Every call to the server, so that one place can time it, bound it, and name
 * it.
 *
 * A rejected `fetch` carries only "Failed to fetch", and a refusal reaches the
 * user through `friendlyError`, which deliberately flattens most messages into
 * a sentence. Neither says which request it was; the console does.
 */
async function request<T>(method: string, url: string, init: RequestInit): Promise<T> {
  const path = logPath(url);
  const started = performance.now();
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  // No caller cancels a request today, but dropping a signal that was passed in
  // would be silent, so the two are merged rather than the timeout winning.
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  // Reached from the body read as well as the request: the timeout can fire
  // while the response is still streaming, which rejects there instead.
  const failure = (err: unknown): Error => {
    if (signal.aborted && !timeout.aborted) {
      // The caller cancelled. Not a fault to report, and not ours to rename.
      return err instanceof Error ? err : new Error(describeError(err));
    }
    log.error(timeout.aborted ? "request timed out" : "request did not reach the server", {
      method,
      path,
      ms: elapsed(started),
      reason: describeError(err),
    });
    return timeout.aborted
      ? new RequestTimeoutError(
          `The server accepted the connection but sent nothing back within ${
            REQUEST_TIMEOUT_MS / 1000
          } seconds.`,
        )
      : new ServerUnreachableError("The server could not be reached.");
  };

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    throw failure(err);
  }
  const ms = elapsed(started);
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw failure(err);
  }
  if (!res.ok) {
    const message = errorMessage(text, res.statusText);
    log.warn("server refused a request", { method, path, status: res.status, ms, reason: message });
    throw new ApiError(message);
  }
  log.debug("request", { method, path, status: res.status, ms, bytes: text.length });
  return JSON.parse(text) as T;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
  // A production build's `connect-src` allows only https and wss, so an http
  // origin fails as an opaque fetch error later. Said here instead, where the
  // scheme is what the user typed. Loopback stays allowed for development.
  if (parsed.protocol === "http:" && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("Connection domain must use https.");
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
  return request<T>("POST", url, { method: "POST", headers, body: JSON.stringify(body) });
}

async function putJson<T>(url: string, body: unknown, token: string): Promise<T> {
  return request<T>("PUT", url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function getJson<T>(url: string, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return request<T>("GET", url, { headers });
}

/**
 * Refuses a server speaking a protocol generation this build does not know.
 *
 * Called before the first exchange that carries real material, so that a
 * version mismatch is reported as itself. Without it the two builds get as far
 * as some field one of them encodes differently, and the failure surfaces as
 * whatever that field happens to be.
 */
async function checkProtocol(root: string): Promise<void> {
  const report = await getJson<{ protocol?: string }>(`${root}/health/crypto`);
  log.info("server reached", {
    host: root ? serverHost(root) : "same-origin",
    server_protocol: report.protocol ?? "unknown",
    app_protocol: PROTOCOL_VERSION,
  });
  if (!speaksProtocol(report.protocol)) {
    throw new Error(
      `This server speaks protocol ${report.protocol ?? "an unknown version"}, ` +
        `and this app speaks ${PROTOCOL_VERSION}. Update whichever is older.`,
    );
  }
}

async function deleteJson<T>(url: string, token: string, body?: unknown): Promise<T> {
  return request<T>("DELETE", url, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  /**
   * The roster this session last verified, with the epoch it was verified at.
   *
   * Checking a manifest signature needs the device set, and fetching it per
   * write was a request per write. It is reused while the epoch matches: a
   * revocation is always a rotation, so the epoch moving is what a device having
   * been removed looks like from here, and a signer the cache does not hold is
   * what a pairing elsewhere looks like. Either refetches.
   */
  roster?: Roster;
  /**
   * True when a recovery enrolled this device and the collection key has still
   * not been rotated, so the phrase used then, and any other copy of it, can
   * still open this vault. The server refuses writes until that rotation
   * happens; `completeRecoveryRotation` is what finishes it.
   */
  recoveryPending?: boolean;
  offline?: boolean;
};

/**
 * How many times a full read restarts when the vault moves during it.
 *
 * Not a `ManifestError` when it runs out: a write between two pages is a race,
 * and reporting it as tampering is both wrong and unactionable.
 */
const MAX_SYNC_RESTARTS = 3;

/** The server served something no enrolled device signed for. Never transient. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/**
 * This device's pin is older than the roster history the server keeps.
 *
 * Deliberately not a `ManifestError`: nothing was forged, the chain back to the
 * pin simply no longer exists. Re-anchoring on whatever is served would give up
 * the rollback protection the pin is for, so the device has to be paired again.
 */
export class RosterTooOldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterTooOldError";
  }
}

/**
 * Runs vault reads and writes one at a time, per collection.
 *
 * A confirmed write advances the manifest high-water mark, while a read already
 * in flight answers from the snapshot it opened before that write committed.
 * Overlapped, the older sequence is indistinguishable from a rollback, so
 * `verifyManifest` reports tampering against a server that did nothing wrong.
 * Keyed by collection, not held on the session, because a rotation signs in
 * again and carries on against a different session object for the same vault.
 */
const vaultQueues = new Map<string, Promise<void>>();

function serializeVault<T>(collectionId: string, run: () => Promise<T>): Promise<T> {
  const queue = vaultQueues.get(collectionId) ?? Promise.resolve();
  const result = queue.then(run);
  // Followers wait for their predecessor to settle, not to succeed: one caller's
  // failure is its own and must not be rethrown into the next.
  vaultQueues.set(
    collectionId,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
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

/**
 * Records the roster this device has accepted, by sequence and transcript.
 *
 * Written through to the device state like the manifest sequence, so closing the
 * app cannot be used to rewind to a roster the user never confirmed. A pin never
 * moves backwards: every roster this device will accept from now on has to be
 * reachable from this one along device-signed steps.
 */
function rememberRosterPin(session: Session, seq: number, transcript: string): void {
  if (seq < (session.state.roster_seq ?? 0)) {
    throw new ManifestError("Refusing to pin an older device roster.");
  }
  session.state.roster_seq = seq;
  session.state.roster_transcript = transcript;
}

/** The pin this device holds, or sequence 0 when it has none yet. */
function rosterPin(state: DeviceState): { seq: number; transcript: string } {
  const seq = state.roster_seq ?? 0;
  const transcript = state.roster_transcript ?? "";
  return seq > 0 && transcript ? { seq, transcript } : { seq: 0, transcript: "" };
}

/**
 * The account's roster history, verified from this device's pin.
 *
 * The server serves every roster from the pinned one on, and each step has to be
 * signed by a member of the one before it, so a lagging pin costs a longer chain
 * to check and never any trust. Returns the newest roster together with the pin
 * to keep in place of the old one.
 */
async function verifiedRosterChain(session: Session): Promise<RosterVerified> {
  const { state, token } = session;
  const pin = rosterPin(state);
  const base = `${apiRoot(state.server)}/v1/collections/${state.collection_id}/roster`;
  const url = pin.seq > 0 ? `${base}?from=${pin.seq}` : base;
  const response = await getJson<{ rosters: Roster[]; floor?: number }>(url, token);
  const floor = response.floor ?? 0;
  if (pin.seq > 0 && floor > pin.seq) {
    log.error("roster history no longer reaches this device's pin", {
      pinned_seq: pin.seq,
      server_floor: floor,
    });
    throw new RosterTooOldError(
      "This device is further behind than the server's device-list history reaches, so the " +
        "chain from the roster it pinned cannot be checked. Pair this device again to anchor " +
        "it on the current list.",
    );
  }
  try {
    const verified = rosterVerify(
      state.collection_id,
      pin.seq,
      pin.transcript,
      response.rosters,
      session.collectionKey,
      session.keyEpoch,
      state.device_id,
    );
    log.info("device roster verified", {
      from_seq: pin.seq,
      to_seq: verified.pin_seq,
      links: response.rosters.length,
      devices: verified.roster.devices.length,
      key_epoch: verified.roster.key_epoch,
    });
    return verified;
  } catch (err) {
    // Not transient: it means the server served a device list no member of the
    // roster this device pinned ever signed for.
    log.error("device roster failed to verify", {
      pinned_seq: pin.seq,
      links: response.rosters.length,
      reason: describeError(err),
    });
    throw new ManifestError(err instanceof Error ? err.message : String(err));
  }
}

/** The account's current roster, verified. Does not move the pin. */
export async function verifiedRoster(session: Session): Promise<Roster> {
  return (await verifiedRosterChain(session)).roster;
}

/** Verifies the current roster, pins it, and caches it on the session. */
export async function syncRoster(session: Session): Promise<Roster> {
  const verified = await verifiedRosterChain(session);
  rememberRosterPin(session, verified.pin_seq, verified.pin_transcript);
  session.roster = verified.roster;
  return verified.roster;
}

/**
 * Pins a roster this device sealed itself, after the server accepted it.
 *
 * Run back through `rosterVerify` rather than trusted directly, because that is
 * what computes the pin, and it is the same check the server applies: a step
 * this device could not verify is one it should not have sent. Only for a roster
 * this device just signed, where the session's collection key and epoch are the
 * ones the roster was MAC'd under by construction. A roster that came from the
 * server is pinned by `syncRoster`, from the chain it was verified in, because
 * this check needs the key of the roster's own epoch and a pinned chain does
 * not.
 */
function pinSealedRoster(session: Session, roster: Roster): void {
  const verified = rosterVerify(
    session.state.collection_id,
    0,
    "",
    [roster],
    session.collectionKey,
    session.keyEpoch,
    session.state.device_id,
  );
  rememberRosterPin(session, verified.pin_seq, verified.pin_transcript);
  session.roster = roster;
}

/**
 * The devices a manifest signature may come from, from the verified roster.
 *
 * Taken from the server's own device list this was its word for which devices
 * exist, which is exactly what the roster exists to replace: a server that could
 * add a device to that list could sign manifests as it.
 */
async function rosterDevices(
  session: Session,
  keyEpoch: number,
  signer: string,
): Promise<DevicePublic[]> {
  const cached = session.roster;
  if (
    cached &&
    cached.key_epoch === keyEpoch &&
    cached.devices.some((device) => device.device_id === signer)
  ) {
    return cached.devices;
  }
  return (await syncRoster(session)).devices;
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
    log.error("vault manifest went backwards", {
      seen_seq: session.manifestSeq,
      served_seq: manifest.manifest_seq,
    });
    throw new ManifestError(
      `The vault went backwards: this device has seen manifest ${session.manifestSeq} but the ` +
        `server served ${manifest.manifest_seq}.`,
    );
  }
  if (manifest.object_count !== entries.length) {
    log.error("vault manifest commits to a different object count", {
      served_objects: entries.length,
      manifest_objects: manifest.object_count,
    });
    throw new ManifestError(
      `Server sent ${entries.length} objects but the manifest commits to ${manifest.object_count}.`,
    );
  }
  const devices = await rosterDevices(session, manifest.key_epoch, manifest.device_id);
  const signer = devices.find((device) => device.device_id === manifest.device_id);
  if (!signer) {
    log.error("vault manifest was signed by a device outside the roster", {
      roster_devices: devices.length,
    });
    throw new ManifestError(
      "The vault manifest was signed by a device that is not in this account's signed roster.",
    );
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
    log.error("vault manifest signature did not verify", {
      seq: manifest.manifest_seq,
      objects: entries.length,
      reason: describeError(err),
    });
    throw new ManifestError(err instanceof Error ? err.message : String(err));
  }
  log.debug("vault manifest verified", {
    seq: manifest.manifest_seq,
    objects: entries.length,
    key_epoch: manifest.key_epoch,
  });
  rememberManifestSeq(session, manifest.manifest_seq);
}

/**
 * Brings the cached collection key up to `keyEpoch`, or refuses the write.
 *
 * The epoch a write signs comes from the server's manifest while the ciphertext
 * is sealed with whatever key this session holds, so without this a device that
 * had not noticed another device's rotation sealed under the retired key and
 * signed a manifest claiming the current epoch. The server cannot catch it: the
 * epoch matches, the digest is over ciphertext bytes, and the signature is
 * genuine. What it leaves is a row nothing can decrypt, in a vault nothing can
 * rotate, since a rotation has to re-encrypt that row.
 *
 * Refreshing needs only this device's X-Wing secret, so it happens here rather
 * than sending the user back for their password.
 */
async function alignKeyEpoch(session: Session, keyEpoch: number): Promise<void> {
  if (session.keyEpoch === keyEpoch) {
    return;
  }
  const refreshed = await refreshCollectionKey(session);
  if (refreshed !== keyEpoch) {
    throw new Error(
      `The vault key has moved to epoch ${keyEpoch} and this device has epoch ${refreshed}. ` +
        "Nothing was saved. Sign in again and retry.",
    );
  }
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

function sealPayload(
  session: Session,
  id: string,
  contentType: string,
  payload: string,
  revision: number,
) {
  return {
    revision,
    encrypted: sealObject(session.collectionKey, id, session.state.collection_id, contentType, payload),
  };
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
  if (session.recoveryPending) {
    // The server refuses writes until the recovery's rotation happens, and would
    // answer this with a conflict. Saying so here names the thing the user has
    // to do instead of reporting a failed save.
    throw new Error(
      "This vault has an unfinished recovery: its key must be replaced before anything can be " +
        "saved, which issues a new recovery phrase.",
    );
  }
  const attempt = async (): Promise<number> => {
    const { seq, keyEpoch, latestRevision, entries } = await manifestState(session);
    // Before sealing, never after: this is the epoch the manifest below commits
    // to, so it is the one the ciphertext has to be made with.
    await alignKeyEpoch(session, keyEpoch);
    const revision = latestRevision + 1;
    const sealed = sealPayload(session, id, contentType, payload, revision);
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
        content_type: sealedContentType(),
        tombstone,
        manifest,
      },
      session.token,
    );
    session.latestRevision = response.revision;
    rememberManifestSeq(session, seq + 1);
    return response.revision;
  };

  return serializeVault(session.state.collection_id, async () => {
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
  });
}

const MAX_CALENDAR_EVENT_BATCH = 256;

/** Writes calendar events in atomic batches so large imports do not hit request limits. */
export async function putCalendarEvents(
  session: Session,
  events: Omit<CalendarEvent, "id">[],
): Promise<string[]> {
  const ids = events.map(() => newUuid());
  for (let offset = 0; offset < events.length; offset += MAX_CALENDAR_EVENT_BATCH) {
    const batch = events.slice(offset, offset + MAX_CALENDAR_EVENT_BATCH);
    const batchIds = ids.slice(offset, offset + MAX_CALENDAR_EVENT_BATCH);
    await serializeVault(session.state.collection_id, async () => {
      const { seq, keyEpoch, latestRevision, entries } = await manifestState(session);
      await alignKeyEpoch(session, keyEpoch);
      const writes = batch.map((event, index) => {
        const { raw, ...fields } = event;
        const revision = latestRevision + index + 1;
        const sealed = sealPayload(
          session,
          batchIds[index],
          CALENDAR_EVENT_CONTENT_TYPE,
          mergePayload(raw, { "@type": "CalendarEvent", version: PAYLOAD_SCHEMA_VERSION, ...fields }, [
            "@type", "version", "title", "start", "end", "notes", "location",
            "participants", "timezone", "calendarId", "recurrence",
          ]),
          revision,
        );
        return { id: batchIds[index], revision, sealed };
      });
      const manifestEntries = [
        ...entries,
        ...writes.map((write) => entryFor({
          id: write.id,
          revision: write.revision,
          tombstone: false,
          nonce: write.sealed.encrypted.nonce,
          ciphertext: write.sealed.encrypted.ciphertext,
        })),
      ];
      const manifest = manifestSign(
        bytesFromJson(session.state.mldsa_seed),
        bytesFromJson(session.state.ed25519_sk),
        session.state.collection_id,
        session.state.device_id,
        seq + 1,
        keyEpoch,
        latestRevision + writes.length,
        manifestEntries,
      );
      const response = await putJson<{ latest_revision: number }>(
        `${apiRoot(session.state.server)}/v1/collections/${session.state.collection_id}/objects/batch`,
        {
          objects: writes.map((write) => ({
            id: write.id,
            revision: write.revision,
            nonce: write.sealed.encrypted.nonce,
            ciphertext: write.sealed.encrypted.ciphertext,
            padded_size: write.sealed.encrypted.padded_size,
            content_type: sealedContentType(),
            tombstone: false,
          })),
          manifest,
        },
        session.token,
      );
      session.latestRevision = response.latest_revision;
      rememberManifestSeq(session, seq + 1);
    });
  }
  return ids;
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
    roster_seq: 0,
    roster_transcript: "",
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

/**
 * The roster an account starts life with: the registering device alone, signed
 * by itself and MAC'd under the collection key.
 *
 * Every later roster is a signed step from this one, so the account has a device
 * history the server cannot add to from the moment it exists. Sequence and key
 * epoch are both 1, which is what the server checks a genesis against.
 */
export function genesisRoster(collectionId: string, enrollment: Enrollment): Roster {
  return rosterSealDevice(
    collectionId,
    1,
    1,
    [
      {
        device_id: enrollment.device_id,
        mldsa_pk: enrollment.mldsa_pk,
        ed25519_pk: enrollment.ed25519_pk,
        xwing_hpke_pk: enrollment.hpke_pk,
      },
    ],
    enrollment.phrase_mldsa_pk,
    enrollment.phrase_ed25519_pk,
    enrollment.device_id,
    enrollment.mldsa_seed,
    enrollment.ed25519_sk,
    enrollment.collection_key,
  );
}

export async function registerAccount(
  server: string,
  username: string,
  password: string,
): Promise<RegisterResult> {
  const root = apiRoot(server);
  await checkProtocol(root);
  log.info("registering a new account");
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
  const device: DevicePublic = {
    device_id: enrollment.device_id,
    mldsa_pk: enrollment.mldsa_pk,
    ed25519_pk: enrollment.ed25519_pk,
    xwing_hpke_pk: enrollment.hpke_pk,
  };
  const genesis = genesisRoster(collectionId, enrollment);
  const finished = await postJson<{ account_id: string; collection_id: string }>(
    `${root}/v1/opaque/register/finish`,
    {
      username,
      upload,
      kdf_salt: enrollment.kdf_salt,
      device,
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
      roster: genesis,
    },
  );
  const state = deviceFromEnrollment(
    root,
    username,
    finished.account_id,
    finished.collection_id,
    enrollment,
  );
  // Pinned from the roster this device sealed, not from one fetched back: the
  // first roster a device accepts is the only one it can anchor on without
  // either a pin or a user confirming a pairing code.
  const pin = rosterVerify(
    finished.collection_id,
    0,
    "",
    [genesis],
    enrollment.collection_key,
    1,
    enrollment.device_id,
  );
  state.roster_seq = pin.pin_seq;
  state.roster_transcript = pin.pin_transcript;
  log.info("account registered, signing in");
  return {
    session: await loginAccount(state, password),
    phrase: enrollment.phrase,
  };
}

export async function pairJoin(
  server: string,
  username: string,
): Promise<{
  pairId: string;
  pairCode: string;
  confirm: string;
  rosterSeq: number;
  rosterTranscript: string;
  state: DeviceState;
}> {
  const root = apiRoot(server);
  await checkProtocol(root);
  const device = createDevice();
  const joined = await postJson<{
    pair_id: string;
    pair_code: string;
    confirm: string;
    roster_seq: number;
    roster_transcript: string;
  }>(`${root}/v1/pair/join`, {
    username,
    device: deviceBody(device),
    enrollment_signature: enrollSig(device),
  });
  if (!joined.roster_seq || !joined.roster_transcript) {
    throw new Error("The server sent no device roster for this account to anchor on");
  }
  // The code covers the roster this device is told the account is on, so that the
  // user comparing two codes also confirms the approver's view of the roster to
  // this device. The anchor becomes this device's roster pin below, so its first
  // roster fetch is checked against something the user vouched for rather than
  // against a MAC keyed from a collection key the same server supplies.
  const confirm = pairConfirmationCode(
    joined.pair_id,
    device.device_id,
    device.mldsa_pk,
    device.ed25519_pk,
    device.hpke_pk,
    joined.roster_seq,
    joined.roster_transcript,
  );
  if (joined.confirm !== confirm) {
    throw new Error("Pairing confirmation mismatch");
  }
  const state = deviceFromKeys(root, username, "", "", device);
  // The anchor the user is about to confirm by comparing codes. Pinning it here
  // means the roster this device is served after the approval has to be a signed
  // step from the one the code committed to.
  state.roster_seq = joined.roster_seq;
  state.roster_transcript = joined.roster_transcript;
  return {
    pairId: joined.pair_id,
    pairCode: joined.pair_code,
    confirm,
    rosterSeq: joined.roster_seq,
    rosterTranscript: joined.roster_transcript,
    state,
  };
}

export async function pairReady(server: string, pairCode: string): Promise<boolean> {
  const status = await getJson<{ status: string }>(`${apiRoot(server)}/v1/pair/${encodeURIComponent(pairCode)}`);
  return status.status === "ready";
}

export type PairPreview = {
  pairId: string;
  /**
   * The code this device computed, not the one the server sent.
   *
   * Computed over the joining device's keys as previewed *and* the anchor of a
   * roster this device verified from its own pin. Displaying the server's code
   * instead would make the user's comparison prove only that the joining
   * device's code reached the server unmodified: a server that substituted the
   * keys could show the real code and keep the ones it had swapped in.
   */
  confirm: string;
  device: DevicePublic;
  /** The roster being extended, which the code above commits to. */
  rosterSeq: number;
};

export async function pairPreview(
  session: Session,
  pairCode: string,
): Promise<PairPreview> {
  const resp = await getJson<{
    pair_id: string;
    confirm: string;
    device?: DevicePublic | null;
    roster_seq?: number | null;
  }>(`${apiRoot(session.state.server)}/v1/pair/${encodeURIComponent(pairCode)}`, session.token);
  if (!resp.device) {
    throw new Error("expired");
  }
  const anchor = await approvalAnchor(session, resp.device, resp.roster_seq ?? null);
  const confirm = pairConfirmationCode(
    resp.pair_id,
    resp.device.device_id,
    resp.device.mldsa_pk,
    resp.device.ed25519_pk,
    resp.device.xwing_hpke_pk,
    anchor.pin_seq,
    anchor.pin_transcript,
  );
  if (resp.confirm !== confirm) {
    // The two sides folded different things into the code: either the roster
    // moved under the pairing, or the keys in this preview are not the ones the
    // joining device is holding.
    throw new Error(
      "Pairing confirmation mismatch: this device and the new one do not agree on the account's " +
        "devices. Start the pairing again.",
    );
  }
  return {
    pairId: resp.pair_id,
    confirm,
    device: resp.device,
    rosterSeq: anchor.pin_seq,
  };
}

/**
 * The verified roster an approval extends, and the pin the pairing code covers.
 *
 * Checks everything about the approval that does not need the typed code, so a
 * preview that cannot lead to a valid approval fails before the user is asked to
 * compare anything.
 */
async function approvalAnchor(
  session: Session,
  joining: DevicePublic,
  joinedAt: number | null,
): Promise<RosterVerified> {
  const verified = await verifiedRosterChain(session);
  const roster = verified.roster;
  if (roster.key_epoch !== session.keyEpoch) {
    throw new Error(
      "The vault key has been rotated since this device fetched it. Sign in again and approve " +
        "the new device after that.",
    );
  }
  if (roster.devices.some((device) => device.device_id === joining.device_id)) {
    throw new Error("That device is already enrolled.");
  }
  if (joinedAt !== null && joinedAt !== verified.pin_seq) {
    // A rotation or another pairing landed while this one was waiting, so the
    // two sides would fold different anchors into the code.
    throw new Error(
      `The new device started pairing against roster ${joinedAt} but this account is now on ` +
        `roster ${verified.pin_seq}. Start the pairing again.`,
    );
  }
  session.roster = roster;
  return verified;
}

/**
 * Approves a joining device: wraps the collection key for it, signs the grant,
 * and signs the roster that adds it.
 *
 * The confirmation code is recomputed here from a roster this device verified,
 * and the typed code is compared against that rather than against anything the
 * server supplied. The roster step is what lets the joining device, and every
 * other device, accept the new one without trusting the server's device list.
 */
export async function pairApprove(
  session: Session,
  pairCode: string,
  preview: PairPreview,
  confirmation: string,
): Promise<string> {
  const { state } = session;
  const anchor = await approvalAnchor(session, preview.device, preview.rosterSeq);
  const confirm = pairConfirmationCode(
    preview.pairId,
    preview.device.device_id,
    preview.device.mldsa_pk,
    preview.device.ed25519_pk,
    preview.device.xwing_hpke_pk,
    anchor.pin_seq,
    anchor.pin_transcript,
  );
  // Codes are shown in groups of four, so compare on the normalised form but
  // send the canonical one.
  if (normalizeConfirmation(confirmation) !== confirm) {
    throw new Error("That confirmation code does not match the one for this pairing.");
  }
  const wrap = wrapCkForDevice(session.collectionKey, preview.device.xwing_hpke_pk);
  const mldsaSeed = bytesFromJson(state.mldsa_seed);
  const ed25519Sk = bytesFromJson(state.ed25519_sk);
  const grant = pairGrantSign(
    mldsaSeed,
    ed25519Sk,
    preview.pairId,
    state.device_id,
    preview.device.device_id,
    preview.device.mldsa_pk,
    preview.device.ed25519_pk,
    preview.device.xwing_hpke_pk,
    confirm,
  );
  const roster = rosterSealDevice(
    state.collection_id,
    anchor.roster.roster_seq + 1,
    anchor.roster.key_epoch,
    [...anchor.roster.devices, preview.device],
    anchor.roster.phrase_mldsa_pk,
    anchor.roster.phrase_ed25519_pk,
    state.device_id,
    mldsaSeed,
    ed25519Sk,
    session.collectionKey,
  );
  await postJson<{ status: string }>(
    `${apiRoot(state.server)}/v1/pair/${encodeURIComponent(pairCode)}/approve`,
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
      roster,
    },
    session.token,
  );
  // The account is on the roster this device just signed, so move the pin onto
  // it rather than waiting to be served it back.
  pinSealedRoster(session, roster);
  return confirm;
}

/**
 * Recovers an account onto a fresh device, setting a new password, and rotates
 * the vault key.
 *
 * `password` is the **replacement** password: a recovery exists for the case
 * where the password is what was lost, so asking for the old one would leave
 * someone who holds their 24 words locked out of their own vault. The server
 * takes it as an OPAQUE registration upload, signed by the phrase along with the
 * enrolling device, so none of it can be swapped in flight.
 *
 * Returns the **new** recovery phrase, which the caller must show to the user:
 * the one they just used no longer works.
 */
export async function recoverAccount(
  server: string,
  username: string,
  phrase: string,
  password: string,
): Promise<{ session: Session; phrase: string }> {
  const root = apiRoot(server);
  await checkProtocol(root);
  const words = phrase.trim().toLowerCase().split(/\s+/u).join(" ");
  // Begin registering the replacement password, so the server can answer with
  // the OPRF evaluation this needs in the same round trip.
  const opaque = opaqueRegisterStart(password);
  const started = await postJson<{
    wrap: KeyWrap;
    recovery_id: string;
    challenge: string;
    roster?: Roster | null;
    collection_id?: string | null;
    opaque_response: string;
  }>(`${root}/v1/recover/start`, {
    username,
    lookup_id: phraseLookupId(words),
    opaque_request: opaque.request,
  });
  const ck = unwrapPhrase(words, started.wrap.hpke_enc, started.wrap.wrapped_ck);
  if (!started.roster || !started.collection_id) {
    throw new Error("The server sent no device roster to recover onto.");
  }
  const collectionId = started.collection_id;
  const device = createDevice();
  // The server leaves the phrase key out of the roster it serves here, because
  // handing out the phrase verification keys before a proof would help anyone
  // guessing phrases. It is filled in from the phrase and then checked: the MAC
  // is keyed from the collection key the phrase wrap just opened, so a roster
  // the server made up cannot pass.
  const phraseKeys = phraseRecovery(words);
  const current: Roster = {
    ...started.roster,
    phrase_mldsa_pk: phraseKeys.mldsa_pk,
    phrase_ed25519_pk: phraseKeys.ed25519_pk,
  };
  let verified;
  try {
    // The membership check `rosterVerify` makes is "is this device listed", and
    // the recovering device is not listed yet by definition, so an existing
    // member stands in for it here. The checks that matter for a recovery are
    // the signature and the MAC.
    verified = rosterVerify(
      collectionId,
      0,
      "",
      [current],
      ck,
      current.key_epoch,
      current.devices[0]?.device_id ?? "",
    );
  } catch (err) {
    throw new ManifestError(err instanceof Error ? err.message : String(err));
  }
  const wrap = wrapCkForDevice(ck, device.hpke_pk);
  // The replacement password, and the collection-key wrap re-made under it from
  // the key the phrase just opened.
  const upload = opaqueRegisterFinish(opaque.state, password, started.opaque_response);
  const passwordWrap = wrapCkForPassword(ck, password);
  // The roster step that adds the recovering device, signed by the phrase: this
  // device has no enrolled signing key yet, so the phrase is the only member of
  // the current roster available to sign it.
  const nextRoster = rosterSealPhrase(
    collectionId,
    verified.roster.roster_seq + 1,
    verified.roster.key_epoch,
    [...verified.roster.devices, deviceBody(device)],
    words,
    ck,
  );
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
        upload,
        passwordWrap.kdf_salt,
        passwordWrap.recovery_nonce,
        passwordWrap.recovery_wrapped_ck,
        passwordWrap.recovery_ciphersuite,
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
      roster: nextRoster,
      upload,
      kdf_salt: passwordWrap.kdf_salt,
      recovery_nonce: passwordWrap.recovery_nonce,
      recovery_wrapped_ck: passwordWrap.recovery_wrapped_ck,
      recovery_ciphersuite: passwordWrap.recovery_ciphersuite,
    },
  );
  const state = deviceFromKeys(
    root,
    username,
    finished.account_id,
    finished.collection_id,
    device,
  );
  // Pinned from the roster this device signed with the phrase, so its first
  // fetch has to be a step from a roster it has already checked.
  const pin = rosterVerify(
    finished.collection_id,
    0,
    "",
    [nextRoster],
    ck,
    nextRoster.key_epoch,
    device.device_id,
  );
  state.roster_seq = pin.pin_seq;
  state.roster_transcript = pin.pin_transcript;
  const session = await loginAccount(state, password);
  // The phrase just used would otherwise keep working, and so would any copy of
  // it someone else kept: enrolling a device does not change the key the phrase
  // unwraps. Rotate, which issues a fresh phrase and retires the old one. Until
  // it finishes the server reports `recovery_pending` and refuses writes.
  return rotateVault(session, null, password);
}

export async function loginAccount(
  state: DeviceState,
  password: string,
): Promise<Session> {
  const root = apiRoot(state.server);
  const loginStarted = performance.now();
  await checkProtocol(root);
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
    recovery_pending?: boolean;
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
  const session: Session = {
    collectionKey,
    token: finished.session_token,
    latestRevision: 0,
    // Login hands back wraps for the current key, so start in sync: a refresh
    // should only happen when a rotation actually moves the epoch.
    keyEpoch: finished.key_epoch,
    // Seeded from the device state, not from zero: the high-water mark has to
    // outlive the session or a restart would reopen the rollback window.
    manifestSeq: state.manifest_seq ?? 0,
    recoveryPending: finished.recovery_pending === true,
    state: {
      ...state,
      server: root,
      account_id: finished.account_id,
      collection_id: finished.collection_id,
      kdf_salt: b64ToByteArray(finished.kdf_salt),
      session_token: finished.session_token,
    },
  };
  // The roster comes first, before anything reads or writes the vault: it is
  // what every later device-set decision is made from, and a device that is no
  // longer in it has been revoked and should say so here rather than fail
  // confusingly later.
  await syncRoster(session);
  log.info("signed in", {
    key_epoch: session.keyEpoch,
    latest_revision: session.latestRevision,
    recovery_pending: session.recoveryPending === true,
    ms: elapsed(loginStarted),
  });
  if (session.recoveryPending) {
    log.warn(
      "a recovery is unfinished, so the phrase used for it still opens this vault and " +
        "writes are refused until it is rotated",
    );
  }
  return session;
}

/**
 * Finishes the rotation an interrupted recovery left owing, and returns the
 * replacement recovery phrase for the caller to show.
 *
 * A recovery enrols a device but does not change the key the phrase unwraps, so
 * until the vault is rotated the phrase just used, and any copy of it, still
 * opens everything. `recoverAccount` rotates straight away; this is the path for
 * a recovery that was interrupted between the two, which the server reports as
 * `recovery_pending` at every login and enforces by refusing writes.
 *
 * Unlike the Rust client, a pending recovery is not raised as an error from
 * `loginAccount`: the vault is still readable, and refusing to open it would
 * leave the user with no way to see what they recovered. The session carries
 * `recoveryPending` instead, and the app asks to finish it.
 */
export async function completeRecoveryRotation(
  session: Session,
  password: string,
): Promise<{ session: Session; phrase: string }> {
  return rotateVault(session, null, password);
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
    log.error("this device has no key wrap in the current epoch", { key_epoch: resp.key_epoch });
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
  log.info("collection key refreshed", { from_epoch: session.keyEpoch, to_epoch: resp.key_epoch });
  session.keyEpoch = resp.key_epoch;
  return resp.key_epoch;
}

export type VaultListing = {
  sealed: SealedObject[];
  addressBooks: AddressBook[];
  contacts: Contact[];
  calendars: Calendar[];
  calendarEvents: CalendarEvent[];
  notes: Note[];
  notebooks: Notebook[];
  accountSettings: AccountSettings;
  /**
   * The settings payload as stored, so a save merges onto it rather than
   * replacing it with only the fields this build knows.
   */
  accountSettingsRaw?: string;
  /**
   * The id they were read from, absent when the account has no settings. Only
   * `LEGACY_ACCOUNT_SETTINGS_ID` needs acting on: see `ensureDefaultCalendar`.
   */
  accountSettingsId?: string;
  /**
   * Rows the manifest verified but this device could not open, so a partly
   * unreadable vault is not presented as a partly empty one. A non-zero count
   * also means the snapshot must not be overwritten with this listing.
   */
  unopened: number;
};

export function listVault(session: Session): Promise<VaultListing> {
  return serializeVault(session.state.collection_id, () => listVaultInner(session));
}

type ChangesWalk = {
  /** The newest revision of each object, in the order the pages served them. */
  objects: SealedObject[];
  keyEpoch: number;
  latestRevision: number;
  manifest: ManifestBody | null;
  tombstoneFloor: number;
};

/**
 * Walks `/changes` to its end and keeps the newest revision of each object.
 *
 * A page carries at most the server's `MAX_CHANGES_LIMIT` rows, so everything
 * that needs the whole collection pages through it, rotation included: the
 * manifest commits to the collection rather than to any one page of it, and the
 * callers check their assembled set against it.
 */
async function walkChanges(session: Session): Promise<ChangesWalk> {
  const { state, token } = session;
  const started = performance.now();
  let pages = 0;
  let after = 0;
  let keyEpoch = session.keyEpoch;
  let latestRevision = session.latestRevision;
  let manifest: ManifestBody | null = null;
  let tombstoneFloor = 0;
  let pageObjects: SealedObject[] = [];
  // Superseded revisions are pruned after a retention window, so a walk can name
  // a watermark whose successors no longer exist. The server answers `resync`
  // rather than serving the remaining tail, which would silently skip the writes
  // in between. A snapshot walk pages through live objects instead of the log, so
  // it needs nothing retained; once is enough, and a second `resync` would mean
  // the server is answering something other than what was asked.
  let snapshot = false;
  let restarted = false;
  // Pages come from separate transactions, so a write landing between two of
  // them leaves the accumulated set and the final manifest describing different
  // states. The digest then disagrees and `verifyManifest` reports a withheld or
  // substituted object, which is the loudest thing this app says and is wrong
  // here. Every page carries the current manifest, so a walk that sees the
  // sequence move restarts instead, bounded so a vault being written to
  // continuously fails plainly rather than looping.
  let expectedSeq: number | null | undefined;
  let moved = 0;
  for (;;) {
    const page = await getJson<{
      latest_revision: number;
      key_epoch: number;
      objects: SealedObject[];
      has_more: boolean;
      manifest: ManifestBody | null;
      resync?: boolean;
      tombstone_floor?: number;
    }>(
      `${apiRoot(state.server)}/v1/collections/${state.collection_id}/changes?after=${after}` +
        `&limit=${CHANGES_PAGE_LIMIT}${snapshot ? "&snapshot=true" : ""}`,
      token,
    );
    pages += 1;
    if (page.resync && !snapshot) {
      if (restarted) {
        log.error("the server asked for a second resync in one walk", { pages });
        throw new Error("The server keeps asking this device to restart its sync.");
      }
      log.warn("the revision log no longer reaches this device; reading a snapshot instead");
      restarted = true;
      snapshot = true;
      after = 0;
      pageObjects = [];
      expectedSeq = undefined;
      continue;
    }
    const pageSeq = page.manifest ? page.manifest.manifest_seq : null;
    if (expectedSeq === undefined) {
      expectedSeq = pageSeq;
    } else if (pageSeq !== expectedSeq) {
      if (moved >= MAX_SYNC_RESTARTS) {
        log.warn("the vault was written to on every attempt to read it", {
          attempts: moved,
          pages,
        });
        throw new Error(
          "The vault kept changing while it was being read. Another device may be writing to it; try again.",
        );
      }
      moved += 1;
      log.debug("vault changed mid-read, restarting the walk", { attempt: moved, pages });
      expectedSeq = undefined;
      after = 0;
      pageObjects = [];
      continue;
    }
    keyEpoch = page.key_epoch;
    latestRevision = Math.max(latestRevision, page.latest_revision);
    manifest = page.manifest;
    tombstoneFloor = page.tombstone_floor ?? 0;
    pageObjects.push(...page.objects);
    const high = page.objects.reduce((top, object) => Math.max(top, object.revision), 0);
    if (!page.has_more || high <= after) break;
    after = high;
  }
  // Only the newest revision of each object is carried out of the walk.
  const latestByObject = new Map<string, SealedObject>();
  for (const object of pageObjects) {
    const previous = latestByObject.get(object.id);
    if (!previous || object.revision > previous.revision) {
      latestByObject.set(object.id, object);
    }
  }
  log.debug("walked the change log", {
    pages,
    rows: pageObjects.length,
    objects: latestByObject.size,
    key_epoch: keyEpoch,
    snapshot,
    ms: elapsed(started),
  });
  return {
    objects: [...latestByObject.values()],
    keyEpoch,
    latestRevision,
    manifest,
    tombstoneFloor,
  };
}

/** One live object, opened: the row it came from and what its envelope held. */
type OpenedVaultObject = {
  object: SealedObject;
  /**
   * Authenticated by the AEAD, so this is the type to dispatch on rather than
   * the label the server served.
   */
  contentType: string;
  payload: string;
};

type OpenedVault = {
  opened: OpenedVaultObject[];
  /** Rows the manifest verified but this device could not open. */
  unopened: number;
};

/**
 * The whole collection, verified against the manifest and decrypted, with
 * tombstones dropped.
 *
 * Shared by the typed listing and by a full export, which need the same walk,
 * the same manifest check and the same key alignment but disagree about what to
 * do with a content type this build does not know: the listing skips it, the
 * export carries it.
 */
async function openVault(session: Session): Promise<OpenedVault> {
  const { state } = session;
  const walk = await walkChanges(session);
  session.latestRevision = walk.latestRevision;
  // If another device revoked someone, the key was rotated and everything was
  // re-encrypted. Pick up the new key before decrypting, otherwise every object
  // would fail to open and the vault would look empty.
  if (walk.keyEpoch !== session.keyEpoch) {
    await refreshCollectionKey(session);
  }
  const { collectionKey } = session;
  const opened: OpenedVaultObject[] = [];
  let unopened = 0;
  // Check what was served against what a device signed for, before decrypting any
  // of it. A failure here means an object was withheld, rolled back or
  // substituted, and must not be presented as an empty or partial vault.
  if (walk.manifest) {
    await verifyManifest(session, walk.manifest, walk.objects.map(entryFor));
  } else if (session.manifestSeq > 0) {
    log.error("the vault was served with no manifest after this device had seen one", {
      seen_seq: session.manifestSeq,
    });
    throw new ManifestError(
      "The server served this vault with no manifest, but this device has seen one. Refusing to continue.",
    );
  }
  for (const obj of walk.objects) {
    let raw: string;
    let contentType: string;
    let tombstone = obj.tombstone;
    try {
      const result = openObject(collectionKey, obj.id, state.collection_id, obj.nonce, obj.ciphertext, obj.padded_size);
      raw = result.payload;
      contentType = result.contentType;
      // Either flag is enough. The row's is what the signed manifest commits
      // to, and the envelope carries its own, so a delete is never read back as
      // live whichever of the two it was recorded in.
      tombstone = tombstone || result.tombstone;
    } catch {
      // The manifest already verified, so this row is one a device signed for
      // and the server served faithfully: the failure is local, and dropping it
      // silently is what made an unreadable vault look like an emptied one.
      unopened += 1;
      continue;
    }
    if (tombstone) continue;
    opened.push({ object: obj, contentType, payload: raw });
  }
  if (unopened > 0) {
    // The manifest verified, so these rows are genuine and the failure is local:
    // a key epoch this device cannot reach, or a payload a newer build wrote.
    log.warn("some vault objects could not be opened on this device", {
      unopened,
      objects: walk.objects.length,
      key_epoch: session.keyEpoch,
    });
  }
  return { opened, unopened };
}

export type VaultExport = {
  /** Every live object, whatever its content type, in the order read. */
  objects: { id: string; contentType: string; payload: string }[];
  /** Objects this device could not open, so an export can say it is partial. */
  unreadable: number;
};

/**
 * Every object in the vault as stored, for a full account export.
 *
 * Deliberately not built from a `VaultListing`: that drops the content types
 * this build does not parse, and an export of an account has to carry an object
 * a newer client wrote rather than quietly leaving it out of the backup.
 */
export function exportVault(session: Session): Promise<VaultExport> {
  return serializeVault(session.state.collection_id, async () => {
    const { opened, unopened } = await openVault(session);
    return {
      objects: opened.map(({ object, contentType, payload }) => ({
        id: object.id,
        contentType,
        payload,
      })),
      unreadable: unopened,
    };
  });
}

async function listVaultInner(session: Session): Promise<VaultListing> {
  const { opened, unopened } = await openVault(session);
  const sealed: SealedObject[] = [];
  const addressBooks: AddressBook[] = [];
  const contacts: Contact[] = [];
  const calendarEvents: CalendarEvent[] = [];
  const calendars: Calendar[] = [];
  const notes: Note[] = [];
  const notebooks: Notebook[] = [];
  // Default until the settings object turns up: an account that has never saved
  // one has every feature enabled.
  let accountSettings = DEFAULT_ACCOUNT_SETTINGS;
  let accountSettingsRaw: string | undefined;
  let accountSettingsId: string | undefined;
  for (const { object: obj, contentType, payload: raw } of opened) {
    try {
      sealed.push(obj);
      if (contentType === CALENDAR_EVENT_CONTENT_TYPE || isCalendarEventPayload(raw)) {
        const value = JSON.parse(raw) as { title?: string; start?: string; end?: string; notes?: string; location?: string; participants?: string[]; timezone?: string; calendarId?: string; recurrence?: CalendarEvent["recurrence"] };
        calendarEvents.push({ id: obj.id, title: value.title?.trim() || "Untitled event", start: value.start ?? "", end: value.end, notes: value.notes, location: value.location, participants: value.participants, timezone: value.timezone, calendarId: value.calendarId, recurrence: value.recurrence, raw });
      } else if (contentType === CALENDAR_CONTENT_TYPE || isCalendarPayload(raw)) {
        const value = JSON.parse(raw) as { name?: string; color?: string; favorite?: boolean };
        calendars.push({ id: obj.id, name: value.name?.trim() || "Untitled calendar", color: value.color || DEFAULT_CALENDAR_COLOR, favorite: value.favorite === true, raw });
      } else if (contentType === ADDRESS_BOOK_CONTENT_TYPE || isAddressBookPayload(raw)) {
        addressBooks.push(parseAddressBook(obj.id, raw));
      } else if (contentType === NOTE_CONTENT_TYPE || isPayloadOfType(raw, "Note")) {
        notes.push(parseNote(obj.id, raw));
      } else if (contentType === NOTEBOOK_CONTENT_TYPE || isPayloadOfType(raw, "Notebook")) {
        notebooks.push(parseNotebook(obj.id, raw));
      } else if (
        contentType === ACCOUNT_SETTINGS_CONTENT_TYPE ||
        isPayloadOfType(raw, "AccountSettings")
      ) {
        // Two objects can answer to this shape until a legacy account's copy
        // at the calendar's id is migrated, so the canonical id wins rather
        // than whichever the server returned last.
        if (obj.id === ACCOUNT_SETTINGS_ID || accountSettingsId !== ACCOUNT_SETTINGS_ID) {
          accountSettings = parseAccountSettings(raw);
          accountSettingsRaw = raw;
          accountSettingsId = obj.id;
        }
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
  log.info("vault opened", {
    contacts: contacts.length,
    address_books: addressBooks.length,
    events: calendarEvents.length,
    calendars: calendars.length,
    notes: notes.length,
    notebooks: notebooks.length,
    unopened,
  });
  return {
    sealed,
    addressBooks: sortAddressBooks(addressBooks),
    contacts: sortContacts(contacts),
    calendars: sortCalendars(calendars),
    calendarEvents,
    notes: sortNotes(notes),
    notebooks: sortNotebooks(notebooks),
    accountSettings,
    accountSettingsRaw,
    accountSettingsId,
    unopened,
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
  previousRaw?: string,
): Promise<string> {
  const plaintext = serializeAddressBook(name, previousRaw);
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
  if (!contactFitsObjectLimit(draft)) {
    throw new Error("This contact is too large to store.");
  }
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

/** Every key this build writes for an event. See `mergePayload`. */
const CALENDAR_EVENT_KEYS = [
  "@type",
  "version",
  "title",
  "start",
  "end",
  "notes",
  "location",
  "participants",
  "timezone",
  "calendarId",
  "recurrence",
] as const;

const CALENDAR_KEYS = ["@type", "version", "name", "color", "favorite"] as const;

export async function putCalendarEvent(session: Session, event: Omit<CalendarEvent, "id">, existingId?: string): Promise<string> {
  const id = existingId ?? newUuid();
  // `raw` is what the merge reads, not a field of the payload itself.
  const { raw, ...fields } = event;
  const plaintext = mergePayload(
    raw,
    { "@type": "CalendarEvent", version: PAYLOAD_SCHEMA_VERSION, ...fields },
    CALENDAR_EVENT_KEYS,
  );
  await putSealed(session, id, CALENDAR_EVENT_CONTENT_TYPE, false, plaintext);
  return id;
}

export async function putCalendar(session: Session, calendar: Omit<Calendar, "id">, existingId?: string): Promise<string> {
  const id = existingId ?? newUuid();
  const { raw, ...fields } = calendar;
  const plaintext = mergePayload(
    raw,
    { "@type": "Calendar", version: PAYLOAD_SCHEMA_VERSION, ...fields },
    CALENDAR_KEYS,
  );
  await putSealed(session, id, CALENDAR_CONTENT_TYPE, false, plaintext);
  return id;
}

export async function deleteCalendarEvent(session: Session, id: string): Promise<void> {
  await putSealed(session, id, CALENDAR_EVENT_CONTENT_TYPE, true, "");
}

/**
 * Returns the calendar list with the default one present, creating it if needed.
 *
 * Called when the Calendar tab is first opened rather than on every vault
 * refresh, for the reason `ensureDefaultNotebook` gives: a write here can fail,
 * and on the refresh path that failure would stop the whole vault loading.
 */
export async function ensureDefaultCalendar(
  session: Session,
  calendars: Calendar[],
): Promise<Calendar[]> {
  if (calendars.some((calendar) => calendar.id === DEFAULT_CALENDAR_ID)) {
    return sortCalendars(calendars);
  }
  // The caller's list can predate the first vault read, and the write below is
  // to a fixed id: on an account that already has a default calendar it would
  // overwrite it, undoing a rename or a colour. So the absence is confirmed
  // against the vault before anything is written.
  const listed = await listVault(session);
  if (listed.calendars.some((calendar) => calendar.id === DEFAULT_CALENDAR_ID)) {
    return listed.calendars;
  }
  // This id holds the settings on an account sealed before they moved off it,
  // and the write below would reset every preference. Copied first, so the
  // calendar only lands once they are safe.
  if (listed.accountSettingsId === LEGACY_ACCOUNT_SETTINGS_ID) {
    await putAccountSettings(session, listed.accountSettings, listed.accountSettingsRaw);
  }
  const body = {
    name: DEFAULT_CALENDAR_NAME,
    color: DEFAULT_CALENDAR_COLOR,
    favorite: false,
  };
  await putCalendar(session, body, DEFAULT_CALENDAR_ID);
  return sortCalendars([{ id: DEFAULT_CALENDAR_ID, ...body }, ...listed.calendars]);
}

export async function deleteCalendar(session: Session, id: string): Promise<void> {
  await putSealed(session, id, CALENDAR_CONTENT_TYPE, true, "");
}

/**
 * The id a new note will be stored under, issued before its first write so that
 * autosave's repeated writes are updates rather than a race to create.
 */
export function newNoteId(): string {
  return newUuid();
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
  previousRaw?: string,
): Promise<string> {
  const id = existingId ?? newUuid();
  await putSealed(
    session,
    id,
    NOTEBOOK_CONTENT_TYPE,
    false,
    serializeNotebook(name, previousRaw),
  );
  return id;
}

/**
 * Saves the account settings, at the one well-known object id.
 *
 * There is no delete: the object is a singleton, and a tombstoned one would read
 * back as the default on every client.
 */
export async function putAccountSettings(
  session: Session,
  settings: AccountSettings,
  previousRaw?: string,
): Promise<void> {
  await putSealed(
    session,
    ACCOUNT_SETTINGS_ID,
    ACCOUNT_SETTINGS_CONTENT_TYPE,
    false,
    serializeAccountSettings(settings, previousRaw),
  );
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

/**
 * The account's devices, from the verified roster rather than the server's list.
 *
 * The server's own word for which devices exist is what the roster replaces: a
 * device the server added to that list would be shown to the user as theirs, and
 * wrapped for at the next rotation. The server no longer serves such a list.
 */
export async function listDevices(session: Session): Promise<DeviceSummary[]> {
  return (await syncRoster(session)).devices;
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
  return rotateAuthenticated(fresh, revokeDeviceId, password, onProgress);
}

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
