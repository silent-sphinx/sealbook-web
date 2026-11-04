import type { MutableRefObject } from "react";
import {
  loadAttachment,
  MAX_ATTACHMENT_SIZE,
  uploadAttachment,
  type Session,
} from "../lib/client";
import { friendlyError } from "../lib/errors";
import { optimizeAttachmentThumbnail } from "../lib/image";
import { attachmentIdsIn } from "../lib/noteDoc";
import type { NoteAttachment, NoteDraft } from "../lib/types";

type Options = {
  session: Session;
  draftRef: MutableRefObject<NoteDraft | null>;
  editingId: MutableRefObject<string | null>;
  edit: (patch: Partial<NoteDraft>) => void;
  schedule: (write: { id: string; draft: NoteDraft }) => void;
  setError: (message: string) => void;
};

/**
 * The photo side of the open note. The editor builds its extensions once per
 * note, so these read the live draft through `draftRef`, and are defined fresh
 * each render because the editor reads them through refs of its own.
 */
export function useNotePhotos({ session, draftRef, editingId, edit, schedule, setError }: Options) {
  const getAttachmentWidth = (attachmentId: string): number | undefined =>
    draftRef.current?.attachments?.find((entry) => entry.id === attachmentId)?.displayWidth;

  /** Presentational, so it updates the attachment metadata, not the body. */
  const onResizeAttachment = (attachmentId: string, width: number) => {
    const current = draftRef.current?.attachments;
    if (!current) return;
    const attachments = current.map((entry) =>
      entry.id === attachmentId ? { ...entry, displayWidth: width } : entry,
    );
    if (draftRef.current) draftRef.current = { ...draftRef.current, attachments };
    edit({ attachments });
  };

  /** Resolves a note photo to an object URL through the cache-first download. */
  const resolveAttachment = async (attachmentId: string): Promise<string | null> => {
    const attachment = draftRef.current?.attachments?.find((entry) => entry.id === attachmentId);
    if (!attachment) return null;
    try {
      const blob = await loadAttachment(session, attachment);
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  };

  /**
   * Uploads a picked image and records its reference on the draft. The full
   * bytes go to the attachment store; only a small preview and the reference
   * ride inside the note.
   */
  const uploadImage = async (
    file: File,
  ): Promise<{ attachmentId: string; alt: string } | null> => {
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setError(`That photo is larger than the ${Math.round(MAX_ATTACHMENT_SIZE / (1024 * 1024))} MB limit.`);
      return null;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let preview: { thumbnail?: string; width?: number; height?: number } = {};
      try {
        preview = await optimizeAttachmentThumbnail(file);
      } catch {
        // A thumbnail is a convenience; upload the photo even if preview fails.
      }
      const attachment: NoteAttachment = {
        ...(await uploadAttachment(session, { name: file.name, type: file.type, bytes })),
        thumbnail: preview.thumbnail,
        width: preview.width,
        height: preview.height,
      };
      const attachments = [...(draftRef.current?.attachments ?? []), attachment];
      // The image node resolves on mount, before React refreshes this ref, so
      // the ref is synced now or the first resolve finds no attachment.
      if (draftRef.current) draftRef.current = { ...draftRef.current, attachments };
      edit({ attachments });
      return { attachmentId: attachment.id, alt: file.name };
    } catch (err) {
      setError(friendlyError(err));
      return null;
    }
  };

  /**
   * Drops entries whose photo the body no longer shows. Run when an editing
   * session ends, so an undone delete within it still finds its photo.
   */
  function pruneUnshown() {
    const id = editingId.current;
    const current = draftRef.current;
    if (!id || !current?.attachments?.length) return;
    const shown = attachmentIdsIn(current.body);
    const attachments = current.attachments.filter((entry) => shown.has(entry.id));
    if (attachments.length === current.attachments.length) return;
    schedule({ id, draft: { ...current, attachments } });
  }

  return { getAttachmentWidth, onResizeAttachment, resolveAttachment, uploadImage, pruneUnshown };
}
