import { useMemo } from "react";
import { qrPath } from "../lib/qr";

/**
 * A QR code. Dark modules on a white tile whatever the theme, since a scanner
 * needs dark-on-light.
 */
export function QrCode({ text, label, className = "" }: { text: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => qrPath(text), [text]);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={`rounded-lg bg-white ${className}`}
    >
      <path d={path} fill="#111" />
    </svg>
  );
}
