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
  pairGrantSign,
  phraseVerifierB64,
  unwrapCk,
  unwrapPhrase,
  wrapCkForDevice,
} from "./wasm";
import type { Contact, DeviceOut, DevicePublic, DeviceState, KeyWrap, SealedObject } from "./types";

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

function apiRoot(server: string): string {
  const trimmed = server.replace(/\/$/u, "");
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

export type Session = {
  state: DeviceState;
  collectionKey: string;
  token: string;
};

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
      phrase_verifier: enrollment.phrase_verifier,
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
): Promise<{ pairId: string; confirm: string; state: DeviceState }> {
  const root = apiRoot(server);
  const device = createDevice();
  const joined = await postJson<{ pair_id: string; confirm: string }>(`${root}/v1/pair/join`, {
    username,
    device: deviceBody(device),
    enrollment_signature: enrollSig(device),
  });
  return {
    pairId: joined.pair_id,
    confirm: joined.confirm,
    state: deviceFromKeys(root, username, "", "", device),
  };
}

export async function pairReady(server: string, pairId: string): Promise<boolean> {
  const status = await getJson<{ status: string }>(`${apiRoot(server)}/v1/pair/${pairId}`);
  return status.status === "ready";
}

export async function pairPreview(
  session: Session,
  pairId: string,
): Promise<{ confirm: string; device: DevicePublic }> {
  const resp = await getJson<{
    confirm: string;
    device?: DevicePublic | null;
  }>(`${apiRoot(session.state.server)}/v1/pair/${pairId}`, session.token);
  if (!resp.device) {
    throw new Error("expired");
  }
  return { confirm: resp.confirm, device: resp.device };
}

export async function pairApprove(session: Session, pairId: string): Promise<string> {
  const preview = await pairPreview(session, pairId);
  const wrap = wrapCkForDevice(session.collectionKey, preview.device.xwing_hpke_pk);
  const grant = pairGrantSign(
    bytesFromJson(session.state.mldsa_seed),
    bytesFromJson(session.state.ed25519_sk),
    pairId,
    session.state.device_id,
    preview.device.device_id,
    preview.device.mldsa_pk,
    preview.device.ed25519_pk,
    preview.device.xwing_hpke_pk,
    preview.confirm,
  );
  await postJson(
    `${apiRoot(session.state.server)}/v1/pair/${pairId}/approve`,
    {
      wrap: {
        recipient_kind: "device",
        recipient_id: preview.device.device_id,
        hpke_enc: wrap.enc,
        wrapped_ck: wrap.wrapped_ck,
        ciphersuite: wrap.ciphersuite,
      },
      grant,
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
  const started = await postJson<{ wrap: KeyWrap }>(`${root}/v1/recover/start`, { username });
  const words = phrase.trim().toLowerCase().split(/\s+/u).join(" ");
  const ck = unwrapPhrase(words, started.wrap.hpke_enc, started.wrap.wrapped_ck);
  const device = createDevice();
  const wrap = wrapCkForDevice(ck, device.hpke_pk);
  const finished = await postJson<{ account_id: string; collection_id: string }>(
    `${root}/v1/recover/finish`,
    {
      username,
      phrase_verifier: phraseVerifierB64(words),
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

export async function loginAccount(state: DeviceState, password: string): Promise<Session> {
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

function jscontact(name: string, email?: string): string {
  const body: Record<string, unknown> = {
    "@type": "Card",
    version: "1.0",
    name: { full: name },
  };
  if (email) {
    body.emails = { e1: { address: email } };
  }
  return JSON.stringify(body);
}

function parseCard(id: string, raw: string, ciphertext: string, paddedSize: number): Contact {
  try {
    const card = JSON.parse(raw) as {
      name?: { full?: string };
      emails?: Record<string, { address?: string }>;
    };
    const email = card.emails ? Object.values(card.emails)[0]?.address : undefined;
    return {
      id,
      name: card.name?.full ?? "Untitled",
      email,
      raw,
      ciphertext,
      paddedSize,
    };
  } catch {
    return { id, name: raw, raw, ciphertext, paddedSize };
  }
}

export async function listContacts(session: Session): Promise<{ sealed: SealedObject[]; open: Contact[] }> {
  const { state, token, collectionKey } = session;
  const resp = await getJson<{ objects: SealedObject[] }>(
    `${apiRoot(state.server)}/v1/collections/${state.collection_id}/changes?after=0`,
    token,
  );
  const sealed = resp.objects.filter((obj) => !obj.tombstone);
  const open: Contact[] = [];
  for (const obj of sealed) {
    const raw = decryptContact(
      collectionKey,
      obj.id,
      state.collection_id,
      obj.nonce,
      obj.ciphertext,
      obj.padded_size,
    );
    open.push(parseCard(obj.id, raw, obj.ciphertext, obj.padded_size));
  }
  return { sealed, open };
}

export async function putContact(session: Session, name: string, email?: string): Promise<void> {
  const id = newUuid();
  const plaintext = jscontact(name, email);
  const enc = encryptContact(session.collectionKey, id, session.state.collection_id, plaintext);
  await putJson(
    `${apiRoot(session.state.server)}/v1/collections/${session.state.collection_id}/objects`,
    {
      id,
      nonce: enc.nonce,
      ciphertext: enc.ciphertext,
      padded_size: enc.padded_size,
      content_type: "application/jscontact+json",
      tombstone: false,
    },
    session.token,
  );
}

