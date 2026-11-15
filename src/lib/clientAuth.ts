import { b64ToByteArray } from "./bytes";
import {
  coreAccountChallengeRequest,
  coreChangePasswordRequest,
  coreChangeUsernameRequest,
  coreDeleteAccountRequest,
  coreLoginAccept,
  coreLoginChallengeRequest,
  coreLoginFinishRequest,
  coreLoginStartRequest,
  coreNewDevice,
  coreNewRegistration,
  coreNormalizeUsername,
  coreOpaqueLoginStart,
  coreOpaqueRegisterStart,
  coreOpaqueRegisterUpload,
  corePasswordChangeStartAccept,
  corePasswordChangeStartRequest,
  coreRecoverAccept,
  coreRecoverFinishRequest,
  coreRecoverStartAccept,
  coreRecoverStartRequest,
  coreRegisterAccept,
  coreRegisterFinishRequest,
  coreRegisterStartAccept,
  coreRegisterStartRequest,
  type AuthRequest,
} from "./wasm";
import { elapsed, log } from "./log";
import { adoptKey } from "./roster";
import { apiRoot, deleteJson, postText } from "./transport";
import { checkProtocol, fromCoreState, rememberManifestSeq, toCoreState, type Session } from "./clientCore";
import { rotateAuthenticated } from "./clientRotation";
import { saveServerPosture } from "./storage";
import type { DeviceState } from "./types";

export type RegisterResult = {
  session: Session;
  phrase: string;
};

/** Posts what core decided on and hands the answer back for core to read. */
async function post(root: string, request: AuthRequest, token?: string): Promise<string> {
  return postText(`${root}${request.path}`, request.body, token);
}

export async function registerAccount(
  server: string,
  username: string,
  password: string,
): Promise<RegisterResult> {
  const root = apiRoot(server);
  await checkProtocol(root);
  log.info("registering a new account");
  // The device, the collection, the collection key, the salt and the phrase all
  // come from core, so this app is not the one deciding what a new account is.
  const identity = coreNewRegistration();
  const opaque = coreOpaqueRegisterStart(password);
  const started = coreRegisterStartAccept(
    await post(root, coreRegisterStartRequest(username, opaque.request)),
  );
  const upload = coreOpaqueRegisterUpload(opaque.state, password, started);
  const registering = coreRegisterFinishRequest(username, password, upload, identity);
  const finished = await post(root, registering.request);
  // Pinned on the roster this device sealed, not on one fetched back: the first
  // roster a device accepts is the only one it can anchor on without either a
  // pin or a user confirming a pairing code.
  const state = fromCoreState(
    coreRegisterAccept(root, username, identity, registering.pin, finished),
  );
  log.info("account registered, signing in");
  return {
    session: await loginAccount(state, password),
    phrase: identity.phrase,
  };
}

export async function loginAccount(state: DeviceState, password: string): Promise<Session> {
  const root = apiRoot(state.server);
  const loginStarted = performance.now();
  const posture = await checkProtocol(root);
  const core = toCoreState(state);
  const opaque = coreOpaqueLoginStart(password);

  // Step 1: ask for a challenge sealed to this device's X-Wing key.
  const challenged = await post(
    root,
    coreLoginChallengeRequest(core.username, core.device_id),
  );

  // Step 2: prove device possession. The server withholds the OPAQUE
  // credential response until this verifies, which is what keeps the password
  // out of reach of an attacker who can break Ristretto255.
  const starting = coreLoginStartRequest(core, opaque.request, challenged);
  const startedBody = await post(root, starting.request);

  // Step 3: complete OPAQUE and bind the finalization to the device.
  const finished = await post(
    root,
    coreLoginFinishRequest(core, opaque.state, password, starting.challenge, startedBody),
  );
  const logged = coreLoginAccept(core, password, finished);
  // No key until the roster has vouched for it, below.
  const session: Session = {
    collectionKey: "",
    token: logged.state.session_token ?? "",
    latestRevision: 0,
    keyEpoch: 0,
    // Seeded from the device state, not from zero: the high-water mark has to
    // outlive the session or a restart would reopen the rollback window.
    manifestSeq: logged.state.manifest_seq ?? 0,
    recoveryPending: logged.recovery_pending,
    state: { ...fromCoreState(logged.state), server: root },
  };
  // The roster comes first, before anything reads or writes the vault: it is
  // what every later device-set decision is made from, and a device that is no
  // longer in it has been revoked and should say so here rather than fail
  // confusingly later. It is also what proves the key login opened is the
  // account's: the server can seal a wrap of its own key to this device.
  await adoptKey(session, logged.collection_key, logged.key_epoch);
  // Pin the accepted posture now the sign-in has succeeded, so a later visit
  // catches a server that has weakened itself. This is the single funnel every
  // authenticated flow passes through, mirroring the native client.
  saveServerPosture(root, posture);
  log.info("signed in", {
    key_epoch: session.keyEpoch,
    latest_revision: session.latestRevision,
    recovery_pending: session.recoveryPending === true,
    ms: elapsed(loginStarted),
  });
  if (session.rosterLacksKeyCommitment) {
    log.warn("the account's roster predates key commitments; a rotation upgrades it");
  }
  if (session.recoveryPending) {
    log.warn(
      "a recovery is unfinished, so the phrase used for it still opens this vault and " +
        "writes are refused until it is rotated",
    );
  }
  return session;
}

export async function revokeSession(session: Session): Promise<void> {
  await deleteJson(`${apiRoot(session.state.server)}/v1/session`, session.token);
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
  // Begin registering the replacement password, so the server can answer with
  // the OPRF evaluation this needs in the same round trip.
  const opaque = coreOpaqueRegisterStart(password);
  const started = coreRecoverStartAccept(
    phrase,
    await post(root, coreRecoverStartRequest(username, phrase, opaque.request)),
  );
  const upload = coreOpaqueRegisterUpload(opaque.state, password, started.opaque_response);
  const device = coreNewDevice();
  const recovering = coreRecoverFinishRequest(
    username,
    phrase,
    password,
    started,
    device,
    upload,
  );
  const finished = await post(root, recovering.request);
  // Pinned from the roster this device signed with the phrase, so its first
  // fetch has to be a step from a roster it has already checked.
  const state = fromCoreState(
    coreRecoverAccept(root, username, started, device, recovering, finished),
  );
  const session = await loginAccount(state, password);
  // The phrase just used would otherwise keep working, and so would any copy of
  // it someone else kept: enrolling a device does not change the key the phrase
  // unwraps. Rotate, which issues a fresh phrase and retires the old one. Until
  // it finishes the server reports `recovery_pending` and refuses writes.
  return rotateVault(session, null, password);
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

async function accountChallenge(session: Session): Promise<string> {
  return post(apiRoot(session.state.server), coreAccountChallengeRequest(), session.token);
}

export async function changeUsername(
  session: Session,
  newUsername: string,
  currentPassword: string,
): Promise<Session> {
  // Signing in first is what proves the user holds the password rather than
  // only a session token.
  const fresh = await loginAccount(session.state, currentPassword);
  const root = apiRoot(fresh.state.server);
  // The OPAQUE record is bound to the username, so the password has to be
  // registered again under the new one.
  const opaque = coreOpaqueRegisterStart(currentPassword);
  const started = coreRegisterStartAccept(
    await post(root, coreRegisterStartRequest(newUsername, opaque.request)),
  );
  const upload = coreOpaqueRegisterUpload(opaque.state, currentPassword, started);
  await post(
    root,
    coreChangeUsernameRequest(
      toCoreState(fresh.state),
      newUsername,
      upload,
      await accountChallenge(fresh),
    ),
    fresh.token,
  );
  return loginAccount(
    { ...fresh.state, username: coreNormalizeUsername(newUsername) },
    currentPassword,
  );
}

export async function changePassword(
  session: Session,
  currentPassword: string,
  newPassword: string,
): Promise<Session> {
  const fresh = await loginAccount(session.state, currentPassword);
  const root = apiRoot(fresh.state.server);
  const opaque = coreOpaqueRegisterStart(newPassword);
  const started = corePasswordChangeStartAccept(
    await post(root, corePasswordChangeStartRequest(opaque.request), fresh.token),
  );
  const upload = coreOpaqueRegisterUpload(opaque.state, newPassword, started.opaque_response);
  // The signature covers the replacement recovery wrap as well as the new
  // verifier, so nobody holding only a token can swap in key material the account
  // holder never produced and quietly destroy password-based recovery.
  const changed = coreChangePasswordRequest(
    toCoreState(fresh.state),
    fresh.collectionKey,
    newPassword,
    upload,
    started,
  );
  await post(root, changed.request, fresh.token);
  return loginAccount(
    { ...fresh.state, kdf_salt: b64ToByteArray(changed.kdf_salt) },
    newPassword,
  );
}

export async function deleteAccount(session: Session, currentPassword: string): Promise<void> {
  const fresh = await loginAccount(session.state, currentPassword);
  const root = apiRoot(fresh.state.server);
  const request = coreDeleteAccountRequest(
    toCoreState(fresh.state),
    await accountChallenge(fresh),
  );
  await deleteJson<{ status: string }>(
    `${root}${request.path}`,
    fresh.token,
    JSON.parse(request.body) as Record<string, unknown>,
  );
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

/**
 * Replaces the vault key and re-encrypts everything under it.
 *
 * One path for every operation that has to invalidate the old key, because they
 * all need the same work: revoking a device that already holds it, changing the
 * recovery phrase, and finishing a recovery, where the phrase just used, and any
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
