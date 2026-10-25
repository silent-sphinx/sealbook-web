import { b64ToByteArray, bytesFromJson } from "./bytes";
import {
  accountOpSign,
  createDevice,
  createEnrollment,
  loginStartProof,
  coreManifestSign,
  opaqueLoginFinish,
  opaqueLoginStart,
  opaqueRegisterFinish,
  opaqueRegisterStart,
  phraseLookupId,
  phraseRecovery,
  phraseRecoveryProof,
  rosterSealPhrase,
  rosterSealDevice,
  rosterVerify,
  unwrapCk,
  unwrapPhrase,
  wrapCkForDevice,
  wrapCkForPassword,
  newUuid,
} from "./wasm";
import { elapsed, log } from "./log";
import { ManifestError, syncRoster } from "./roster";
import { apiRoot, deleteJson, postJson } from "./transport";
import {
  checkProtocol,
  deviceBody,
  deviceFromEnrollment,
  deviceFromKeys,
  enrollSig,
  rememberManifestSeq,
  type Session,
} from "./clientCore";
import { rotateAuthenticated } from "./clientRotation";
import type {
  DevicePublic,
  DeviceState,
  Enrollment,
  KeyWrap,
  ManifestBody,
  Roster,
} from "./types";

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
      manifest: JSON.parse(
        coreManifestSign(
          enrollment.mldsa_seed,
          enrollment.ed25519_sk,
          { collection_id: collectionId, device_id: enrollment.device_id, manifest_seq: 0 },
          { manifest_seq: 1, key_epoch: 1, latest_revision: 0 },
          [],
        ).manifest_json,
      ) as ManifestBody,
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
 * recovery phrase, and finishing a recovery -- where the phrase just used, and any
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
