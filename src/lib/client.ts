import { b64ToByteArray, bytesFromJson } from "./bytes";
import {
  createDevice,
  createEnrollment,
  decryptContact,
  encryptContact,
  newUuid,
  opaqueLoginFinish,
  opaqueLoginStart,
  opaqueRegisterFinish,
  opaqueRegisterStart,
  pairConfirmationCode,
  pairGrantSign,
  phraseVerifierB64,
  phraseRecoveryProofB64,
  unwrapCk,
  unwrapPhrase,
  wrapCkForDevice,
  wrapCkForPassword,
  generateNewPhrase,
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
import type { AddressBook, Calendar, CalendarEvent, Contact, ContactDraft, DeviceOut, DevicePublic, DeviceState, KeyWrap, SealedObject } from "./types";

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

async function deleteJson<T>(url: string, token: string): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
    }),
  );
}

export type Session = {
  state: DeviceState;
  collectionKey: string;
  token: string;
  latestRevision: number;
};

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
) {
  const revision = session.latestRevision + 1;
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
  const sealed = sealPayload(session, id, contentType, tombstone, payload);
  const response = await putJson<{ revision: number }>(
    `${apiRoot(session.state.server)}/v1/collections/${session.state.collection_id}/objects`,
    {
      id,
      revision: sealed.revision,
      nonce: sealed.encrypted.nonce,
      ciphertext: sealed.encrypted.ciphertext,
      padded_size: sealed.encrypted.padded_size,
      content_type: contentType,
      tombstone,
    },
    session.token,
  );
  session.latestRevision = response.revision;
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
      phrase_recovery_pk: enrollment.phrase_recovery_pk,
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
): Promise<Session> {
  const root = apiRoot(server);
  const words = phrase.trim().toLowerCase().split(/\s+/u).join(" ");
  const started = await postJson<{
    wrap: KeyWrap;
    recovery_id: string;
    challenge: string;
  }>(`${root}/v1/recover/start`, {
    username,
    phrase_recovery_pk: phraseVerifierB64(words),
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
      phrase_proof: phraseRecoveryProofB64(
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
  return loginAccount(state, password);
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
  const started = await postJson<{
    login_id: string;
    response: string;
    challenge_enc: string;
    challenge_ct: string;
  }>(`${root}/v1/opaque/login/start`, {
    username: state.username,
    device_id: state.device_id,
    request: start.request,
  });
  const proof = opaqueLoginFinish(
    start.state,
    password,
    started.response,
    started.challenge_enc,
    started.challenge_ct,
    hpkeSk,
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
  }>(`${root}/v1/opaque/login/finish`, {
    login_id: started.login_id,
    username: state.username,
    device_id: state.device_id,
    finalization: proof.finalization,
    challenge: proof.challenge,
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
  const { state, token, collectionKey } = session;
  const resp = await getJson<{ latest_revision: number; objects: SealedObject[] }>(
    `${apiRoot(state.server)}/v1/collections/${state.collection_id}/changes?after=0`,
    token,
  );
  session.latestRevision = resp.latest_revision;
  const sealed: SealedObject[] = [];
  const addressBooks: AddressBook[] = [];
  const contacts: Contact[] = [];
  const calendarEvents: CalendarEvent[] = [];
  const calendars: Calendar[] = [];
  const latestByObject = new Map<string, SealedObject>();
  for (const obj of resp.objects) {
    const previous = latestByObject.get(obj.id);
    if (!previous || obj.revision > previous.revision) {
      latestByObject.set(obj.id, obj);
    }
  }
  for (const obj of latestByObject.values()) {
    let raw: string;
    let contentType = obj.content_type;
    try {
      const decrypted = decryptContact(collectionKey, obj.id, state.collection_id, obj.nonce, obj.ciphertext, obj.padded_size);
      const envelope = JSON.parse(decrypted) as Partial<SealedPayload>;
      if (envelope.version === 1) {
        if (envelope.contentType !== obj.content_type || envelope.tombstone !== obj.tombstone || envelope.revision !== obj.revision || typeof envelope.payload !== "string") continue;
        raw = envelope.payload;
        contentType = envelope.contentType;
      } else {
        raw = decrypted;
      }
    } catch {
      continue;
    }
    if (obj.tombstone) continue;
    sealed.push(obj);
    if (contentType === CALENDAR_EVENT_CONTENT_TYPE || isCalendarEventPayload(raw)) {
      const value = JSON.parse(raw) as { title?: string; start?: string; end?: string; notes?: string; location?: string; participants?: string[]; timezone?: string; calendarId?: string; recurrence?: CalendarEvent["recurrence"] };
      calendarEvents.push({ id: obj.id, title: value.title?.trim() || "Untitled event", start: value.start ?? "", end: value.end, notes: value.notes, location: value.location, participants: value.participants, timezone: value.timezone, calendarId: value.calendarId, recurrence: value.recurrence });
    } else if (contentType === CALENDAR_CONTENT_TYPE || isCalendarPayload(raw)) {
      const value = JSON.parse(raw) as { name?: string; color?: string };
      calendars.push({ id: obj.id, name: value.name?.trim() || "Untitled calendar", color: value.color || "#7aa2f7" });
    } else if (contentType === ADDRESS_BOOK_CONTENT_TYPE || isAddressBookPayload(raw)) {
      addressBooks.push(parseAddressBook(obj.id, raw));
    } else {
      contacts.push(parseContact(obj.id, raw, obj.ciphertext, obj.padded_size));
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
  await postJson<{ status: string }>(
    `${root}/v1/account/username`,
    {
      new_username: newUsername,
      upload,
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
  const startRes = await postJson<{ password_change_id: string; response: string }>(
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
  await postJson<{ status: string }>(
    `${root}/v1/account/password`,
    {
      password_change_id: startRes.password_change_id,
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

export async function rotatePhrase(session: Session): Promise<string> {
  const root = apiRoot(session.state.server);
  const phraseOut = generateNewPhrase(session.collectionKey);
  await postJson<{ status: string }>(
    `${root}/v1/account/phrase`,
    {
      phrase_recovery_pk: phraseOut.phrase_recovery_pk,
      phrase_nonce: phraseOut.phrase_nonce,
      phrase_wrapped_ck: phraseOut.phrase_wrapped_ck,
      phrase_ciphersuite: phraseOut.phrase_ciphersuite,
    },
    session.token,
  );
  return phraseOut.phrase;
}

export async function deleteAccount(session: Session, currentPassword: string): Promise<void> {
  const freshSession = await loginAccount(session.state, currentPassword);
  const root = apiRoot(freshSession.state.server);
  await deleteJson<{ status: string }>(`${root}/v1/account`, freshSession.token);
}

