/**
 * The editor node for a note photo.
 *
 * An inline atom carrying only the attachment id and alt text — never the bytes,
 * and never the display size. Its markdown spelling is `![alt](attachment:<id>)`,
 * which `noteDoc` writes and reads, so it obeys the schema's rule that everything
 * the editor can produce round-trips through storage.
 *
 * The bytes and the display width are both resolved lazily from the host, keyed
 * by the attachment id: the width is presentational metadata on the note's
 * attachment entry, not part of the body, so resizing never changes the markdown.
 * The node view asks `resolve` for an object URL, `getWidth` for the saved width,
 * and calls `onResize` when the user drags the corner handle.
 */

import { Node } from "@tiptap/react";

export type AttachmentResolver = (attachmentId: string) => Promise<string | null>;

export interface AttachmentImageOptions {
  resolve: AttachmentResolver;
  /** The saved display width in px for this attachment, or undefined for natural. */
  getWidth: (attachmentId: string) => number | undefined;
  /** Persists a new display width. Absent (or editable false) hides the handle. */
  onResize?: (attachmentId: string, width: number) => void;
}

/** Smallest width the corner handle will let an image shrink to. */
const MIN_WIDTH = 48;

export const AttachmentImage = Node.create<AttachmentImageOptions>({
  name: "attachmentImage",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,

  addOptions() {
    return { resolve: async () => null, getWidth: () => undefined };
  },

  addAttributes() {
    return {
      attachmentId: { default: "" },
      alt: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "img[data-attachment-id]" }];
  },

  renderHTML({ node }) {
    // A plain img with the id as a data attribute, so a copy out of the editor
    // still carries the reference rather than a dead blob URL. Width is not
    // emitted: it lives in the note's attachment metadata, not the markup.
    return [
      "img",
      {
        "data-attachment-id": String(node.attrs.attachmentId ?? ""),
        alt: String(node.attrs.alt ?? ""),
      },
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const { resolve, getWidth, onResize } = this.options;
      const attachmentId = String(node.attrs.attachmentId ?? "");
      const alt = String(node.attrs.alt ?? "");

      const wrapper = document.createElement("span");
      wrapper.className = "note-attachment";
      wrapper.setAttribute("data-attachment-id", attachmentId);

      const img = document.createElement("img");
      img.alt = alt;
      img.className = "note-attachment-img";
      wrapper.appendChild(img);

      // Apply the saved width, if any. Height stays auto so aspect is preserved.
      const savedWidth = getWidth(attachmentId);
      if (savedWidth && savedWidth >= MIN_WIDTH) {
        img.style.width = `${savedWidth}px`;
      }

      let objectUrl: string | null = null;
      void resolve(attachmentId)
        .then((url) => {
          if (url) {
            objectUrl = url;
            img.src = url;
          } else {
            wrapper.classList.add("note-attachment-missing");
          }
        })
        .catch(() => {
          wrapper.classList.add("note-attachment-missing");
        });

      // The resize handle, shown only when the host can persist a new size.
      let cleanupHandle: (() => void) | null = null;
      if (onResize) {
        const handle = document.createElement("span");
        handle.className = "note-attachment-handle";
        handle.setAttribute("aria-hidden", "true");
        wrapper.appendChild(handle);

        let startX = 0;
        let startWidth = 0;
        let latest = 0;

        const onMove = (event: PointerEvent) => {
          const next = Math.max(MIN_WIDTH, Math.round(startWidth + (event.clientX - startX)));
          latest = next;
          img.style.width = `${next}px`;
        };
        const onUp = (event: PointerEvent) => {
          handle.releasePointerCapture(event.pointerId);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          if (latest >= MIN_WIDTH) onResize(attachmentId, latest);
        };
        const onDown = (event: PointerEvent) => {
          // The handle is a control, not editor content: keep ProseMirror from
          // starting a selection or drag from this gesture.
          event.preventDefault();
          event.stopPropagation();
          startX = event.clientX;
          startWidth = img.getBoundingClientRect().width;
          latest = startWidth;
          handle.setPointerCapture(event.pointerId);
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        };
        // The node itself is draggable (for reordering), so suppress the native
        // drag that a press on the handle would otherwise start.
        const onDragStart = (event: DragEvent) => event.preventDefault();
        handle.addEventListener("pointerdown", onDown);
        handle.addEventListener("dragstart", onDragStart);
        cleanupHandle = () => {
          handle.removeEventListener("pointerdown", onDown);
          handle.removeEventListener("dragstart", onDragStart);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
      }

      return {
        dom: wrapper,
        // The node carries no size attr, so an attrs change can only be a
        // different image; keeping the same id means this view stands.
        update: (updated) => updated.type.name === "attachmentImage"
          && String(updated.attrs.attachmentId ?? "") === attachmentId,
        // The drag handle must receive its own pointer events rather than being
        // treated as editor content.
        ignoreMutation: () => true,
        destroy: () => {
          cleanupHandle?.();
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        },
      };
    };
  },
});
