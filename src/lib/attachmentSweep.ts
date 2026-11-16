import { sweepOrphanedAttachments } from "./attachments";
import type { Session } from "./client";
import { listingFrom, type VaultListing } from "./clientVault";
import { localObjects } from "./outbox";

export const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const sweepKey = (collectionId: string) => `sealbook.attachmentSweep.${collectionId}`;

/** Every attachment id a note or contact in the listing still carries. */
export function referencedAttachmentIds(listing: VaultListing): Set<string> {
  const ids = new Set<string>();
  for (const item of [...listing.notes, ...listing.contacts]) {
    for (const entry of item.attachments ?? []) ids.add(entry.id);
  }
  return ids;
}

/**
 * Sweeps orphaned attachments at most once a day. Skipped while the listing is
 * missing rows this device could not open, or holds rows it could not read in
 * full, since one of them may reference a photo. Returns the number removed, or null when nothing was attempted.
 */
export async function sweepIfDue(
  session: Session,
  listing: VaultListing,
  sweep: typeof sweepOrphanedAttachments = sweepOrphanedAttachments,
  now = Date.now(),
): Promise<number | null> {
  if (session.offline || listing.unopened > 0 || listing.unreadReferences > 0) return null;
  // This device's own view too, so a write still queued keeps its photos. One it
  // cannot read in full is as unsafe as a listing row.
  const held = listingFrom(localObjects(), 0);
  if (held.unreadReferences > 0) return null;
  const key = sweepKey(session.state.collection_id);
  const last = Number(localStorage.getItem(key));
  if (Number.isFinite(last) && now - last < SWEEP_INTERVAL_MS) return null;
  localStorage.setItem(key, String(now));
  const referenced = referencedAttachmentIds(listing);
  for (const id of referencedAttachmentIds(held)) referenced.add(id);
  return sweep(session, referenced, now);
}
