import { encode } from "uqr";

/**
 * A QR code as one SVG path in module units, for a component to draw at any
 * size without injecting markup from a string. Medium error correction and a
 * two-module border keep a phone camera's read reliable off a screen.
 */
export function qrPath(text: string): { size: number; path: string } {
  const qr = encode(text, { ecc: "M", border: 2 });
  const parts: string[] = [];
  qr.data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return { size: qr.size, path: parts.join("") };
}
