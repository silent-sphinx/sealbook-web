import { describeError, log } from "./log";
import {
  EMPTY_OUTBOX,
  emptyVault,
  localStoreOpen,
  loadLocalVault,
  loadOutbox,
  saveLocalVault,
  saveOutbox,
} from "./localStore";
import {
  coreLocalView,
  coreOutboxPush,
  type LocalObject,
  type LocalVault,
  type Outbox,
  type PendingWrite,
} from "./wasm";

export type OutboxState = {
  pending: number;
  /** Ids of the objects with a write waiting in the queue. */
  queued: string[];
  failed: Outbox["failed"];
  /** Set once a flush is refused for an expired session. */
  signIn: boolean;
};

type Listener = (state: OutboxState) => void;
type NoticeListener = (notice: string) => void;

let collection: string | null = null;
let vault: LocalVault = emptyVault();
let outbox: Outbox = EMPTY_OUTBOX;
let signIn = false;
let channel: BroadcastChannel | null = null;
const listeners = new Set<Listener>();
const noticeListeners = new Set<NoticeListener>();
const remoteListeners = new Set<() => void>();
const localLocks = new Map<string, Promise<void>>();

/**
 * Runs `run` holding a lock shared by every tab of this origin, or one held in
 * this tab where the browser has no Web Locks.
 */
export function withLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(name, run);
  }
  const queue = localLocks.get(name) ?? Promise.resolve();
  const result = queue.then(run);
  localLocks.set(
    name,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

function queueLock(): string {
  return `sealbook-outbox:${collection}`;
}

export function flushLock(collectionId: string): string {
  return `sealbook-flush:${collectionId}`;
}

function state(): OutboxState {
  return { pending: outbox.writes.length, queued: outbox.writes.map((write) => write.id), failed: outbox.failed, signIn };
}

function notify(): void {
  const current = state();
  for (const listener of listeners) listener(current);
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  listener(state());
  return () => listeners.delete(listener);
}

export function subscribeNotices(listener: NoticeListener): () => void {
  noticeListeners.add(listener);
  return () => noticeListeners.delete(listener);
}

/** Called when another tab changed the vault copy or the queue. */
export function subscribeRemoteChanges(listener: () => void): () => void {
  remoteListeners.add(listener);
  return () => remoteListeners.delete(listener);
}

export function announce(notice: string): void {
  for (const listener of noticeListeners) listener(notice);
}

export function setSignInNeeded(needed: boolean): void {
  if (signIn === needed) return;
  signIn = needed;
  notify();
}

function broadcast(): void {
  channel?.postMessage({ collection });
}

/** Loads this device's copy and queue for a collection, once per session. */
export async function openOutbox(collectionId: string): Promise<void> {
  if (collection === collectionId) return;
  collection = collectionId;
  vault = (await loadLocalVault()) ?? emptyVault();
  outbox = localStoreOpen() ? await loadOutbox() : EMPTY_OUTBOX;
  signIn = false;
  channel?.close();
  channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("sealbook-outbox");
  if (channel) {
    channel.onmessage = (event: MessageEvent<{ collection: string }>) => {
      if (event.data.collection !== collection) return;
      void reloadFromStore();
    };
  }
  notify();
}

async function reloadFromStore(): Promise<void> {
  vault = (await loadLocalVault()) ?? vault;
  outbox = await loadOutbox();
  notify();
  for (const listener of remoteListeners) listener();
}

export function closeOutbox(): void {
  collection = null;
  vault = emptyVault();
  outbox = EMPTY_OUTBOX;
  signIn = false;
  channel?.close();
  channel = null;
  notify();
}

export function currentVault(): LocalVault {
  return vault;
}

export function currentOutbox(): Outbox {
  return outbox;
}

/** The live objects to list: the vault copy with the queue laid over it. */
export function localObjects(): LocalObject[] {
  return coreLocalView(vault, outbox);
}

/**
 * Replaces the vault copy. `persist` is false for a listing missing rows this
 * device could not open, which must not replace a stored copy that has them.
 */
export async function setVault(next: LocalVault, persist = true): Promise<void> {
  vault = next;
  if (persist && (await saveLocalVault(next))) broadcast();
}

/** Applies `change` to the stored queue, read fresh under the queue lock. */
export async function mutateOutbox(change: (current: Outbox) => Outbox): Promise<Outbox> {
  if (!collection) throw new Error("The vault is locked.");
  if (!localStoreOpen()) {
    // No password to store it under, as for a session driven without the app.
    outbox = change(outbox);
    notify();
    return outbox;
  }
  return withLock(queueLock(), async () => {
    const next = change(await loadOutbox());
    await saveOutbox(next);
    outbox = next;
    notify();
    broadcast();
    return next;
  });
}

/** The live vault copy of one object, as this device last saw it. */
export function vaultObject(id: string): LocalObject | undefined {
  return vault.objects.find((object) => object.id === id && !object.tombstone);
}

/**
 * Queues one write. `base` is the object the edit was made on; without it, the
 * object as this device holds it now.
 */
export async function queueWrite(write: {
  id: string;
  contentType: string;
  tombstone: boolean;
  payload: string;
  base?: LocalObject;
}): Promise<void> {
  const base = write.base ?? vaultObject(write.id);
  const pending: PendingWrite = {
    id: write.id,
    content_type: write.contentType,
    tombstone: write.tombstone,
    payload: write.tombstone ? "" : write.payload,
    base,
    queued_at: new Date().toISOString(),
  };
  try {
    await mutateOutbox((current) => coreOutboxPush(current, pending));
  } catch (err) {
    log.error("a change could not be queued", { reason: describeError(err) });
    throw err;
  }
}
