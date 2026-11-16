/**
 * Lock and sign-out, told to every other tab and the installed app.
 *
 * Each tab holds its own session and password, so without this a lock or
 * sign-out only reached the tab it was pressed in. Removing the device record
 * is also heard through the `storage` event, which covers a tab that never got
 * the broadcast (a browser without BroadcastChannel, or one opened after it).
 */

import { DEVICE_STORAGE_KEY } from "./storage";

export type SessionEnd = "lock" | "sign-out";

const CHANNEL_NAME = "sealbook-session";

function isSessionEnd(value: unknown): value is SessionEnd {
  return value === "lock" || value === "sign-out";
}

// One channel object both sends and listens: a message is never delivered back
// to the object that posted it, but it would reach a second object in this page,
// and the tab that pressed Lock would then act on its own announcement.
let channel: BroadcastChannel | null = null;
const listeners = new Set<(end: SessionEnd) => void>();

function sharedChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isSessionEnd(event.data)) return;
      for (const listener of listeners) listener(event.data);
    };
  }
  return channel;
}

/** Tells the other tabs. The sender acts on its own end directly. */
export function announceSessionEnd(end: SessionEnd): void {
  sharedChannel()?.postMessage(end);
}

/** Calls `onEnd` for an end another tab announced. Returns the unsubscribe. */
export function listenForSessionEnd(onEnd: (end: SessionEnd) => void): () => void {
  sharedChannel();
  listeners.add(onEnd);
  const onStorage = (event: StorageEvent) => {
    // A null key is `localStorage.clear()`, which removes the device record too.
    if ((event.key === DEVICE_STORAGE_KEY || event.key === null) && event.newValue === null) {
      onEnd("sign-out");
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onEnd);
    window.removeEventListener("storage", onStorage);
  };
}
