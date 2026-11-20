import {
  ACCOUNT_SETTINGS_CONTENT_TYPE,
  ACCOUNT_SETTINGS_ID,
  serializeAccountSettings,
} from "./accountSettings";
import {
  alignKeyEpoch,
  applyWrite,
  entryFor,
  manifestBucketState,
  refreshCollectionKey,
  rememberManifestSeq,
  requireManifestAbsenceOk,
  sealPayload,
  serializeVault,
  verifyManifest,
  verifyWalkedRows,
  type BucketedManifest,
  type Session,
} from "./clientCore";
import { localObjectOf, localObjectsOfFullRead, signNextManifest, walkChanges } from "./clientVault";
import { describeError, log } from "./log";
import { emptyVault } from "./localStore";
import {
  announce,
  currentOutbox,
  currentVault,
  flushLock,
  mutateOutbox,
  openOutbox,
  queueWrite,
  setSignInNeeded,
  setVault,
  vaultObject,
  withLock,
} from "./outbox";
import { apiRoot, failedStatus, putJson } from "./transport";
import {
  coreErrorOf,
  coreFlushFailure,
  coreFlushPlan,
  coreLocalVaultApply,
  coreOutboxFail,
  coreOutboxSettle,
  coreRequireKeyEpoch,
  coreWriteBatches,
  coreWriteGuard,
  sealedContentType,
  type FlushWrite,
  type LocalObject,
  type Outbox,
} from "./wasm";
import type { AccountSettings } from "./types";

/** Lost races a flush absorbs before leaving the rest for the next one. */
const MAX_LOST_RACES = 8;

export type FlushReport = {
  /** Outbox ids moved to the failed list by this flush, with the reason. */
  refused: Map<string, string>;
  /** The vault row each id was last written as by this flush. */
  settled: Map<string, LocalObject>;
  /** Why the flush stopped with writes still queued, if it did. */
  stopped?: "retry" | "sign-in";
};

/**
 * Queues a write and, online, sends the queue. A write the server refuses for
 * good raises; one that could not be sent yet stays queued and does not.
 *
 * `base` is the object the edit was made on. Resolves to the object the write
 * settled as, which a merge may have made differ from `payload`, or undefined
 * while it is still queued.
 */
export async function putSealed(
  session: Session,
  id: string,
  contentType: string,
  tombstone: boolean,
  payload: string,
  base?: LocalObject,
): Promise<LocalObject | undefined> {
  await openOutbox(session.state.collection_id);
  await queueWrite({ id, contentType, tombstone, payload, base });
  if (session.offline) return undefined;
  const report = await flushOutbox(session);
  const reason = report.refused.get(id);
  if (reason !== undefined) throw new Error(reason);
  if (currentOutbox().writes.some((write) => write.id === id)) return undefined;
  return report.settled.get(id) ?? vaultObject(id);
}

export type SealedWrite = {
  id: string;
  contentType: string;
  tombstone: boolean;
  payload: string;
  base?: LocalObject;
};

/** Writes the server refused for good, by id, with the reason for each. */
export class RefusedWrites extends Error {
  constructor(readonly refused: Map<string, string>) {
    super([...new Set(refused.values())].join("; "));
    this.name = "RefusedWrites";
  }
}

/**
 * Queues every write, then sends the queue once. Raises `RefusedWrites` naming
 * the ids the server refused; writes that could not be sent yet stay queued.
 */
export async function putSealedMany(session: Session, writes: SealedWrite[]): Promise<void> {
  if (writes.length === 0) return;
  await openOutbox(session.state.collection_id);
  for (const write of writes) await queueWrite(write);
  if (session.offline) return;
  const { refused } = await flushOutbox(session);
  const ours = new Map([...refused].filter(([id]) => writes.some((write) => write.id === id)));
  if (ours.size > 0) throw new RefusedWrites(ours);
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

function localDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Sends the queue one batch per round, each checked against the signed bucket
 * entries just before signing. The lock is shared by every tab.
 */
export function flushOutbox(session: Session): Promise<FlushReport> {
  const collectionId = session.state.collection_id;
  const report: FlushReport = { refused: new Map(), settled: new Map() };
  if (session.offline || !session.token) return Promise.resolve({ ...report, stopped: "retry" });
  return withLock(flushLock(collectionId), () =>
    serializeVault(collectionId, async () => {
      await openOutbox(collectionId);
      return flushRounds(session, report);
    }),
  );
}

async function flushRounds(session: Session, report: FlushReport): Promise<FlushReport> {
  let attempt = 0;
  let lostRaces = 0;
  for (;;) {
    const outbox = currentOutbox();
    if (outbox.writes.length === 0) break;
    const plan = coreFlushPlan(outbox, currentVault(), localDate(), session.collectionKey);
    if (plan.dropped.length > 0) {
      await settle(
        outbox,
        plan.dropped.map((drop) => drop.id),
      );
      for (const drop of plan.dropped) if (drop.notice) announce(drop.notice);
      continue;
    }
    const batch = firstBatch(plan.writes);
    let held: BucketedManifest;
    try {
      held = await manifestBucketState(session, batch.map((write) => write.id));
    } catch (err) {
      return stop(report, err);
    }
    let guard;
    try {
      guard = coreWriteGuard(batch, held.entries, attempt);
    } catch (err) {
      return stop(report, err);
    }
    if (guard.moved.length > 0) {
      attempt += 1;
      try {
        await catchUp(session);
      } catch (err) {
        return stop(report, err);
      }
      continue;
    }
    const sending = batch.filter((write) => !guard.present.includes(write.id));
    const settles = [...new Set(batch.map((write) => write.settles))];
    if (sending.length > 0) {
      try {
        for (const row of await sendBatch(session, held, sending)) report.settled.set(row.id, row);
      } catch (err) {
        const status = failedStatus(err);
        if (status === null) throw err;
        const failure = coreFlushFailure(status);
        if (failure === "Refused") {
          const reason = describeError(err);
          log.warn("the server refused queued changes", { writes: settles.length, status });
          await mutateOutbox((current) => coreOutboxFail(current, settles, reason));
          for (const id of settles) report.refused.set(id, reason);
          continue;
        }
        if (failure === "SignIn") {
          setSignInNeeded(true);
          return { ...report, stopped: "sign-in" };
        }
        if (status === 409 && lostRaces < MAX_LOST_RACES) {
          lostRaces += 1;
          continue;
        }
        return { ...report, stopped: "retry" };
      }
    }
    await settle(outbox, settles);
    for (const write of sending) if (write.notice) announce(write.notice);
  }
  setSignInNeeded(false);
  return report;
}

function stop(report: FlushReport, err: unknown): FlushReport {
  const status = failedStatus(err);
  if (status === null) {
    const core = coreErrorOf(err);
    if (core?.kind !== "CollectionBusy") throw err;
    log.warn("the vault kept changing while sending queued changes; will try again");
    return { ...report, stopped: "retry" };
  }
  if (coreFlushFailure(status) === "SignIn") {
    setSignInNeeded(true);
    return { ...report, stopped: "sign-in" };
  }
  log.info("queued changes stay queued until the server can be reached", {
    reason: describeError(err),
  });
  return { ...report, stopped: "retry" };
}

/**
 * The leading writes that fit one batch, never splitting the writes that
 * settle one outbox entry: a conflict's merged write and its copy go together.
 */
function firstBatch(writes: FlushWrite[]): FlushWrite[] {
  const encoder = new TextEncoder();
  const [count] = coreWriteBatches(writes.map((write) => encoder.encode(write.payload).length));
  let end = Math.max(1, count);
  while (end < writes.length && writes[end].settles === writes[end - 1].settles) end += 1;
  return writes.slice(0, end);
}

/**
 * Takes these entries out of the queue, unless one was edited again while it
 * was being sent: that edit stays queued, rebased on what the server now holds.
 */
async function settle(planned: Outbox, ids: string[]): Promise<void> {
  const sent = new Map(planned.writes.map((write) => [write.id, write]));
  const vault = currentVault();
  await mutateOutbox((current) => {
    const done: string[] = [];
    const writes = current.writes.map((write) => {
      const was = sent.get(write.id);
      if (!ids.includes(write.id) || !was) return write;
      if (was.payload === write.payload && was.tombstone === write.tombstone) {
        done.push(write.id);
        return write;
      }
      const base = vault.objects.find((object) => object.id === write.id && !object.tombstone);
      return { ...write, base };
    });
    return coreOutboxSettle({ ...current, writes }, done);
  });
}

/** Seals and sends one batch at the next manifest sequence, then records it. */
async function sendBatch(
  session: Session,
  held: BucketedManifest,
  writes: FlushWrite[],
): Promise<LocalObject[]> {
  const { manifest_seq: seq, key_epoch: keyEpoch, latest_revision: latestRevision } = held.plan;
  await alignKeyEpoch(session, keyEpoch);
  const sealed = writes.map((write, index) => {
    const revision = latestRevision + index + 1;
    return {
      write,
      revision,
      sealed: sealPayload(session, write.id, write.content_type, write.payload, revision),
    };
  });
  const { objectCount, root } = applyWrite(
    held,
    sealed.map(({ write, revision, sealed: { encrypted } }) =>
      entryFor({
        id: write.id,
        revision,
        tombstone: write.tombstone,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
      }),
    ),
  );
  const newest = latestRevision + sealed.length;
  const manifest = signNextManifest(session, seq + 1, keyEpoch, newest, objectCount, root);
  const objects = sealed.map(({ write, revision, sealed: { encrypted } }) => ({
    id: write.id,
    revision,
    nonce: encrypted.nonce,
    ciphertext: encrypted.ciphertext,
    padded_size: encrypted.padded_size,
    content_type: sealedContentType(),
    tombstone: write.tombstone,
  }));
  const collectionRoot = `${apiRoot(session.state.server)}/v1/collections/${session.state.collection_id}`;
  if (objects.length === 1) {
    const response = await putJson<{ revision: number }>(
      `${collectionRoot}/objects`,
      { ...objects[0], manifest },
      session.token,
    );
    session.latestRevision = response.revision;
  } else {
    const response = await putJson<{ latest_revision: number }>(
      `${collectionRoot}/objects/batch`,
      { objects, manifest },
      session.token,
    );
    session.latestRevision = response.latest_revision;
  }
  rememberManifestSeq(session, seq + 1);

  const vault = currentVault();
  const rows: LocalObject[] = sealed.map(({ write, revision }) => ({
    id: write.id,
    content_type: write.content_type,
    revision,
    tombstone: write.tombstone,
    payload: write.tombstone ? "" : write.payload,
  }));
  // Revisions between the copy's and this write's belong to other devices and
  // are still to be walked, so the copy's mark only moves when there are none.
  const mark = vault.latest_revision === latestRevision ? newest : vault.latest_revision;
  await setVault(coreLocalVaultApply(vault, rows, mark, keyEpoch));
  return rows;
}

/** Attempts at an incremental read that a concurrent write kept overtaking. */
const MAX_CATCH_UP_READS = 3;

/** Brings the vault copy up to date with what changed since its mark. */
export async function catchUp(session: Session): Promise<void> {
  const vault = currentVault();
  let walk = await walkChanges(session, vault.latest_revision);
  if (walk.keyEpoch !== session.keyEpoch) {
    coreRequireKeyEpoch(walk.keyEpoch, await refreshCollectionKey(session));
  }
  // Only a walk that started over is the whole collection and checked against
  // the manifest below; an incremental one is checked row by row against the
  // signed entries for those objects, under the key epoch just aligned.
  for (let read = 1; !walk.full; read += 1) {
    if ((await verifyWalkedRows(session, walk.objects)) === "verified") break;
    if (read === MAX_CATCH_UP_READS) {
      throw new Error("The vault kept changing while it was being read. Try again.");
    }
    walk = await walkChanges(session, vault.latest_revision);
  }
  if (walk.full) {
    if (walk.manifestJson) {
      await verifyManifest(session, walk.manifestJson, walk.objects.map(entryFor));
    } else {
      requireManifestAbsenceOk(session);
    }
  }
  const opened = walk.full
    ? localObjectsOfFullRead(session.collectionKey, session.state.collection_id, walk.objects).objects
    : walk.objects.map((row) => localObjectOf(session.collectionKey, session.state.collection_id, row));
  const rows = opened.filter((row): row is LocalObject => row !== null);
  const from = walk.full ? emptyVault() : vault;
  session.latestRevision = walk.latestRevision;
  log.debug("caught the vault copy up", { from: vault.latest_revision, rows: rows.length, full: walk.full });
  await setVault(coreLocalVaultApply(from, rows, walk.latestRevision, walk.keyEpoch));
}
