function parseHex(hex: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  return match ? Number.parseInt(match[1], 16) : null;
}

/** A user colour at `alpha`, or the accent when the value is not `#rrggbb`. */
export function tint(hex: string, alpha: number): string {
  const value = parseHex(hex);
  if (value === null) return `color-mix(in srgb, var(--color-accent) ${Math.round(alpha * 100)}%, transparent)`;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** Whether `hex` is light enough to carry dark text, judged by WCAG luminance. */
export function isLegibleOnDark(hex: string): boolean {
  const value = parseHex(hex);
  if (value === null) return true;
  const channel = (raw: number) => {
    const scaled = raw / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255);
  return luminance > 0.18;
}
