import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import init from "../pkg/sealbook_wasm.js";
import {
  coreAccountChallengeRequest,
  coreChangePasswordRequest,
  coreChangeUsernameRequest,
  coreDeleteAccountRequest,
  coreErrorOf,
  coreLoginAccept,
  coreLoginChallengeRequest,
  coreNewDevice,
  coreNewRegistration,
  coreNormalizePhrase,
  coreNormalizeUsername,
  corePasswordChangeStartRequest,
  coreRecoverFinishRequest,
  coreRecoverStartAccept,
  coreRecoverStartRequest,
  coreRegisterAccept,
  coreRegisterFinishRequest,
  coreRegisterStartRequest,
} from "./wasm";
import { friendlyError } from "./errors";
import { readFixture } from "../test/fixtures";
import type {
  CoreDeviceSecrets,
  CoreDeviceState,
  PasswordChangeStarted,
  RegisterIdentity,
} from "../pkg/sealbook_wasm.js";

/**
 * The shared authentication fixture, through the same core the CLI and Android
 * run.
 *
 * Held to the same document as `sealbook-core/tests/auth.rs` and Android's
 * `AccountAuthTest`, so a sign-in, a recovery or an account change that differs
 * here differs from the other two clients rather than from a copy of their
 * output.
 */
beforeAll(async () => {
  const wasm = readFileSync(new URL("../pkg/sealbook_wasm_bg.wasm", import.meta.url));
  await init({ module_or_path: wasm });
});

type UsernameCase = { typed: string; normalized: string; refused: boolean };
type PhraseCase = { typed: string; normalized: string; refused: boolean };
type PathCase = { what: string; path: string };
type LoginCase = { what: string; body: string; wrap: string; recovery_pending: boolean };
type RefusalCase = {
  what: string;
  flow: string;
  body: string;
  refusal: { refusal: string } & Record<string, unknown>;
};

type Fixture = {
  account_id: string;
  collection_id: string;
  collection_key: string;
  password: string;
  phrase: string;
  device: CoreDeviceSecrets;
  state: CoreDeviceState;
  recover_start: string;
  usernames: UsernameCase[];
  phrases: PhraseCase[];
  paths: PathCase[];
  logins: LoginCase[];
  refusals: RefusalCase[];
};

const fixture = JSON.parse(readFixture("auth/account.json")) as Fixture;

function pathFor(what: string): string {
  const found = fixture.paths.find((entry) => entry.what === what);
  if (!found) throw new Error(`no path for ${what}`);
  return found.path;
}

/** The registration this fixture's device would have made. */
function identity(): RegisterIdentity {
  return {
    device: fixture.device,
    collection_id: fixture.collection_id,
    collection_key: fixture.collection_key,
    kdf_salt: b64(fixture.state.kdf_salt),
    phrase: fixture.phrase,
  };
}

function b64(bytes: number[]): string {
  let bin = "";
  for (const byte of bytes) {
    bin += String.fromCharCode(byte);
  }
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function refusalName(err: unknown): string {
  const core = coreErrorOf(err);
  if (core?.kind !== "Auth") {
    throw new Error(`expected an auth refusal, got ${JSON.stringify(core)}`);
  }
  return (core.refusal as { refusal: string }).refusal;
}

function refusalOf(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    return refusalName(err);
  }
  throw new Error("expected a refusal");
}

const CHALLENGE = JSON.stringify({
  challenge_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  challenge: b64(new Array<number>(32).fill(5)),
});

const PASSWORD_START: PasswordChangeStarted = {
  password_change_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  challenge: b64(new Array<number>(32).fill(6)),
  opaque_response: b64([1, 2, 3]),
};

describe("what the user typed", () => {
  it("sends a username the way the fixture names it", () => {
    // What core did with it, either way, so the refusal and the accepted name
    // are one assertion rather than a branch inside the loop.
    const sent = (typed: string): string => {
      try {
        const body = JSON.parse(coreRegisterStartRequest(typed, b64([1, 2])).body) as {
          username: string;
        };
        return body.username;
      } catch (err) {
        return refusalName(err);
      }
    };
    for (const entry of fixture.usernames) {
      expect(coreNormalizeUsername(entry.typed)).toBe(entry.normalized);
      expect(sent(entry.typed)).toBe(entry.refused ? "Username" : entry.normalized);
    }
  });

  it("derives from a phrase the way the fixture names it", () => {
    const canonical = JSON.parse(
      coreRecoverStartRequest("alice", fixture.phrase, b64([1, 2])).body,
    ) as { lookup_id: string };
    // Every spelling of the same phrase reaches the same lookup id, which is
    // what the server matches on.
    const lookup = (typed: string): string => {
      try {
        const body = JSON.parse(
          coreRecoverStartRequest("alice", typed, b64([1, 2])).body,
        ) as { lookup_id: string };
        return body.lookup_id;
      } catch (err) {
        return refusalName(err);
      }
    };
    for (const entry of fixture.phrases) {
      expect(coreNormalizePhrase(entry.typed)).toBe(entry.normalized);
      expect(lookup(entry.typed)).toBe(entry.refused ? "Phrase" : canonical.lookup_id);
    }
  });
});

describe("the paths", () => {
  it("posts each round where the fixture says", () => {
    expect(coreRegisterStartRequest("alice", b64([1])).path).toBe(pathFor("register start"));
    expect(
      coreRegisterFinishRequest("alice", fixture.password, b64([1]), identity()).request.path,
    ).toBe(pathFor("register finish"));
    expect(coreLoginChallengeRequest("alice", fixture.state.device_id).path).toBe(
      pathFor("login challenge"),
    );
    expect(coreRecoverStartRequest("alice", fixture.phrase, b64([1])).path).toBe(
      pathFor("recover start"),
    );
    expect(coreAccountChallengeRequest().path).toBe(pathFor("account challenge"));
    expect(corePasswordChangeStartRequest(b64([1])).path).toBe(
      pathFor("password change start"),
    );
    expect(coreChangeUsernameRequest(fixture.state, "bob", b64([1]), CHALLENGE).path).toBe(
      pathFor("username change"),
    );
    expect(coreDeleteAccountRequest(fixture.state, CHALLENGE).path).toBe(
      pathFor("account delete"),
    );
    expect(
      coreChangePasswordRequest(
        fixture.state,
        fixture.collection_key,
        "a new password",
        b64([1]),
        PASSWORD_START,
      ).request.path,
    ).toBe(pathFor("password change"));
  });
});

describe("registering", () => {
  it("pins the genesis roster it signed", () => {
    const registering = coreRegisterFinishRequest(
      "alice",
      fixture.password,
      b64([1]),
      identity(),
    );
    const body = JSON.parse(registering.request.body) as {
      roster: { roster_seq: number; key_epoch: number };
      key_wraps: { recipient_kind: string; recipient_id: string }[];
    };
    expect(body.roster.roster_seq).toBe(1);
    expect(body.roster.key_epoch).toBe(1);
    expect(registering.pin.roster_seq).toBe(1);
    // One wrap the device opens, one the password opens and one the phrase
    // opens, so losing any single one of the three is survivable.
    expect(body.key_wraps.map((wrap) => wrap.recipient_kind)).toEqual([
      "device",
      "recovery",
      "phrase",
    ]);
    expect(body.key_wraps[1].recipient_id).toBe("alice");
  });

  /**
   * The genesis roster and the first manifest are signed over the collection
   * this device chose, so an account built on a different id has nothing it can
   * check. Taking the server's id and carrying on is what this used to do.
   */
  it("refuses a collection the server substituted", () => {
    const chosen = identity();
    const registering = coreRegisterFinishRequest(
      "alice",
      fixture.password,
      b64([1]),
      chosen,
    );
    const elsewhere = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    expect(
      refusalOf(() =>
        coreRegisterAccept(
          "https://vault.example",
          "alice",
          chosen,
          registering.pin,
          JSON.stringify({ account_id: fixture.account_id, collection_id: elsewhere }),
        ),
      ),
    ).toBe("CollectionMoved");
  });
});

describe("signing in", () => {
  it("opens the wrap the fixture names and reports what it found", () => {
    for (const entry of fixture.logins) {
      const logged = coreLoginAccept(fixture.state, fixture.password, entry.body);
      expect(logged.collection_key).toBe(fixture.collection_key);
      expect(logged.recovery_pending).toBe(entry.recovery_pending);
      const served = JSON.parse(entry.body) as {
        key_wraps: { recipient_kind: string }[];
      };
      const has = served.key_wraps.some((wrap) => wrap.recipient_kind === "device");
      expect(has ? "device" : "recovery").toBe(entry.wrap);
    }
  });

  /**
   * A login replaces the account, collection, salt and token this device holds,
   * and leaves its own memory of the roster and the manifest alone.
   */
  it("persists what the server confirmed and nothing else", () => {
    const entry = fixture.logins[0];
    const logged = coreLoginAccept(fixture.state, fixture.password, entry.body);
    const served = JSON.parse(entry.body) as { session_token: string; key_epoch: number };
    expect(logged.state.session_token).toBe(served.session_token);
    expect(logged.key_epoch).toBe(served.key_epoch);
    expect(logged.state.roster_seq).toBe(fixture.state.roster_seq);
    expect(logged.state.manifest_seq).toBe(fixture.state.manifest_seq);
    expect(logged.state.device_id).toBe(fixture.state.device_id);
  });
});

describe("recovering", () => {
  it("verifies the roster under the key the phrase opened", () => {
    const started = coreRecoverStartAccept(fixture.phrase, fixture.recover_start);
    expect(started.collection_id).toBe(fixture.collection_id);
    expect(started.collection_key).toBe(fixture.collection_key);
    expect(started.roster.devices.length).toBe(2);
    // Filled in from the phrase, never taken from the server, which strips them.
    expect(started.roster.phrase_mldsa_pk).not.toBe("");
  });

  it("accepts the phrase in every spelling of it", () => {
    for (const typed of [
      fixture.phrase,
      fixture.phrase.toUpperCase(),
      fixture.phrase.replaceAll(" ", "   "),
    ]) {
      expect(coreRecoverStartAccept(typed, fixture.recover_start).collection_key).toBe(
        fixture.collection_key,
      );
    }
  });

  /** The recovering device has no enrolled key, so the phrase signs for it. */
  it("signs the roster step with the phrase and pins it", () => {
    const started = coreRecoverStartAccept(fixture.phrase, fixture.recover_start);
    const device = coreNewDevice();
    const recovering = coreRecoverFinishRequest(
      "alice",
      fixture.phrase,
      "a new password",
      started,
      device,
      b64([1]),
    );
    const body = JSON.parse(recovering.request.body) as {
      roster: { roster_seq: number; signer: { kind: string }; devices: { device_id: string }[] };
    };
    expect(body.roster.signer.kind).toBe("phrase");
    expect(body.roster.roster_seq).toBe(started.roster.roster_seq + 1);
    expect(body.roster.devices.length).toBe(started.roster.devices.length + 1);
    expect(recovering.pin.roster_seq).toBe(body.roster.roster_seq);
  });
});

describe("account operations", () => {
  it("renames with the new verifier and a signature over both", () => {
    const body = JSON.parse(
      coreChangeUsernameRequest(fixture.state, "  bob.smith ", b64([1, 2]), CHALLENGE).body,
    ) as { new_username: string; signature: { mldsa: string } };
    expect(body.new_username).toBe("bob.smith");
    expect(body.signature.mldsa.length).toBeGreaterThan(0);
  });

  /**
   * The signature covers the replacement recovery wrap as well as the new
   * verifier, so nobody holding only a token can swap in key material the
   * account holder never produced.
   */
  it("sends a fresh wrap on a password change and signs over it", () => {
    const changed = coreChangePasswordRequest(
      fixture.state,
      fixture.collection_key,
      "a new password",
      b64([1, 2]),
      PASSWORD_START,
    );
    const body = JSON.parse(changed.request.body) as {
      kdf_salt: string;
      recovery_nonce: string;
      signature: { mldsa: string };
    };
    expect(body.kdf_salt).toBe(changed.kdf_salt);
    expect(body.kdf_salt).not.toBe(b64(fixture.state.kdf_salt));
    expect(body.signature.mldsa.length).toBeGreaterThan(0);
  });

  it("signs a deletion over the server's challenge", () => {
    const body = JSON.parse(coreDeleteAccountRequest(fixture.state, CHALLENGE).body) as {
      challenge_id: string;
      signature: { mldsa: string };
    };
    expect(body.challenge_id).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
    expect(body.signature.mldsa.length).toBeGreaterThan(0);
  });
});

describe("the refusals", () => {
  it("raises what the fixture names", () => {
    for (const entry of fixture.refusals) {
      const run =
        entry.flow === "recover start accept"
          ? () => coreRecoverStartAccept(fixture.phrase, entry.body)
          : () => coreLoginAccept(fixture.state, fixture.password, entry.body);
      expect(refusalOf(run)).toBe(entry.refusal.refusal);
    }
  });

  /**
   * A phrase that is not this account's is named as that, rather than reported
   * as a key or roster failure. A lookup that matched nothing gets the same
   * answer, which is what the decoy is for.
   */
  it("says a wrong phrase is the phrase", () => {
    const other = coreNewRegistration().phrase;
    expect(refusalOf(() => coreRecoverStartAccept(other, fixture.recover_start))).toBe(
      "PhraseMismatch",
    );
  });

  /** Each refusal reaches the user as this app's own sentence, not as JSON. */
  it("words every refusal the fixture names", () => {
    for (const entry of fixture.refusals) {
      const message = friendlyError(
        new Error(JSON.stringify({ kind: "Auth", refusal: entry.refusal })),
      );
      expect(message).not.toContain("{");
      expect(message.length).toBeGreaterThan(10);
    }
  });
});
