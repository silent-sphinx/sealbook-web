import { b64encode } from "./bytes";
import {
  forgetCachedAttachment,
  readCachedAttachment,
  writeCachedAttachment,
} from "./attachmentCache";
import {
  ATTACHMENT_NONCE_LEN,
  AttachmentHasher,
  newAttachmentKey,
  newUuid,
  openAttachmentChunk,
  sealAttachmentChunk,
} from "./wasm";
import type { NoteAttachment } from "./types";
import type { Session } from "./client";
import {
  ApiError,
  apiRoot,
  errorMessage,
  getJson,
  REQUEST_TIMEOUT_MS,
  postJson,
} from "./transport";

const ATTACHMENT_NONCE_HEADER = "x-sealbook-nonce";
const ATTACHMENT_TIMEOUT_MS = 120_000;

async function putAttachmentChunk(
  url: string,
  nonceB64: string,
  body: Uint8Array,
  token: string,
): Promise<void> {
  const timeout = AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      [ATTACHMENT_NONCE_HEADER]: nonceB64,
      authorization: `Bearer ${token}`,
    },
    // `fetch` sends a view's own bytes, so the subarray of the sealed chunk
    // goes out as it is rather than as a 4 MB copy per chunk.
    body,
    signal: timeout,
  });
  if (!res.ok) {
    throw new ApiError(errorMessage(await res.text(), res.statusText));
  }
}

async function getAttachmentChunk(
  url: string,
  token: string,
): Promise<{ nonce: string; bytes: Uint8Array }> {
  const timeout = AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS);
  const res = await fetch(url, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
    signal: timeout,
  });
  if (!res.ok) {
    throw new ApiError(errorMessage(await res.text(), res.statusText));
  }
  const nonce = res.headers.get(ATTACHMENT_NONCE_HEADER);
  if (!nonce) {
    throw new ApiError("attachment chunk response is missing its nonce");
  }
  return { nonce, bytes: new Uint8Array(await res.arrayBuffer()) };
}

export const ATTACHMENT_CHUNK_SIZE = 4 * 1024 * 1024;
/**
 * The largest attachment this client uploads, held below the protocol's 200 MB
 * ceiling on purpose: a download is assembled in memory before the viewer sees
 * it, and nothing a browser displays comes near this size.
 */
export const MAX_ATTACHMENT_SIZE = 64 * 1024 * 1024;

function attachmentBase(session: Session): string {
  return `${apiRoot(session.state.server)}/v1/collections/${session.state.collection_id}/attachments`;
}

export async function uploadAttachment(
  session: Session,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<NoteAttachment> {
  const attachmentId = newUuid();
  const adk = newAttachmentKey();
  const collectionId = session.state.collection_id;
  const total = file.bytes.length;
  const chunkCount = Math.max(1, Math.ceil(total / ATTACHMENT_CHUNK_SIZE));
  const base = attachmentBase(session);

  await postJson(
    base,
    {
      attachment_id: attachmentId,
      total_plaintext_size: total,
      chunk_size: ATTACHMENT_CHUNK_SIZE,
      chunk_count: chunkCount,
    },
    session.token,
  );

  const hasher = new AttachmentHasher();
  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * ATTACHMENT_CHUNK_SIZE;
      const plaintext = file.bytes.subarray(start, Math.min(start + ATTACHMENT_CHUNK_SIZE, total));
      hasher.update(plaintext);
      const sealed = sealAttachmentChunk(adk, attachmentId, collectionId, index, chunkCount, plaintext);
      const nonce = b64encode(sealed.subarray(0, ATTACHMENT_NONCE_LEN));
      const ciphertext = sealed.subarray(ATTACHMENT_NONCE_LEN);
      await putAttachmentChunk(
        `${base}/${attachmentId}/chunks/${index}`,
        nonce,
        ciphertext,
        session.token,
      );
    }
    const contentHash = hasher.finalize();
    await postJson(`${base}/${attachmentId}/commit`, {}, session.token);
    return {
      id: attachmentId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      byteSize: total,
      adk,
      contentHash,
      chunkSize: ATTACHMENT_CHUNK_SIZE,
      chunkCount,
    };
  } catch (error) {
    try {
      await deleteAttachment(session, attachmentId);
    } catch {
      // The pending-attachment sweep is the backstop if cleanup also fails.
    }
    throw error;
  } finally {
    hasher.free();
  }
}

export async function downloadAttachment(
  session: Session,
  attachment: NoteAttachment,
): Promise<Blob> {
  const collectionId = session.state.collection_id;
  const base = attachmentBase(session);
  const hasher = new AttachmentHasher();
  try {
    // One Blob per chunk, so each plaintext is collectable as the loop advances
    // and the assembled Blob references the parts instead of copying them: the
    // file is held once rather than twice.
    const parts: Blob[] = [];
    for (let index = 0; index < attachment.chunkCount; index += 1) {
      const { nonce, bytes } = await getAttachmentChunk(
        `${base}/${attachment.id}/chunks/${index}`,
        session.token,
      );
      let plaintext: Uint8Array;
      try {
        plaintext = openAttachmentChunk(
          attachment.adk,
          attachment.id,
          collectionId,
          index,
          attachment.chunkCount,
          nonce,
          bytes,
        );
      } catch {
        throw new AttachmentIntegrityError(attachment.id);
      }
      hasher.update(plaintext);
      parts.push(new Blob([plaintext]));
    }
    if (hasher.finalize() !== attachment.contentHash) {
      throw new AttachmentIntegrityError(attachment.id);
    }
    return new Blob(parts, { type: attachment.mimeType });
  } finally {
    hasher.free();
  }
}

export async function loadAttachment(
  session: Session,
  attachment: NoteAttachment,
): Promise<Blob> {
  const cached = await readCachedAttachment(attachment);
  if (cached) return cached;
  const blob = await downloadAttachment(session, attachment);
  await writeCachedAttachment(attachment.id, blob);
  return blob;
}

export async function deleteAttachment(session: Session, attachmentId: string): Promise<void> {
  await forgetCachedAttachment(attachmentId);
  const res = await fetch(`${attachmentBase(session)}/${attachmentId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${session.token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new ApiError(errorMessage(await res.text(), res.statusText));
  }
}

export async function sweepOrphanedAttachments(
  session: Session,
  referencedIds: Set<string>,
  now = Date.now(),
): Promise<number> {
  const base = attachmentBase(session);
  const listed: AttachmentPage = await getJson(base, session.token);
  const all: AttachmentListRow[] = [...listed.attachments];
  // A server whose cursor does not advance would otherwise page forever, so a
  // repeated cursor ends the walk and the sweep runs on what it has.
  const seen = new Set<string>();
  let cursor = listed.next_after;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const page: AttachmentPage = await getJson(
      `${base}?after=${encodeURIComponent(cursor)}`,
      session.token,
    );
    all.push(...page.attachments);
    cursor = page.next_after;
  }
  let removed = 0;
  for (const row of all) {
    const ageMs = now - row.created_at * 1000;
    if (!referencedIds.has(row.attachment_id) && ageMs > ORPHAN_GRACE_MS) {
      try {
        await deleteAttachment(session, row.attachment_id);
        removed += 1;
      } catch {
        // Leave it for the next sweep rather than failing the whole pass.
      }
    }
  }
  return removed;
}

type AttachmentListRow = { attachment_id: string; state: string; created_at: number };
type AttachmentPage = { attachments: AttachmentListRow[]; next_after?: string | null };
const ORPHAN_GRACE_MS = 48 * 60 * 60 * 1000;

export class AttachmentIntegrityError extends Error {
  constructor(attachmentId: string) {
    super(`attachment ${attachmentId} failed its integrity check`);
    this.name = "AttachmentIntegrityError";
  }
}
