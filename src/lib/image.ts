/**
 * Image processing utilities for contact profile pictures (avatars).
 * Resizes and crops images client-side to a square avatar (256x256)
 * and compresses to modern WebP (with JPEG fallback) at ~10-20 KB.
 */

/**
 * The value if it can be shown without a network request: an inline image or
 * a blob this page made. Anything else, an `https:` URL above all, would make
 * the browser contact whoever controls that host each time the picture drew.
 * Vault contents are not trusted to be only what this app wrote, since an
 * import keeps whatever a vCard or CSV named.
 */
export function safeImageSrc(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^data:image\//iu.test(value) || /^blob:/iu.test(value) ? value : undefined;
}

const AVATAR_SIZE = 256;
const AVATAR_QUALITY = 0.82;

/**
 * Optimizes an image (from a File, Blob, or base64/data URL) into an optimized
 * WebP data URL suitable for inline zero-knowledge vault storage.
 */
export async function optimizeAvatar(
  source: File | Blob | string,
): Promise<string> {
  const image = await loadImage(source);

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to create canvas context for image processing.");
  }

  // Calculate center-crop dimensions (cover square)
  const srcWidth = image.naturalWidth || image.width;
  const srcHeight = image.naturalHeight || image.height;

  let sx = 0;
  let sy = 0;
  let sSize = Math.min(srcWidth, srcHeight);

  if (srcWidth > srcHeight) {
    sx = Math.round((srcWidth - srcHeight) / 2);
  } else if (srcHeight > srcWidth) {
    sy = Math.round((srcHeight - srcWidth) / 2);
  }

  // Smooth scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Draw square crop
  ctx.drawImage(
    image,
    sx,
    sy,
    sSize,
    sSize,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );

  // Try WebP first; fall back to JPEG if WebP export fails or isn't supported
  let dataUrl = canvas.toDataURL("image/webp", AVATAR_QUALITY);
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/jpeg", AVATAR_QUALITY);
  }

  return dataUrl;
}

/** Longest edge of a note-photo preview thumbnail, and its WebP quality. */
const THUMBNAIL_EDGE = 512;
const THUMBNAIL_QUALITY = 0.7;

export type AttachmentPreview = {
  thumbnail: string;
  width: number;
  height: number;
};

/**
 * A small preview of a note photo, scaled to fit `THUMBNAIL_EDGE` on its longer
 * side with aspect preserved. Unlike `optimizeAvatar` this does not square-crop:
 * a photo is shown whole. The result rides inside the sealed note payload, so it
 * is kept small; the full-resolution bytes live in the attachment store.
 */
export async function optimizeAttachmentThumbnail(
  source: File | Blob | string,
): Promise<AttachmentPreview> {
  const image = await loadImage(source);
  const srcWidth = image.naturalWidth || image.width;
  const srcHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to create canvas context for image processing.");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);

  let thumbnail = canvas.toDataURL("image/webp", THUMBNAIL_QUALITY);
  if (!thumbnail.startsWith("data:image/webp")) {
    thumbnail = canvas.toDataURL("image/jpeg", THUMBNAIL_QUALITY);
  }
  return { thumbnail, width: srcWidth, height: srcHeight };
}

function loadImage(source: File | Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for processing."));

    if (typeof source === "string") {
      img.src = source;
    } else {
      const url = URL.createObjectURL(source);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to read image blob."));
      };
      img.src = url;
    }
  });
}
