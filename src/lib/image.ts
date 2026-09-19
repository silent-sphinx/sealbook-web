/**
 * Image processing utilities for contact profile pictures (avatars).
 * Resizes and crops images client-side to a square avatar (256x256)
 * and compresses to modern WebP (with JPEG fallback) at ~10-20 KB.
 */

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
