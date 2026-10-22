import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { Session } from "../lib/client";
import {
  deleteAttachment,
  loadAttachment,
  MAX_ATTACHMENT_SIZE,
  uploadAttachment,
} from "../lib/attachments";
import { optimizeAttachmentThumbnail } from "../lib/image";
import { friendlyError } from "../lib/errors";
import { focusRing } from "../lib/styles";
import type { NoteAttachment } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  session: Session;
  attachments: NoteAttachment[];
  readOnly?: boolean;
  /** Resolves false when the list could not be persisted on the contact. */
  onAttachmentsChange: (next: NoteAttachment[]) => boolean | Promise<boolean>;
}

interface LightboxState {
  index: number;
  objectUrl: string | null;
  loading: boolean;
}

function oversizedMessage(names: string[]): string | null {
  if (names.length === 0) return null;
  const limit = Math.round(MAX_ATTACHMENT_SIZE / (1024 * 1024));
  const list = names.map((name) => `"${name}"`).join(", ");
  return `${list} ${names.length === 1 ? "exceeds" : "exceed"} the ${limit} MB limit.`;
}

export function ContactAttachmentsSection({
  session,
  attachments,
  readOnly = false,
  onAttachmentsChange,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<NoteAttachment | null>(null);
  const objectUrlsRef = useRef<Map<string, string>>(new Map());
  const currentAttachment = lightbox !== null ? attachments[lightbox.index] ?? null : null;

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  // Keyed on the attachment, not the index: a delete lands on the same index
  // holding something else. A download the viewer moved past is discarded
  // rather than aborted, since `loadAttachment` is cache-first.
  useEffect(() => {
    if (currentAttachment === null) return;
    const attachment = currentAttachment;
    let cancelled = false;

    async function loadImage() {
      const cached = objectUrlsRef.current.get(attachment.id);
      if (cached) {
        setLightbox((l) => l ? { ...l, objectUrl: cached, loading: false } : l);
        return;
      }

      setLightbox((l) => l ? { ...l, loading: true, objectUrl: null } : l);
      try {
        const blob = await loadAttachment(session, attachment);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.set(attachment.id, url);
        setLightbox((l) => l ? { ...l, objectUrl: url, loading: false } : l);
      } catch {
        if (cancelled) return;
        setLightbox((l) => l ? { ...l, loading: false } : l);
      }
    }

    void loadImage();
    return () => { cancelled = true; };
  }, [currentAttachment?.id, session]);

  useEffect(() => {
    if (!lightbox || confirmingDelete) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setLightbox(null);
      } else if (e.key === "ArrowLeft") {
        navigateLightbox(-1);
      } else if (e.key === "ArrowRight") {
        navigateLightbox(1);
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox, attachments.length, confirmingDelete]);

  function navigateLightbox(delta: number) {
    setLightbox((l) => {
      if (!l) return l;
      const next = (l.index + delta + attachments.length) % attachments.length;
      return { index: next, objectUrl: null, loading: true };
    });
  }

  function openLightbox(index: number) {
    setLightbox({ index, objectUrl: null, loading: true });
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    const added: NoteAttachment[] = [];
    const oversized: string[] = [];
    let failure: string | null = null;
    try {
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_SIZE) {
          oversized.push(file.name);
          continue;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        let preview: { thumbnail?: string; width?: number; height?: number } = {};
        if (file.type.startsWith("image/")) {
          try {
            preview = await optimizeAttachmentThumbnail(file);
          } catch {
            // non-critical
          }
        }
        const meta = await uploadAttachment(session, { name: file.name, type: file.type, bytes });
        added.push({ ...meta, thumbnail: preview.thumbnail, width: preview.width, height: preview.height });
        // The parent write is what records an upload, so each file is committed
        // as it lands rather than the batch once the loop finishes.
        if (!(await onAttachmentsChange([...attachments, ...added]))) {
          failure = "The upload could not be recorded on this contact.";
          break;
        }
      }
    } catch (err) {
      failure = friendlyError(err);
    } finally {
      const parts = [oversizedMessage(oversized), failure].filter(
        (part): part is string => part !== null,
      );
      setUploadError(parts.length > 0 ? parts.join(" ") : null);
      setUploading(false);
    }
  }

  async function handleDownload() {
    if (!lightbox) return;
    const attachment = attachments[lightbox.index];
    if (!attachment) return;
    try {
      const blob = await loadAttachment(session, attachment);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = attachment.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // silently ignored; download failures are visible in the network tab
    }
  }

  async function handleDelete(attachment: NoteAttachment) {
    const at = attachments.findIndex((a) => a.id === attachment.id);
    if (at === -1) return;
    setDeleting(attachment.id);
    setDeleteError(null);
    try {
      // The card is what makes an attachment real, so the shortened list is
      // persisted first. A failure here leaves the file both referenced and
      // stored; deleting at the server first would leave the card pointing at
      // bytes that are gone.
      const next = attachments.filter((a) => a.id !== attachment.id);
      if (!(await onAttachmentsChange(next))) {
        setDeleteError("The change could not be saved on this contact.");
        return;
      }
      setConfirmingDelete(null);
      const url = objectUrlsRef.current.get(attachment.id);
      if (url) {
        URL.revokeObjectURL(url);
        objectUrlsRef.current.delete(attachment.id);
      }
      if (next.length === 0) {
        setLightbox(null);
      } else {
        const nextIndex = Math.min(at, next.length - 1);
        setLightbox({ index: nextIndex, objectUrl: null, loading: true });
      }
      // Off the card already, so `sweepOrphanedAttachments` reclaims the bytes
      // if this fails; the viewer is not told about a file it no longer sees.
      try {
        await deleteAttachment(session, attachment.id);
      } catch {
        // Left to the sweep.
      }
    } catch (err) {
      setDeleteError(friendlyError(err));
    } finally {
      setDeleting(null);
    }
  }

  const isImage = currentAttachment?.mimeType?.startsWith("image/") ?? false;
  const busy = uploading || deleting !== null;

  return (
    <section className="break-inside-avoid">
      <h4 className="sticky top-0 z-10 flex items-center justify-between border-b border-line/60 bg-surface/80 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute backdrop-blur-sm">
        <span>Photos &amp; Attachments</span>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            title="Add files"
            className={`flex h-6 w-6 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text disabled:opacity-50 ${focusRing}`}
          >
            <PlusIcon />
          </button>
        ) : null}
      </h4>

      {uploadError ? (
        <p role="alert" className="border-b border-danger/30 bg-danger/10 px-5 py-2 text-xs text-danger">
          {uploadError}
        </p>
      ) : null}

      <div className="border-b border-line/60 px-5 py-3">
        {attachments.length === 0 && !uploading ? (
          <p className="text-sm text-mute">
            {readOnly ? "No attachments." : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`text-accent transition-colors hover:underline ${focusRing}`}
              >
                Add photos or files
              </button>
            )}
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {attachments.map((a, index) => (
              <Thumbnail
                key={a.id}
                attachment={a}
                onClick={() => openLightbox(index)}
              />
            ))}
            {uploading ? <UploadingTile /> : null}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {lightbox !== null ? (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/95"
          role="dialog"
          aria-modal="true"
          aria-label="Attachment viewer"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLightbox(null);
          }}
        >
          {/* Toolbar */}
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0 truncate text-sm font-medium text-white/80">
              {currentAttachment?.filename ?? ""}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleDownload()}
                title="Download"
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white ${focusRing}`}
              >
                <DownloadIcon />
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => {
                    if (currentAttachment) setConfirmingDelete(currentAttachment);
                  }}
                  disabled={deleting !== null}
                  title="Delete attachment"
                  className={`flex h-8 w-8 items-center justify-center rounded-lg text-danger/80 transition-colors hover:bg-white/10 hover:text-danger disabled:opacity-50 ${focusRing}`}
                >
                  <TrashIcon />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label="Close"
                title="Close"
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white ${focusRing}`}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* Content area */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            {attachments.length > 1 ? (
              <button
                type="button"
                onClick={() => navigateLightbox(-1)}
                aria-label="Previous"
                className={`absolute left-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white ${focusRing}`}
              >
                <ChevronLeftIcon />
              </button>
            ) : null}

            <div className="flex h-full w-full items-center justify-center p-4">
              {lightbox.loading ? (
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
              ) : isImage && lightbox.objectUrl ? (
                <img
                  src={lightbox.objectUrl}
                  alt={currentAttachment?.filename ?? ""}
                  className="max-h-full max-w-full rounded object-contain"
                />
              ) : lightbox.objectUrl ? (
                <div className="flex flex-col items-center gap-4 text-center text-white/70">
                  <FileIcon className="h-16 w-16 opacity-50" />
                  <p className="text-sm">{currentAttachment?.filename}</p>
                  <p className="text-xs opacity-60">{currentAttachment?.mimeType}</p>
                </div>
              ) : (
                <p className="text-sm text-white/50">Could not load attachment.</p>
              )}
            </div>

            {attachments.length > 1 ? (
              <button
                type="button"
                onClick={() => navigateLightbox(1)}
                aria-label="Next"
                className={`absolute right-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white/80 transition-colors hover:bg-black/60 hover:text-white ${focusRing}`}
              >
                <ChevronRightIcon />
              </button>
            ) : null}
          </div>

          {/* Filmstrip / counter */}
          {attachments.length > 1 ? (
            <div className="flex shrink-0 items-center justify-center gap-1.5 px-4 py-3">
              {attachments.map((a, i) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setLightbox({ index: i, objectUrl: null, loading: true })}
                  aria-label={`Go to attachment ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all ${i === lightbox.index ? "w-4 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70"} ${focusRing}`}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {confirmingDelete ? (
        <ConfirmDialog
          title="Delete attachment"
          heading={`Delete "${confirmingDelete.filename}"?`}
          body="The file is removed from this contact and deleted from your encrypted vault on every paired device. This cannot be undone."
          confirmLabel="Delete"
          busyLabel="Deleting"
          busy={deleting !== null}
          error={deleteError}
          elevated
          onConfirm={() => void handleDelete(confirmingDelete)}
          onClose={() => {
            setConfirmingDelete(null);
            setDeleteError(null);
          }}
        />
      ) : null}
    </section>
  );
}

function Thumbnail({ attachment, onClick }: { attachment: NoteAttachment; onClick: () => void }) {
  const isImage = attachment.mimeType?.startsWith("image/");
  return (
    <button
      type="button"
      onClick={onClick}
      title={attachment.filename}
      className={`group relative aspect-square overflow-hidden rounded-lg border border-line bg-surface transition-colors hover:border-accent-dim ${focusRing}`}
    >
      {attachment.thumbnail ? (
        <img
          src={attachment.thumbnail}
          alt={attachment.filename}
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      ) : isImage ? (
        <div className="flex h-full w-full items-center justify-center bg-surface">
          <ImagePlaceholderIcon className="h-6 w-6 text-mute/50" />
        </div>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2">
          <FileIcon className="h-6 w-6 text-mute/60" />
          <span className="line-clamp-2 text-center text-[9px] leading-tight text-mute/70">
            {attachment.filename}
          </span>
        </div>
      )}
    </button>
  );
}

function UploadingTile() {
  return (
    <div className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-line bg-surface/50">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
    </div>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
      <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M6.28 5.22a.75.75 0 1 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06l3.72-3.72 3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.879a1.5 1.5 0 0 1 1.06.44l4.122 4.12A1.5 1.5 0 0 1 17 7.622V16.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13Z" />
    </svg>
  );
}

function ImagePlaceholderIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0l-2.97 2.97ZM12 7a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" clipRule="evenodd" />
    </svg>
  );
}
