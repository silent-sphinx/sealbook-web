import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import init from "../pkg/sealbook_wasm.js";
import {
  ensureDefaultCalendar,
  exportVault,
  genesisRoster,
  listVault,
  normalizeServer,
  pairApprove,
  pairPreview,
  putAccountSettings,
  putContact,
  rotateAuthenticated,
  RosterTooOldError,
  ServerUnreachableError,
  splitForRotation,
  syncRoster,
  verifiedRoster,
  type Session,
} from "./client";
import { b64ToByteArray } from "./bytes";
import {
  createDevice,
  createEnrollment,
  manifestSign,
  newCollectionKey,
  newUuid,
  objectContentDigest,
  openObject,
  pairConfirmationCode,
  rosterSealDevice,
  rosterVerify,
  sealObject,
  sealedContentType,
  wrapCkForDevice,
} from "./wasm";
import { DEFAULT_ADDRESS_BOOK_ID, JSCONTACT_CONTENT_TYPE } from "./addressBook";
import { DEFAULT_CALENDAR_ID } from "./calendar";
import { NOTE_CONTENT_TYPE } from "./note";
import {
  ACCOUNT_SETTINGS_CONTENT_TYPE,
  ACCOUNT_SETTINGS_ID,
  DEFAULT_ACCOUNT_SETTINGS,
  LEGACY_ACCOUNT_SETTINGS_ID,
  parseAccountSettings,
  serializeAccountSettings,
} from "./accountSettings";
import { emptyDraft } from "./contact";
import type {
  DeviceOut,
  DevicePublic,
  DeviceState,
  Enrollment,
  ManifestBody,
  ManifestEntry,
  Roster,
  SealedObject,
} from "./types";

// The crypto is the same Rust the server runs, so a roster this suite seals and
// verifies is one the server would accept or refuse the same way. That is the
// point of testing against the real module rather than a stub: the checks that
// matter here are exactly the ones `roster.rs` makes.
beforeAll(async () => {
  const wasm = readFileSync(new URL("../pkg/sealbook_wasm_bg.wasm", import.meta.url));
  await init({ module_or_path: wasm });
});

const SERVER = "http://localhost:9999";
const PASSWORD = "correct horse battery";

type Account = {
  enrollment: Enrollment;
  collectionId: string;
  roster: Roster;
  session: Session;
};

function deviceKeys(device: DeviceOut): DevicePublic {
  return {
    device_id: device.device_id,
    mldsa_pk: device.mldsa_pk,
    ed25519_pk: device.ed25519_pk,
    xwing_hpke_pk: device.hpke_pk,
  };
}

/** A registered account, as it stands after `registerAccount` and a login. */
function account(): Account {
  const enrollment = createEnrollment(PASSWORD);
  const collectionId = newUuid();
  const roster = genesisRoster(collectionId, enrollment);
  const pin = rosterVerify(
    collectionId,
    0,
    "",
    [roster],
    enrollment.collection_key,
    1,
    enrollment.device_id,
  );
  const state: DeviceState = {
    server: SERVER,
    username: "alice",
    account_id: newUuid(),
    collection_id: collectionId,
    device_id: enrollment.device_id,
    session_token: "token",
    kdf_salt: b64ToByteArray(enrollment.kdf_salt),
    hpke_sk: b64ToByteArray(enrollment.hpke_sk),
    mldsa_seed: b64ToByteArray(enrollment.mldsa_seed),
    ed25519_sk: b64ToByteArray(enrollment.ed25519_sk),
    manifest_seq: 1,
    roster_seq: pin.pin_seq,
    roster_transcript: pin.pin_transcript,
  };
  return {
    enrollment,
    collectionId,
    roster,
    session: {
      state,
      collectionKey: enrollment.collection_key,
      token: "token",
      latestRevision: 0,
      keyEpoch: 1,
      manifestSeq: 1,
      roster,
    },
  };
}

type Handler = (url: URL, body: unknown) => unknown;

/** Records what the client sent and answers the routes a flow touches. */
function server(routes: Record<string, Handler>) {
  const sent: Record<string, unknown> = {};
  const fetchMock = vi.fn(async (input: string, options?: RequestInit) => {
    const url = new URL(input);
    const body = options?.body ? (JSON.parse(options.body as string) as unknown) : undefined;
    const key = Object.keys(routes).find((route) => url.pathname.endsWith(route));
    if (!key) {
      throw new Error(`no mock route for ${url.pathname}`);
    }
    sent[key] = body;
    // Awaited, so a route can hold its answer open the way a slow read does.
    const answer = await routes[key](url, body);
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { sent, fetchMock };
}

describe("splitForRotation", () => {
  const object = (id: string, revision: number, tombstone: boolean): SealedObject => ({
    id,
    revision,
    tombstone,
    nonce: "",
    ciphertext: "",
    padded_size: 0,
    content_type: sealedContentType(),
  });

  it("re-encrypts the live objects and carries the reachable tombstones", () => {
    const split = splitForRotation(
      [object("a", 9, false), object("b", 4, true), object("c", 7, true)],
      5,
    );
    expect(split.live.map((entry) => entry.id)).toEqual(["a"]);
    // Above the floor: a lagging device can still be told about this delete
    // incrementally, so the manifest has to keep describing the row.
    expect(split.tombstones.map((entry) => entry.id)).toEqual(["c"]);
    // Below it: no incremental answer can carry the delete any more, so the row
    // has done its job and this rotation is what retires it.
    expect(split.retired).toEqual(["b"]);
  });

  it("retires nothing when the server reports no floor", () => {
    const split = splitForRotation([object("a", 1, true)], 0);
    expect(split.retired).toEqual([]);
    expect(split.tombstones.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("the genesis roster", () => {
  it("is one device, signed by itself, that verifies under the collection key", () => {
    const { enrollment, collectionId, roster } = account();
    expect(roster.roster_seq).toBe(1);
    expect(roster.key_epoch).toBe(1);
    expect(roster.devices.map((device) => device.device_id)).toEqual([enrollment.device_id]);
    expect(roster.signer).toEqual({ kind: "device", device_id: enrollment.device_id });
    // The same check the server makes before storing it.
    const verified = rosterVerify(
      collectionId,
      0,
      "",
      [roster],
      enrollment.collection_key,
      1,
      enrollment.device_id,
    );
    expect(verified.pin_seq).toBe(1);
  });

  it("is refused when its MAC was not made with the collection key", () => {
    const { enrollment, collectionId, roster } = account();
    const forged: Roster = { ...roster, mac: roster.mac.replace(/^./u, (c) => (c === "A" ? "B" : "A")) };
    expect(() =>
      rosterVerify(collectionId, 0, "", [forged], enrollment.collection_key, 1, enrollment.device_id),
    ).toThrow();
  });
});

describe("verifiedRoster", () => {
  it("refuses a roster history that does not start at the pinned roster", async () => {
    const { session, collectionId, enrollment } = account();
    // A roster of the server's own making, with a device it added. It is not a
    // step from anything this device pinned, which is the whole check.
    const intruder = createDevice();
    const forged: Roster = {
      ...session.roster!,
      roster_seq: 2,
      devices: [...session.roster!.devices, deviceKeys(intruder)],
    };
    server({ "/roster": () => ({ rosters: [forged] }) });
    await expect(verifiedRoster(session)).rejects.toThrow();
    // And the honest history is accepted, so the refusal above is about the
    // forgery rather than about the request shape.
    server({ "/roster": () => ({ rosters: [session.roster] }) });
    const roster = await verifiedRoster(session);
    expect(roster.devices.map((device) => device.device_id)).toEqual([enrollment.device_id]);
    expect(collectionId).toBeTruthy();
  });
});

describe("a pin below the server's retention floor", () => {
  it("refuses, and says to pair the device again rather than crying tamper", async () => {
    const { session } = account();
    // The server keeps a bounded history, so the chain back to this pin is gone.
    server({ "/roster": () => ({ rosters: [session.roster], floor: 9 }) });
    await expect(verifiedRoster(session)).rejects.toThrow(RosterTooOldError);
    await expect(verifiedRoster(session)).rejects.toThrow(/pair this device again/iu);
  });

  it("accepts a floor at or below the pin, and a server that reports none", async () => {
    const { session } = account();
    server({ "/roster": () => ({ rosters: [session.roster], floor: 1 }) });
    expect((await verifiedRoster(session)).roster_seq).toBe(1);
    // An older server does not send the field at all.
    server({ "/roster": () => ({ rosters: [session.roster] }) });
    expect((await verifiedRoster(session)).roster_seq).toBe(1);
  });
});

describe("syncRoster", () => {
  it("accepts a roster from a rotation this device has not caught up with", async () => {
    const { session, collectionId, enrollment } = account();
    // A rotation on another device: the roster moves to the next sequence at the
    // next epoch, MAC'd under a collection key this session does not hold yet.
    const rotatedKey = newCollectionKey();
    const next = rosterSealDevice(
      collectionId,
      2,
      2,
      session.roster!.devices,
      session.roster!.phrase_mldsa_pk,
      session.roster!.phrase_ed25519_pk,
      enrollment.device_id,
      enrollment.mldsa_seed,
      enrollment.ed25519_sk,
      rotatedKey,
    );
    server({ "/roster": () => ({ rosters: [session.roster, next] }) });
    // The signed step from the pinned roster is what carries this, and it has
    // to: the MAC is keyed from the new epoch's key, which this device can only
    // fetch after it accepts that the epoch moved.
    const roster = await syncRoster(session);
    expect(roster.roster_seq).toBe(2);
    expect(session.state.roster_seq).toBe(2);
  });

  it("refuses to pin a roster older than the one it holds", async () => {
    const { session } = account();
    session.state.roster_seq = 5;
    server({ "/roster": () => ({ rosters: [session.roster] }) });
    await expect(syncRoster(session)).rejects.toThrow();
  });
});

describe("pairing approval", () => {
  /** The joining device, and the code it shows for the anchor it was served. */
  function joiner(approver: Account) {
    const device = createDevice();
    const pairId = newUuid();
    const anchor = {
      seq: approver.session.state.roster_seq!,
      transcript: approver.session.state.roster_transcript!,
    };
    const confirm = pairConfirmationCode(
      pairId,
      device.device_id,
      device.mldsa_pk,
      device.ed25519_pk,
      device.hpke_pk,
      anchor.seq,
      anchor.transcript,
    );
    return { device, pairId, confirm, anchor };
  }

  function pairRoutes(approver: Account, join: ReturnType<typeof joiner>, overrides?: {
    device?: DevicePublic;
    confirm?: string;
    rosterSeq?: number;
  }) {
    return server({
      "/roster": () => ({ rosters: [approver.roster] }),
      "/approve": () => ({ pair_id: join.pairId, status: "ready", confirm: join.confirm }),
      "/v1/pair/PAIRCODE": () => ({
        pair_id: join.pairId,
        status: "pending",
        confirm: overrides?.confirm ?? join.confirm,
        device: overrides?.device ?? deviceKeys(join.device),
        roster_seq: overrides?.rosterSeq ?? join.anchor.seq,
      }),
    });
  }

  it("signs the roster that adds the device and sends the code it computed", async () => {
    const approver = account();
    const join = joiner(approver);
    const { sent } = pairRoutes(approver, join);

    const preview = await pairPreview(approver.session, "PAIRCODE");
    // Computed here from a verified roster, not taken from the server, and it
    // comes out as the code the joining device is showing.
    expect(preview.confirm).toBe(join.confirm);

    const confirm = await pairApprove(approver.session, "PAIRCODE", preview, preview.confirm);
    expect(confirm).toBe(join.confirm);

    const body = sent["/approve"] as {
      roster: Roster;
      confirmation: string;
      grant: { mldsa: string; ed25519: string };
      wrap: { recipient_id: string };
    };
    expect(body.confirmation).toBe(join.confirm);
    expect(body.grant.mldsa.length).toBeGreaterThan(0);
    expect(body.wrap.recipient_id).toBe(join.device.device_id);
    expect(body.roster.roster_seq).toBe(2);
    expect(body.roster.devices.map((device) => device.device_id).sort()).toEqual(
      [approver.enrollment.device_id, join.device.device_id].sort(),
    );
    // The step has to verify from the roster the joining device anchored on,
    // which is what that device will check it against.
    const verified = rosterVerify(
      approver.collectionId,
      join.anchor.seq,
      join.anchor.transcript,
      [approver.roster, body.roster],
      approver.session.collectionKey,
      1,
      join.device.device_id,
    );
    expect(verified.pin_seq).toBe(2);
    // And the approver moves its own pin onto the roster it just signed.
    expect(approver.session.state.roster_seq).toBe(2);
  });

  it("refuses a preview whose device keys are not the ones the code covers", async () => {
    const approver = account();
    const join = joiner(approver);
    // A server substituting its own device keys while replaying the real code is
    // the attack the roster anchor closes: the code no longer recomputes.
    const intruder = createDevice();
    pairRoutes(approver, join, { device: deviceKeys(intruder) });
    await expect(pairPreview(approver.session, "PAIRCODE")).rejects.toThrow(/mismatch/iu);
  });

  it("refuses when the account's roster moved on while the pairing waited", async () => {
    const approver = account();
    const join = joiner(approver);
    // The joining device anchored on a roster that is no longer the current one,
    // so the two sides would fold different anchors into the code.
    pairRoutes(approver, join, { rosterSeq: join.anchor.seq + 1 });
    await expect(pairPreview(approver.session, "PAIRCODE")).rejects.toThrow(/pairing again/iu);
  });
});

/** One sealed contact, with the manifest a write of it would have signed. */
function vaultWith(owner: Account, signer: { seed: string; sk: string; deviceId: string }) {
  const id = newUuid();
  const sealed = sealObject(
    owner.session.collectionKey,
    id,
    owner.collectionId,
    JSCONTACT_CONTENT_TYPE,
    JSON.stringify({ "@type": "Card", name: { full: "Ada Lovelace" } }),
  );
  const object: SealedObject = {
    id,
    revision: 1,
    tombstone: false,
    nonce: sealed.nonce,
    ciphertext: sealed.ciphertext,
    padded_size: sealed.padded_size,
    content_type: sealedContentType(),
  };
  const entries: ManifestEntry[] = [
    {
      id,
      revision: 1,
      tombstone: false,
      content_digest: objectContentDigest(sealed.nonce, sealed.ciphertext),
    },
  ];
  const manifest = manifestSign(
    signer.seed,
    signer.sk,
    owner.collectionId,
    signer.deviceId,
    2,
    1,
    1,
    entries,
  );
  return { object, manifest };
}

/** Sealed objects of any types, with the manifest a write of them signed. */
function vaultOf(owner: Account, items: { id: string; contentType: string; payload: string }[]) {
  const objects: SealedObject[] = [];
  const entries: ManifestEntry[] = [];
  for (const [index, item] of items.entries()) {
    const sealed = sealObject(
      owner.session.collectionKey,
      item.id,
      owner.collectionId,
      item.contentType,
      item.payload,
    );
    const revision = index + 1;
    objects.push({
      id: item.id,
      revision,
      tombstone: false,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
      padded_size: sealed.padded_size,
      content_type: sealedContentType(),
    });
    entries.push({
      id: item.id,
      revision,
      tombstone: false,
      content_digest: objectContentDigest(sealed.nonce, sealed.ciphertext),
    });
  }
  const manifest = manifestSign(
    owner.enrollment.mldsa_seed,
    owner.enrollment.ed25519_sk,
    owner.collectionId,
    owner.enrollment.device_id,
    2,
    items.length,
    items.length,
    entries,
  );
  return { objects, manifest, revision: items.length };
}

/** One sealed object of any type, with the manifest a write of it signed. */
function vaultHolding(
  owner: Account,
  contentType: string,
  payload: string,
  id = ACCOUNT_SETTINGS_ID,
) {
  const { objects, manifest } = vaultOf(owner, [{ id, contentType, payload }]);
  return { object: objects[0]!, manifest };
}

describe("listVault", () => {
  it("opens a vault whose manifest was signed by a device in the roster", async () => {
    const owner = account();
    const { object, manifest } = vaultWith(owner, {
      seed: owner.enrollment.mldsa_seed,
      sk: owner.enrollment.ed25519_sk,
      deviceId: owner.enrollment.device_id,
    });
    server({
      "/changes": () => ({
        latest_revision: 1,
        key_epoch: 1,
        objects: [object],
        has_more: false,
        manifest,
        resync: false,
        tombstone_floor: 1,
      }),
      "/roster": () => ({ rosters: [owner.roster] }),
    });
    const listed = await listVault(owner.session);
    expect(listed.contacts.map((contact) => contact.name)).toEqual(["Ada Lovelace"]);
  });

  it("counts the rows it could not open instead of returning a shorter vault", async () => {
    const owner = account();
    const objects: SealedObject[] = [];
    const entries: ManifestEntry[] = [];
    // The second row is sealed under a key this device does not hold, which is
    // what a key epoch the refresh did not resolve, or corruption, looks like
    // from here: the manifest still commits to exactly what was served.
    const keys = [owner.session.collectionKey, newCollectionKey()];
    for (const [index, key] of keys.entries()) {
      const id = newUuid();
      const sealed = sealObject(
        key,
        id,
        owner.collectionId,
        JSCONTACT_CONTENT_TYPE,
        JSON.stringify({ "@type": "Card", name: { full: index === 0 ? "Ada Lovelace" : "Unreadable" } }),
      );
      objects.push({
        id,
        revision: index + 1,
        tombstone: false,
        nonce: sealed.nonce,
        ciphertext: sealed.ciphertext,
        padded_size: sealed.padded_size,
        content_type: sealedContentType(),
      });
      entries.push({
        id,
        revision: index + 1,
        tombstone: false,
        content_digest: objectContentDigest(sealed.nonce, sealed.ciphertext),
      });
    }
    const manifest = manifestSign(
      owner.enrollment.mldsa_seed,
      owner.enrollment.ed25519_sk,
      owner.collectionId,
      owner.enrollment.device_id,
      2,
      1,
      2,
      entries,
    );
    server({
      "/changes": () => ({
        latest_revision: 2,
        key_epoch: 1,
        objects,
        has_more: false,
        manifest,
        resync: false,
        tombstone_floor: 1,
      }),
      "/roster": () => ({ rosters: [owner.roster] }),
    });

    const listed = await listVault(owner.session);
    expect(listed.contacts.map((contact) => contact.name)).toEqual(["Ada Lovelace"]);
    expect(listed.unopened).toBe(1);
  });

  it("reports nothing unopened for a vault it can read whole", async () => {
    const owner = account();
    const { object, manifest } = vaultWith(owner, {
      seed: owner.enrollment.mldsa_seed,
      sk: owner.enrollment.ed25519_sk,
      deviceId: owner.enrollment.device_id,
    });
    server({
      "/changes": () => ({
        latest_revision: 1,
        key_epoch: 1,
        objects: [object],
        has_more: false,
        manifest,
        resync: false,
        tombstone_floor: 1,
      }),
      "/roster": () => ({ rosters: [owner.roster] }),
    });
    expect((await listVault(owner.session)).unopened).toBe(0);
  });

  /** Two sealed contacts and the manifest a write of both would have signed. */
  function twoPageVault(owner: Account) {
    const objects: SealedObject[] = [];
    const entries: ManifestEntry[] = [];
    for (const [index, name] of ["Ada Lovelace", "Grace Hopper"].entries()) {
      const id = newUuid();
      const sealed = sealObject(
        owner.session.collectionKey,
        id,
        owner.collectionId,
        JSCONTACT_CONTENT_TYPE,
        JSON.stringify({ "@type": "Card", name: { full: name } }),
      );
      const revision = index + 1;
      objects.push({
        id,
        revision,
        tombstone: false,
        nonce: sealed.nonce,
        ciphertext: sealed.ciphertext,
        padded_size: sealed.padded_size,
        content_type: sealedContentType(),
      });
      entries.push({
        id,
        revision,
        tombstone: false,
        content_digest: objectContentDigest(sealed.nonce, sealed.ciphertext),
      });
    }
    const manifest = manifestSign(
      owner.enrollment.mldsa_seed,
      owner.enrollment.ed25519_sk,
      owner.collectionId,
      owner.enrollment.device_id,
      2,
      2,
      2,
      entries,
    );
    return { objects, manifest };
  }

  it("reads the account's feature toggles out of the sealed settings object", async () => {
    const owner = account();
    const { object, manifest } = vaultHolding(
      owner,
      ACCOUNT_SETTINGS_CONTENT_TYPE,
      serializeAccountSettings({
        features: { contacts: true, calendar: false, notes: false, bookmarks: true },
        contactMode: "basic",
        accent: "blue",
      }),
    );
    server({
      "/changes": () => ({
        latest_revision: 1,
        key_epoch: 1,
        objects: [object],
        has_more: false,
        manifest,
        resync: false,
        tombstone_floor: 1,
      }),
      "/roster": () => ({ rosters: [owner.roster] }),
    });
    const listed = await listVault(owner.session);
    expect(listed.accountSettings.features).toEqual({
      contacts: true,
      calendar: false,
      notes: false,
      bookmarks: true,
    });
    // The settings are not data: they must not turn up as a contact or a
    // container, which is what the type dispatch is there to prevent.
    expect(listed.contacts).toEqual([]);
    expect(listed.notebooks).toEqual([]);
    expect(listed.bookmarkCollections).toEqual([]);
  });

  it("defaults to every feature enabled when the account has no settings object", async () => {
    const owner = account();
    const { object, manifest } = vaultWith(owner, {
      seed: owner.enrollment.mldsa_seed,
      sk: owner.enrollment.ed25519_sk,
      deviceId: owner.enrollment.device_id,
    });
    server({
      "/changes": () => ({
        latest_revision: 1,
        key_epoch: 1,
        objects: [object],
        has_more: false,
        manifest,
        resync: false,
        tombstone_floor: 1,
      }),
      "/roster": () => ({ rosters: [owner.roster] }),
    });
    const listed = await listVault(owner.session);
    expect(listed.accountSettings).toEqual(DEFAULT_ACCOUNT_SETTINGS);
  });

  it("still reads settings an older build left at the default calendar's id", async () => {
    const owner = account();
    const { object, manifest } = vaultHolding(
      owner,
      ACCOUNT_SETTINGS_CONTENT_TYPE,
      serializeAccountSettings({
        features: { contacts: true, calendar: true, notes: false, bookmarks: true },
        contactMode: "detailed",
        accent: "rose",
      }),
      LEGACY_ACCOUNT_SETTINGS_ID,
    );
    server({
      "/changes": () => ({
        latest_revision: 1,
        key_epoch: 1,
        objects: [object],
        has_more: false,
        manifest,
        resync: false,
        tombstone_floor: 1,
      }),
      "/roster": () => ({ rosters: [owner.roster] }),
    });
    const listed = await listVault(owner.session);
    expect(listed.accountSettingsId).toBe(LEGACY_ACCOUNT_SETTINGS_ID);
    expect(listed.accountSettings.contactMode).toBe("detailed");
    expect(listed.accountSettings.accent).toBe("rose");
  });

  // Both copies exist between the upgrade and the next save, and the load order
  // is the server's, so the winner cannot be whichever is read last.
  for (const legacyFirst of [false, true]) {
    it(`prefers the canonical settings object with the legacy copy ${
      legacyFirst ? "ahead of" : "behind"
    } it`, async () => {
      const owner = account();
      const canonical = {
        id: ACCOUNT_SETTINGS_ID,
        contentType: ACCOUNT_SETTINGS_CONTENT_TYPE,
        payload: serializeAccountSettings({
          features: { contacts: true, calendar: true, notes: true, bookmarks: true },
          contactMode: "basic",
          accent: "green",
        }),
      };
      const legacy = {
        id: LEGACY_ACCOUNT_SETTINGS_ID,
        contentType: ACCOUNT_SETTINGS_CONTENT_TYPE,
        payload: serializeAccountSettings({
          features: { contacts: true, calendar: true, notes: false, bookmarks: true },
          contactMode: "detailed",
          accent: "rose",
        }),
      };
      const { objects, manifest, revision } = vaultOf(
        owner,
        legacyFirst ? [legacy, canonical] : [canonical, legacy],
      );
      server({
        "/changes": () => ({
          latest_revision: revision,
          key_epoch: 1,
          objects,
          has_more: false,
          manifest,
          resync: false,
          tombstone_floor: 1,
        }),
        "/roster": () => ({ rosters: [owner.roster] }),
      });
      const listed = await listVault(owner.session);
      expect(listed.accountSettingsId).toBe(ACCOUNT_SETTINGS_ID);
      expect(listed.accountSettings.accent).toBe("green");
      expect(listed.accountSettings.contactMode).toBe("basic");
    });
  }

  it("walks several pages and verifies them as one set", async () => {
    const owner = account();
    const { objects, manifest } = twoPageVault(owner);
    let calls = 0;
    server({
      "/changes": () => {
        calls += 1;
        const first = calls === 1;
        return {
          latest_revision: 2,
          key_epoch: 1,
          objects: first ? [objects[0]] : [objects[1]],
          has_more: first,
          manifest,
          resync: false,
          tombstone_floor: 1,
        };
      },
      "/roster": () => ({ rosters: [owner.roster] }),
    });
    const listed = await listVault(owner.session);
    expect(calls).toBe(2);
    expect(listed.contacts.map((contact) => contact.name).sort()).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });

  it("restarts when the vault moves between pages rather than reporting tampering", async () => {
    const owner = account();
    const { objects, manifest } = twoPageVault(owner);
    let calls = 0;
    server({
      "/changes": () => {
        calls += 1;
        const first = calls % 2 === 1;
        return {
          latest_revision: 2,
          key_epoch: 1,
          objects: first ? [objects[0]] : [objects[1]],
          has_more: first,
          // A write committing between the two pages: the second page carries a
          // manifest the first one does not describe.
          manifest: first ? manifest : { ...manifest, manifest_seq: manifest.manifest_seq + 1 },
          resync: false,
          tombstone_floor: 1,
        };
      },
      "/roster": () => ({ rosters: [owner.roster] }),
    });

    const error = await listVault(owner.session).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    // The distinction is the whole point: this is transient, and a manifest
    // failure never is.
    expect((error as Error).name).not.toBe("ManifestError");
    expect((error as Error).message).toMatch(/kept changing/iu);
    // Four walks of two pages: it restarted rather than giving up on the first
    // disagreement, and stopped rather than looping.
    expect(calls).toBe(8);
  });

  it("refuses a manifest signed by a device the roster does not list", async () => {
    const owner = account();
    // A device the server enrolled on its own. Its signature is real, which is
    // exactly why the device set cannot come from the server: the roster is what
    // says this key was never vouched for.
    const injected = createDevice();
    const { object, manifest } = vaultWith(owner, {
      seed: injected.mldsa_seed,
      sk: injected.ed25519_sk,
      deviceId: injected.device_id,
    });
    server({
      "/changes": () => ({
        latest_revision: 1,
        key_epoch: 1,
        objects: [object],
        has_more: false,
        manifest,
        resync: false,
        tombstone_floor: 1,
      }),
      // The roster does not list the device the server enrolled, and there is no
      // unsigned device list left to take it from.
      "/roster": () => ({ rosters: [owner.roster] }),
    });
    await expect(listVault(owner.session)).rejects.toThrow(/roster/iu);
  });
});

describe("exportVault", () => {
  it("carries every object, including the content type the listing drops", async () => {
    const owner = account();
    const contactId = newUuid();
    const noteId = newUuid();
    const futureId = newUuid();
    const { objects, manifest, revision } = vaultOf(owner, [
      {
        id: contactId,
        contentType: JSCONTACT_CONTENT_TYPE,
        payload: JSON.stringify({ "@type": "Card", name: { full: "Ada Lovelace" } }),
      },
      {
        id: noteId,
        contentType: NOTE_CONTENT_TYPE,
        payload: JSON.stringify({ "@type": "Note", title: "Plan", body: "- ship", pinned: true }),
      },
      // A type no build here knows: the listing has to skip it, and the export
      // has to keep it, or a backup silently loses what a newer client wrote.
      {
        id: futureId,
        contentType: "application/sealbook.future+json",
        payload: JSON.stringify({ keep: "me" }),
      },
    ]);
    server({
      "/changes": () => ({
        latest_revision: revision,
        key_epoch: 1,
        objects,
        has_more: false,
        manifest,
        resync: false,
        tombstone_floor: 1,
      }),
      "/roster": () => ({ rosters: [owner.roster] }),
    });

    const exported = await exportVault(owner.session);
    expect(exported.unreadable).toBe(0);
    expect(exported.objects.map((object) => object.id).sort()).toEqual(
      [contactId, noteId, futureId].sort(),
    );
    const future = exported.objects.find((object) => object.id === futureId);
    expect(future?.contentType).toBe("application/sealbook.future+json");
    expect(JSON.parse(future!.payload)).toEqual({ keep: "me" });
    // Payloads come out as stored, so a field no view of a note reads is there.
    const note = exported.objects.find((object) => object.id === noteId);
    expect(JSON.parse(note!.payload)).toMatchObject({ pinned: true });

    const listed = await listVault(owner.session);
    expect(listed.sealed.map((object) => object.id)).not.toContain(futureId);
  });

  it("counts the rows it could not open, so a backup can say it is short", async () => {
    const owner = account();
    const readable = newUuid();
    const sealedBy = (key: string, id: string, name: string) =>
      sealObject(
        key,
        id,
        owner.collectionId,
        JSCONTACT_CONTENT_TYPE,
        JSON.stringify({ "@type": "Card", name: { full: name } }),
      );
    const unreadableId = newUuid();
    const pairs = [
      { id: readable, sealed: sealedBy(owner.session.collectionKey, readable, "Ada Lovelace") },
      { id: unreadableId, sealed: sealedBy(newCollectionKey(), unreadableId, "Unreadable") },
    ];
    const objects: SealedObject[] = pairs.map(({ id, sealed }, index) => ({
      id,
      revision: index + 1,
      tombstone: false,
      nonce: sealed.nonce,
      ciphertext: sealed.ciphertext,
      padded_size: sealed.padded_size,
      content_type: sealedContentType(),
    }));
    const manifest = manifestSign(
      owner.enrollment.mldsa_seed,
      owner.enrollment.ed25519_sk,
      owner.collectionId,
      owner.enrollment.device_id,
      2,
      1,
      2,
      objects.map((object) => ({
        id: object.id,
        revision: object.revision,
        tombstone: false,
        content_digest: objectContentDigest(object.nonce, object.ciphertext),
      })),
    );
    server({
      "/changes": () => ({
        latest_revision: 2,
        key_epoch: 1,
        objects,
        has_more: false,
        manifest,
        resync: false,
        tombstone_floor: 1,
      }),
      "/roster": () => ({ rosters: [owner.roster] }),
    });

    const exported = await exportVault(owner.session);
    expect(exported.objects.map((object) => object.id)).toEqual([readable]);
    expect(exported.unreadable).toBe(1);
  });
});

describe("a read that overlaps this device's own write", () => {
  it("answers from a snapshot taken after the write, not before it", async () => {
    const owner = account();
    const existing = vaultWith(owner, {
      seed: owner.enrollment.mldsa_seed,
      sk: owner.enrollment.ed25519_sk,
      deviceId: owner.enrollment.device_id,
    });
    let objects: SealedObject[] = [existing.object];
    let current = existing.manifest;
    const entriesOf = (held: SealedObject[]): ManifestEntry[] =>
      held.map((object) => ({
        id: object.id,
        revision: object.revision,
        tombstone: object.tombstone,
        content_digest: objectContentDigest(object.nonce, object.ciphertext),
      }));

    server({
      "/manifest": () => ({ manifest: current, entries: entriesOf(objects) }),
      "/objects": (_url, body) => {
        const put = body as SealedObject & { manifest: ManifestBody };
        objects = [
          ...objects,
          {
            id: put.id,
            revision: put.revision,
            tombstone: put.tombstone,
            nonce: put.nonce,
            ciphertext: put.ciphertext,
            padded_size: put.padded_size,
            content_type: sealedContentType(),
          },
        ];
        current = put.manifest;
        return { revision: put.revision };
      },
      // A read transaction takes its snapshot when the request arrives and
      // answers from that, whatever commits while it is open.
      "/changes": async () => {
        const snapshot = { objects, manifest: current };
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          latest_revision: snapshot.manifest.latest_revision,
          key_epoch: 1,
          objects: snapshot.objects,
          has_more: false,
          manifest: snapshot.manifest,
          resync: false,
          tombstone_floor: 1,
        };
      },
      "/roster": () => ({ rosters: [owner.roster] }),
    });

    // Issued without waiting for the write, which is what the note editor's
    // unawaited autosave flush does against the next view's refresh.
    const write = putContact(owner.session, {
      ...emptyDraft(),
      name: "Grace Hopper",
      addressBookId: DEFAULT_ADDRESS_BOOK_ID,
    });
    const read = listVault(owner.session);
    await write;
    const listed = await read;

    expect(owner.session.manifestSeq).toBe(3);
    expect(listed.contacts.map((contact) => contact.name).sort()).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
  });
});

describe("putAccountSettings", () => {
  it("writes the toggles to the one well-known id, with the type sealed inside", async () => {
    const owner = account();
    const manifest = manifestSign(
      owner.enrollment.mldsa_seed,
      owner.enrollment.ed25519_sk,
      owner.collectionId,
      owner.enrollment.device_id,
      2,
      1,
      0,
      [],
    );
    const { sent } = server({
      "/manifest": () => ({ manifest, entries: [] }),
      "/roster": () => ({ rosters: [owner.roster] }),
      "/objects": () => ({ revision: 1 }),
    });

    await putAccountSettings(owner.session, {
      features: { contacts: true, calendar: true, notes: false, bookmarks: true },
      contactMode: "basic",
      accent: "blue",
    });

    const body = sent["/objects"] as {
      id: string;
      content_type: string;
      nonce: string;
      ciphertext: string;
      padded_size: number;
    };
    // One id per account: a second device editing the toggles replaces this
    // object rather than adding a rival copy the load order would decide between.
    expect(body.id).toBe(ACCOUNT_SETTINGS_ID);
    // The server only ever sees the opaque label; the real type is inside.
    expect(body.content_type).toBe(sealedContentType());
    const opened = openObject(
      owner.session.collectionKey,
      ACCOUNT_SETTINGS_ID,
      owner.collectionId,
      body.nonce,
      body.ciphertext,
      body.padded_size,
    );
    expect(opened.contentType).toBe(ACCOUNT_SETTINGS_CONTENT_TYPE);
    expect(parseAccountSettings(opened.payload).features).toEqual({
      contacts: true,
      calendar: true,
      notes: false,
      bookmarks: true,
    });
  });
});

describe("a write across a rotation it has not noticed", () => {
  it("re-seals under the refreshed key rather than the one it was holding", async () => {
    const owner = account();
    // Another device rotated: the collection is on epoch 2 under a new key, and
    // this session is still holding epoch 1's.
    const rotatedKey = newCollectionKey();
    const wrap = wrapCkForDevice(rotatedKey, owner.enrollment.hpke_pk);
    const manifest = manifestSign(
      owner.enrollment.mldsa_seed,
      owner.enrollment.ed25519_sk,
      owner.collectionId,
      owner.enrollment.device_id,
      2,
      2,
      0,
      [],
    );
    const { sent } = server({
      "/manifest": () => ({ manifest, entries: [] }),
      "/roster": () => ({ rosters: [owner.roster] }),
      "/keys": () => ({
        key_epoch: 2,
        key_wraps: [
          {
            recipient_kind: "device",
            recipient_id: owner.enrollment.device_id,
            hpke_enc: wrap.enc,
            wrapped_ck: wrap.wrapped_ck,
            ciphersuite: wrap.ciphersuite,
          },
        ],
      }),
      "/objects": () => ({ revision: 1 }),
    });

    const id = await putContact(
      owner.session,
      { ...emptyDraft(), name: "Ada Lovelace", addressBookId: DEFAULT_ADDRESS_BOOK_ID },
    );
    expect(owner.session.keyEpoch).toBe(2);

    const body = sent["/objects"] as {
      nonce: string;
      ciphertext: string;
      padded_size: number;
      manifest: { key_epoch: number };
    };
    expect(body.manifest.key_epoch).toBe(2);
    // The epoch the manifest claims and the key the ciphertext was made with have
    // to be the same one. Sealed under the old key this opens with `rotatedKey`
    // and nothing else, which is the row no device could ever read.
    const opened = openObject(
      rotatedKey,
      id,
      owner.collectionId,
      body.nonce,
      body.ciphertext,
      body.padded_size,
    );
    expect(opened.payload).toContain("Ada Lovelace");
    expect(() =>
      openObject(
        owner.enrollment.collection_key,
        id,
        owner.collectionId,
        body.nonce,
        body.ciphertext,
        body.padded_size,
      ),
    ).toThrow();
  });

  it("refuses the write when the key cannot be brought up to date", async () => {
    const owner = account();
    const manifest = manifestSign(
      owner.enrollment.mldsa_seed,
      owner.enrollment.ed25519_sk,
      owner.collectionId,
      owner.enrollment.device_id,
      2,
      2,
      0,
      [],
    );
    // The server offers a wrap for an epoch that is not the one the manifest
    // claims, which is what a second rotation mid-write looks like.
    const wrap = wrapCkForDevice(newCollectionKey(), owner.enrollment.hpke_pk);
    server({
      "/manifest": () => ({ manifest, entries: [] }),
      "/roster": () => ({ rosters: [owner.roster] }),
      "/keys": () => ({
        key_epoch: 3,
        key_wraps: [
          {
            recipient_kind: "device",
            recipient_id: owner.enrollment.device_id,
            hpke_enc: wrap.enc,
            wrapped_ck: wrap.wrapped_ck,
            ciphersuite: wrap.ciphersuite,
          },
        ],
      }),
      "/objects": () => ({ revision: 1 }),
    });
    await expect(
      putContact(owner.session, {
        ...emptyDraft(),
        name: "Grace Hopper",
        addressBookId: DEFAULT_ADDRESS_BOOK_ID,
      }),
    ).rejects.toThrow(/Nothing was saved/u);
  });
});

describe("rotateAuthenticated", () => {
  async function rotate(options: { tombstoneFloor: number; revoke?: DevicePublic | null }) {
    const owner = account();
    // The object id is bound into the AEAD's associated data, so it has to be
    // the same id the rotation re-encrypts under.
    const liveId = newUuid();
    const live = sealObject(
      owner.session.collectionKey,
      liveId,
      owner.collectionId,
      JSCONTACT_CONTENT_TYPE,
      JSON.stringify({ "@type": "Card", name: { full: "Grace Hopper" } }),
    );
    const liveObject: SealedObject = {
      id: liveId,
      revision: 3,
      tombstone: false,
      nonce: live.nonce,
      ciphertext: live.ciphertext,
      padded_size: live.padded_size,
      content_type: sealedContentType(),
    };
    // Two deletes: one the change feed can still carry, one it cannot.
    const keptTombstone: SealedObject = {
      id: newUuid(),
      revision: 4,
      tombstone: true,
      nonce: "",
      ciphertext: "",
      padded_size: 0,
      content_type: sealedContentType(),
    };
    const oldTombstone: SealedObject = { ...keptTombstone, id: newUuid(), revision: 1 };
    // A second device, so there is someone to revoke and someone to keep.
    const other = createDevice();
    const roster = { ...owner.roster };
    if (options.revoke !== undefined) {
      // The roster the rotation reads has both devices on it.
      roster.devices = [...roster.devices, options.revoke ?? deviceKeys(other)];
      roster.roster_seq = 1;
    }
    const entries: ManifestEntry[] = [
      {
        id: liveId,
        revision: 3,
        tombstone: false,
        content_digest: objectContentDigest(live.nonce, live.ciphertext),
      },
      {
        id: keptTombstone.id,
        revision: 4,
        tombstone: true,
        content_digest: objectContentDigest("", ""),
      },
      {
        id: oldTombstone.id,
        revision: 1,
        tombstone: true,
        content_digest: objectContentDigest("", ""),
      },
    ];
    const manifest = manifestSign(
      owner.enrollment.mldsa_seed,
      owner.enrollment.ed25519_sk,
      owner.collectionId,
      owner.enrollment.device_id,
      2,
      1,
      4,
      entries,
    );
    owner.session.manifestSeq = 2;
    owner.session.state.manifest_seq = 2;
    const { sent } = server({
      "/manifest": () => ({ manifest, entries }),
      "/changes": () => ({
        latest_revision: 4,
        key_epoch: 1,
        objects: [liveObject, keptTombstone, oldTombstone],
        has_more: false,
        manifest,
        resync: false,
        tombstone_floor: options.tombstoneFloor,
      }),
      "/roster": () => ({ rosters: [owner.roster] }),
      "/rotate": () => ({ key_epoch: 2, latest_revision: 5 }),
    });
    const result = await rotateAuthenticated(owner.session, null, PASSWORD);
    return {
      owner,
      result,
      liveId,
      keptId: keptTombstone.id,
      oldId: oldTombstone.id,
      body: sent["/rotate"] as {
        key_epoch: number;
        objects: { id: string; tombstone: boolean; revision: number }[];
        manifest: { object_count: number; latest_revision: number };
        drop_tombstones: string[];
        roster: Roster;
        key_wraps: { recipient_kind: string; recipient_id: string }[];
      },
    };
  }

  it("rotates a vault that takes more than one page to read", async () => {
    const owner = account();
    // Three objects the server hands over one page at a time. A single-page read
    // stopped here with "too large to rotate", although the server's own ceiling
    // is the rotation body, which it holds every write to.
    const sealedObjects = [3, 4, 5].map((revision) => {
      const id = newUuid();
      const sealed = sealObject(
        owner.session.collectionKey,
        id,
        owner.collectionId,
        JSCONTACT_CONTENT_TYPE,
        JSON.stringify({ "@type": "Card", name: { full: `Contact ${revision}` } }),
      );
      const object: SealedObject = {
        id,
        revision,
        tombstone: false,
        nonce: sealed.nonce,
        ciphertext: sealed.ciphertext,
        padded_size: sealed.padded_size,
        content_type: sealedContentType(),
      };
      const entry: ManifestEntry = {
        id,
        revision,
        tombstone: false,
        content_digest: objectContentDigest(sealed.nonce, sealed.ciphertext),
      };
      return { object, entry };
    });
    const entries = sealedObjects.map((item) => item.entry);
    const manifest = manifestSign(
      owner.enrollment.mldsa_seed,
      owner.enrollment.ed25519_sk,
      owner.collectionId,
      owner.enrollment.device_id,
      2,
      1,
      5,
      entries,
    );
    owner.session.manifestSeq = 2;
    owner.session.state.manifest_seq = 2;
    const pagesServed: number[] = [];
    const { sent } = server({
      "/manifest": () => ({ manifest, entries }),
      "/changes": (url) => {
        const after = Number(url.searchParams.get("after") ?? 0);
        pagesServed.push(after);
        const remaining = sealedObjects.filter((item) => item.object.revision > after);
        const [next] = remaining;
        return {
          latest_revision: 5,
          key_epoch: 1,
          objects: next ? [next.object] : [],
          has_more: remaining.length > 1,
          manifest,
          resync: false,
          tombstone_floor: 3,
        };
      },
      "/roster": () => ({ rosters: [owner.roster] }),
      "/rotate": () => ({ key_epoch: 2, latest_revision: 8 }),
    });

    await rotateAuthenticated(owner.session, null, PASSWORD);

    const body = sent["/rotate"] as {
      objects: { id: string; revision: number }[];
      manifest: { object_count: number };
    };
    expect(pagesServed).toEqual([0, 3, 4]);
    // Every object re-encrypted, numbered consecutively from the collection's
    // next revision, which is what the server requires of a rotation.
    expect(body.objects.map((object) => object.id)).toEqual(
      sealedObjects.map((item) => item.object.id),
    );
    expect(body.objects.map((object) => object.revision)).toEqual([6, 7, 8]);
    expect(body.manifest.object_count).toBe(3);
  });

  it("re-encrypts the live objects, keeps the reachable tombstone and retires the old one", async () => {
    const { body, liveId, keptId, oldId } = await rotate({ tombstoneFloor: 3 });
    // A rotation has no plaintext to re-encrypt for a tombstone, and the server
    // refuses a rotated object that claims to be one.
    expect(body.objects.map((object) => object.id)).toEqual([liveId]);
    expect(body.objects.every((object) => !object.tombstone)).toBe(true);
    // The manifest still describes the tombstone the feed can carry, so the
    // count is the live object plus it.
    expect(body.manifest.object_count).toBe(2);
    expect(body.drop_tombstones).toEqual([oldId]);
    expect(keptId).not.toEqual(oldId);
  });

  it("signs a roster at the new epoch that verifies under the new key", async () => {
    const { owner, body, result } = await rotate({ tombstoneFloor: 3 });
    expect(body.key_epoch).toBe(2);
    expect(body.roster.roster_seq).toBe(owner.roster.roster_seq + 1);
    expect(body.roster.key_epoch).toBe(2);
    // The MAC is keyed from the collection key of the roster's own epoch, which
    // is the new one, so this only passes with the key the rotation minted.
    const verified = rosterVerify(
      owner.collectionId,
      owner.roster.roster_seq,
      // The pin before the rotation, which the new roster must be a step from.
      rosterVerify(
        owner.collectionId,
        0,
        "",
        [owner.roster],
        owner.enrollment.collection_key,
        1,
        owner.enrollment.device_id,
      ).pin_transcript,
      [owner.roster, body.roster],
      result.session.collectionKey,
      2,
      owner.enrollment.device_id,
    );
    expect(verified.pin_seq).toBe(2);
    // And the pin moved with it, so the next fetch is checked from here.
    expect(result.session.state.roster_seq).toBe(2);
    expect(result.phrase.split(/\s+/u)).toHaveLength(24);
  });

  it("re-wraps the key for every device on the roster, plus the password and phrase", async () => {
    const { body, owner } = await rotate({ tombstoneFloor: 3 });
    const kinds = body.key_wraps.map((wrap) => wrap.recipient_kind).sort();
    expect(kinds).toEqual(["device", "phrase", "recovery"]);
    expect(
      body.key_wraps.find((wrap) => wrap.recipient_kind === "device")?.recipient_id,
    ).toBe(owner.enrollment.device_id);
  });
});

describe("creating the default calendar on an account that predates the settings id move", () => {
  /** The settings sealed at `id`, plus the vault reads and writes around them. */
  function accountWithSettingsAt(owner: Account, id: string) {
    const { objects, manifest, revision } = vaultOf(owner, [
      {
        id,
        contentType: ACCOUNT_SETTINGS_CONTENT_TYPE,
        payload: serializeAccountSettings({
          features: { contacts: true, calendar: true, notes: false, bookmarks: true },
          contactMode: "detailed",
          accent: "rose",
        }),
      },
    ]);
    const writes: {
      id: string;
      nonce: string;
      ciphertext: string;
      padded_size: number;
    }[] = [];
    const entries: ManifestEntry[] = objects.map((object) => ({
      id: object.id,
      revision: object.revision,
      tombstone: false,
      content_digest: objectContentDigest(object.nonce, object.ciphertext),
    }));
    let current = manifest;
    // The manifest has to move with the writes: served stale, the second write
    // reads a sequence below the one the first signed and trips the rollback
    // check the way a genuinely rewound vault would.
    server({
      "/changes": () => ({
        latest_revision: revision,
        key_epoch: 1,
        objects,
        has_more: false,
        manifest,
        resync: false,
        tombstone_floor: 1,
      }),
      "/roster": () => ({ rosters: [owner.roster] }),
      "/manifest": () => ({ manifest: current, entries }),
      "/objects": (_url, body) => {
        const sent = body as (typeof writes)[number] & {
          revision: number;
          tombstone: boolean;
          manifest: ManifestBody;
        };
        writes.push(sent);
        const next = entries.filter((existing) => existing.id !== sent.id);
        next.push({
          id: sent.id,
          revision: sent.revision,
          tombstone: sent.tombstone,
          content_digest: objectContentDigest(sent.nonce, sent.ciphertext),
        });
        entries.length = 0;
        entries.push(...next);
        current = sent.manifest;
        return { revision: sent.revision };
      },
    });
    return writes;
  }

  it("copies the settings to their own id before writing the calendar over them", async () => {
    const owner = account();
    const writes = accountWithSettingsAt(owner, LEGACY_ACCOUNT_SETTINGS_ID);

    const calendars = await ensureDefaultCalendar(owner.session, []);

    // Order matters: the calendar write destroys the settings at that id, so it
    // must not be what goes out first.
    expect(writes.map((write) => write.id)).toEqual([ACCOUNT_SETTINGS_ID, DEFAULT_CALENDAR_ID]);
    expect(calendars.map((calendar) => calendar.id)).toContain(DEFAULT_CALENDAR_ID);
  });

  it("carries the preferences through the copy rather than resetting them", async () => {
    const owner = account();
    const writes = accountWithSettingsAt(owner, LEGACY_ACCOUNT_SETTINGS_ID);

    await ensureDefaultCalendar(owner.session, []);

    const copied = writes[0]!;
    const opened = openObject(
      owner.session.collectionKey,
      ACCOUNT_SETTINGS_ID,
      owner.collectionId,
      copied.nonce,
      copied.ciphertext,
      copied.padded_size,
    );
    expect(opened.contentType).toBe(ACCOUNT_SETTINGS_CONTENT_TYPE);
    expect(parseAccountSettings(opened.payload)).toEqual({
      features: { contacts: true, calendar: true, notes: false, bookmarks: true },
      contactMode: "detailed",
      accent: "rose",
    });
  });

  it("writes only the calendar when the settings are already at their own id", async () => {
    const owner = account();
    const writes = accountWithSettingsAt(owner, ACCOUNT_SETTINGS_ID);

    await ensureDefaultCalendar(owner.session, []);

    expect(writes.map((write) => write.id)).toEqual([DEFAULT_CALENDAR_ID]);
  });
});

describe("normalizeServer", () => {
  it("defaults a bare host to https and trims a trailing slash", () => {
    expect(normalizeServer("vault.example.com/")).toBe("https://vault.example.com");
  });

  it("rejects an http origin, which a production build's CSP would block", () => {
    expect(() => normalizeServer("http://vault.example.com")).toThrow(/https/u);
  });

  it("keeps http for a loopback host, which is how the dev server is reached", () => {
    expect(normalizeServer("http://localhost:9999")).toBe("http://localhost:9999");
    expect(normalizeServer("http://127.0.0.1:8443")).toBe("http://127.0.0.1:8443");
    expect(normalizeServer("http://[::1]:8443")).toBe("http://[::1]:8443");
  });

  it("still rejects embedded credentials", () => {
    expect(() => normalizeServer("https://user:pw@vault.example.com")).toThrow(/credentials/u);
  });
});

describe("every request", () => {
  it("is bounded by an abort signal, so a server that answers nothing cannot hang the caller", async () => {
    const owner = account();
    const { fetchMock } = server({ "/v1/pair/PAIRCODE": () => ({}) });

    // The answer is beside the point here; what was sent is the subject.
    await expect(pairPreview(owner.session, "PAIRCODE")).rejects.toThrow();

    const [, options] = fetchMock.mock.calls[0]!;
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.signal?.aborted).toBe(false);
  });

  it("names a server it could not reach rather than passing on the engine's wording", async () => {
    const owner = account();
    // What `fetch` rejects with when nothing is listening. The message is
    // "Failed to fetch" in Chrome and "Load failed" in Safari, which is why the
    // client names the case instead of matching either.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(pairPreview(owner.session, "PAIRCODE")).rejects.toBeInstanceOf(
      ServerUnreachableError,
    );
  });
});
