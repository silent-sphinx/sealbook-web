import type { ReactNode } from "react";

const GLYPHS = {
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  minus: <path d="M3.5 8h9" />,
  fit: <path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />,
  search: <path d="M7.25 12a4.75 4.75 0 1 0 0-9.5 4.75 4.75 0 0 0 0 9.5ZM10.75 10.75 13.5 13.5" />,
  chevron: <path d="m6 4 4 4-4 4" />,
  back: <path d="M10 4 6 8l4 4" />,
  close: <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  checkbox: <path d="M4 2.5h8A1.5 1.5 0 0 1 13.5 4v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5Zm1.5 5.75 1.75 1.75 3.25-3.75" />,
  trash: <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8" />,
  pencil: <path d="M11.5 2.5 13.5 4.5 5.5 12.5 3 13l.5-2.5 8-8Z" />,
  repeat: <path d="M3 7V6a2 2 0 0 1 2-2h7.5M10.5 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H3.5M5.5 14l-2-2 2-2" />,
  download: <path d="M8 2.75v7.5M5 7.5 8 10.5l3-3M3 13h10" />,
  clock: <path d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM8 5v3l2 1.5" />,
  bell: <path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1H3l1-1ZM6.75 14.25h2.5" />,
  pin: <path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 10 8 14 8 14Zm0-6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />,
  people: <path d="M6 7.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM2 13c0-2.2 1.8-3.75 4-3.75S10 10.8 10 13M10.5 3.2a2.25 2.25 0 0 1 0 4.1M12 9.5c1.2.5 2 1.8 2 3.5" />,
  text: <path d="M3 4h10M3 8h10M3 12h6" />,
  print: <path d="M4.5 6V2.5h7V6M4.5 11.5h-1A1.5 1.5 0 0 1 2 10V7.5A1.5 1.5 0 0 1 3.5 6h9A1.5 1.5 0 0 1 14 7.5V10a1.5 1.5 0 0 1-1.5 1.5h-1M4.5 9.5h7v4h-7z" />,
  link: <path d="M6.5 9.5a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54l-.5.5M9.5 6.5a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54l.5-.5" />,
  bookmark: <path d="M4.5 2.5h7v11L8 10.75 4.5 13.5v-11Z" />,
  key: <path d="M10 9.5a3.5 3.5 0 1 0-3.4-2.7L2.5 10.9v2.6h2.6v-1.5h1.5v-1.5h1.5l.6-.6c.4.2.8.3 1.3.3Zm1-4.5h.01" />,
  device: <path d="M2.5 3.5h11v7.5h-11zM6 13.5h4M8 11v2.5" />,
  lock: <path d="M4 7.5h8v6H4zM5.75 7.5V5.25a2.25 2.25 0 0 1 4.5 0V7.5" />,
  shield: <path d="M8 1.75 13 3.5v4c0 3.1-2.1 5.6-5 6.75C5.1 13.1 3 10.6 3 7.5v-4l5-1.75Zm-2 6.5 1.5 1.5 2.75-3" />,
  alert: <path d="M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8 5v3.5M8 10.75h.01" />,
  star: <path d="m8 1.75 1.9 3.85 4.25.62-3.08 3 .73 4.23L8 11.45l-3.8 2 .73-4.23-3.08-3 4.25-.62L8 1.75Z" fill="currentColor" />,
  eyeOff: (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <path d="M6.5 6.5a2 2 0 0 0 3 2.6M2.5 2.5l11 11" />
    </>
  ),
  archive: (
    <>
      <path d="M2 3.5h12v3H2z" />
      <path d="M3.5 6.5v6h9v-6" />
      <path d="M6.5 9h3" />
    </>
  ),
  unarchive: (
    <>
      <path d="M2 3.5h12v3H2z" />
      <path d="M3.5 6.5v6h9v-6" />
      <path d="M8 11.5V8m-1.5 1.5L8 8l1.5 1.5" />
    </>
  ),
  more: (
    <>
      <circle cx="3.5" cy="8" r="0.9" fill="currentColor" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
      <circle cx="12.5" cy="8" r="0.9" fill="currentColor" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof GLYPHS;

/** The app's stroked glyph set, drawn on a 16px grid. */
export function Icon({ name, className = "h-3.5 w-3.5" }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[name]}
    </svg>
  );
}
