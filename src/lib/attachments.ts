import { b64encode } from "./bytes";
import {
  forgetCachedAttachment,
  readCachedAttachment,
  writeCachedAttachment,
} from "./attachmentCache";
import {
  coreAttachmentChunkDigest,
  coreAttachmentChunkNonce,
  coreAttachmentChunkPath,
  coreAttachmentCommitAccept,
  coreAttachmentCommitRequest,
  coreAttachmentContentHash,
  coreAttachmentCreateAccept,
  coreAttachmentCreateRequest,
  coreAttachmentDeleteRequest,
  coreAttachmentLimits,
  coreAttachmentPlan,
  coreAttachmentRanges,
  coreAttachmentSweepOrphans,
  coreAttachmentSweepPage,
  coreAttachmentSweepRequest,
  coreAttachmentSweepStart,
  coreAttachmentVerify,
  coreErrorOf,
  coreOpenAttachmentChunk,
  coreSealAttachmentChunk,
} from "./wasm";
import type { AttachmentPlan, AttachmentRow } from "./wasm";
import type { NoteAttachment } from "./types";
import type { Session } from "./client";
import { ApiError, apiRoot, errorMessage, sendCore } from "./transport";

const ATTACHMENT_TIMEOUT_MS = 120_000;

async function putAttachmentChunk(
  url: string,
  nonceB64: string,
  body: Uint8Array<ArrayBuffer>,
  token: string,
): Promise<void> {
  const timeout = AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS);
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/octet-stream",
      [coreAttachmentLimits().nonce_header]: nonceB64,
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
  return {
    nonce: coreAttachmentChunkNonce(res.headers.get(coreAttachmentLimits().nonce_header)),
    bytes: new Uint8Array(await res.arrayBuffer()),
  };
}

/**
 * Literals rather than reads of `coreAttachmentLimits()`, because module scope
 * runs before `initWasm`. `attachmentParity.test.ts` asserts both against core,
 * so they cannot drift from it unnoticed.
 */
export const ATTACHMENT_CHUNK_SIZE = 4 * 1024 * 1024;
/** The nonce length a sealed chunk carries before its ciphertext. */
export const ATTACHMENT_NONCE_LEN = 24;
/**
 * The largest attachment this client uploads, held below the protocol's ceiling
 * on purpose: a download is assembled in memory before the viewer sees it, and
 * nothing a browser displays comes near this size. Core enforces the protocol
 * limit; this one is this client's policy.
 */
export const MAX_ATTACHMENT_SIZE = 64 * 1024 * 1024;

export async function uploadAttachment(
  session: Session,
  file: { name: string; type: string; bytes: Uint8Array },
): Promise<NoteAttachment> {
  const root = apiRoot(session.state.server);
  const collectionId = session.state.collection_id;
  const plan = coreAttachmentPlan(file.bytes.length);

  const created = await sendCore(
    root,
    coreAttachmentCreateRequest(collectionId, plan),
    session.token,
  );
  coreAttachmentCreateAccept(plan, created);

  try {
    const contentHash = await uploadChunks(root, collectionId, plan, file.bytes, session.token);
    return {
      id: plan.attachment_id,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      byteSize: file.bytes.length,
      adk: plan.key,
      contentHash,
      chunkSize: plan.chunk_size,
      chunkCount: plan.chunk_count,
    };
  } catch (error) {
    try {
      await deleteAttachment(session, plan.attachment_id);
    } catch {
      // The orphan sweep is the backstop if cleanup also fails.
    }
    throw error;
  }
}

async function uploadChunks(
  root: string,
  collectionId: string,
  plan: AttachmentPlan,
  bytes: Uint8Array,
  token: string,
): Promise<string> {
  const nonceLen = coreAttachmentLimits().nonce_len;
  const digests: string[] = [];
  for (const range of coreAttachmentRanges(plan)) {
    const plaintext = bytes.subarray(Number(range.start), Number(range.end));
    digests.push(coreAttachmentChunkDigest(plaintext));
    const sealed = coreSealAttachmentChunk(
      plan.key,
      plan.attachment_id,
      collectionId,
      range.index,
      plan.chunk_count,
      plaintext,
    );
    await putAttachmentChunk(
      `${root}${coreAttachmentChunkPath(collectionId, plan.attachment_id, range.index)}`,
      b64encode(sealed.subarray(0, nonceLen)),
      sealed.subarray(nonceLen),
      token,
    );
  }
  const committed = await sendCore(
    root,
    coreAttachmentCommitRequest(collectionId, plan.attachment_id),
    token,
  );
  coreAttachmentCommitAccept(plan.attachment_id, committed);
  return coreAttachmentContentHash(digests);
}

export async function downloadAttachment(
  session: Session,
  attachment: NoteAttachment,
): Promise<Blob> {
  const root = apiRoot(session.state.server);
  const collectionId = session.state.collection_id;
  // One Blob per chunk, so each plaintext is collectable as the loop advances
  // and the assembled Blob references the parts instead of copying them: the
  // file is held once rather than twice.
  const parts: Blob[] = [];
  const digests: string[] = [];
  for (let index = 0; index < attachment.chunkCount; index += 1) {
    const { nonce, bytes } = await getAttachmentChunk(
      `${root}${coreAttachmentChunkPath(collectionId, attachment.id, index)}`,
      session.token,
    );
    const plaintext = asIntegrityError(attachment.id, () =>
      coreOpenAttachmentChunk(
        attachment.adk,
        attachment.id,
        collectionId,
        index,
        attachment.chunkCount,
        nonce,
        bytes,
      ),
    );
    digests.push(coreAttachmentChunkDigest(plaintext));
    parts.push(new Blob([plaintext]));
  }
  asIntegrityError(attachment.id, () =>
    coreAttachmentVerify(attachment.id, attachment.contentHash, digests),
  );
  return new Blob(parts, { type: attachment.mimeType });
}

/**
 * Core's integrity refusal as this client's own class, which the viewer already
 * tells apart from a transport failure.
 */
function asIntegrityError<T>(attachmentId: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (coreErrorOf(error)?.kind === "AttachmentIntegrity") {
      throw new AttachmentIntegrityError(attachmentId);
    }
    throw error;
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
  await sendCore(
    apiRoot(session.state.server),
    coreAttachmentDeleteRequest(session.state.collection_id, attachmentId),
    session.token,
  );
}

export async function sweepOrphanedAttachments(
  session: Session,
  referencedIds: Set<string>,
  now = Date.now(),
): Promise<number> {
  const root = apiRoot(session.state.server);
  const collectionId = session.state.collection_id;
  const rows: AttachmentRow[] = [];
  let cursor = coreAttachmentSweepStart();
  for (;;) {
    const body = await sendCore(
      root,
      coreAttachmentSweepRequest(collectionId, cursor),
      session.token,
    );
    const page = coreAttachmentSweepPage(cursor, body);
    rows.push(...page.rows);
    if (!page.next) break;
    cursor = page.next;
  }

  let removed = 0;
  for (const id of coreAttachmentSweepOrphans(rows, [...referencedIds], Math.floor(now / 1000))) {
    try {
      await deleteAttachment(session, id);
      removed += 1;
    } catch {
      // Leave it for the next sweep rather than failing the whole pass.
    }
  }
  return removed;
}

export class AttachmentIntegrityError extends Error {
  constructor(attachmentId: string) {
    super(`attachment ${attachmentId} failed its integrity check`);
    this.name = "AttachmentIntegrityError";
  }
}
