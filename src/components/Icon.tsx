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
  user: <path d="M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 13.5c0-2.4 2.2-4 5-4s5 1.6 5 4" />,
  calendar: <path d="M3.5 3.5h9a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" />,
  file: <path d="M4.5 2h5l3 3v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM9.5 2v3h3" />,
  page: <path d="M4.5 2h5l3 3v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM9.5 2v3h3M5.5 8.5h5M5.5 11h5" />,
  book: <path d="M3 2.75h7.5a1.75 1.75 0 0 1 1.75 1.75v8.75H4.75A1.75 1.75 0 0 1 3 11.5V2.75ZM3 11.5a1.75 1.75 0 0 1 1.75-1.75h7.5" />,
  tasks: <path d="m2.75 4.5 1.25 1.25 2.25-2.5M2.75 10.5l1.25 1.25 2.25-2.5M8.75 4.75h4.5M8.75 10.75h4.5" />,
  settings: (
    <>
      <path d="M6.94 3.42L7.07 1.77L8.93 1.77L9.06 3.42A4.7 4.7 0 0 1 10.49 4.01L11.75 2.94L13.06 4.25L11.99 5.51A4.7 4.7 0 0 1 12.58 6.94L14.23 7.07L14.23 8.93L12.58 9.06A4.7 4.7 0 0 1 11.99 10.49L13.06 11.75L11.75 13.06L10.49 11.99A4.7 4.7 0 0 1 9.06 12.58L8.93 14.23L7.07 14.23L6.94 12.58A4.7 4.7 0 0 1 5.51 11.99L4.25 13.06L2.94 11.75L4.01 10.49A4.7 4.7 0 0 1 3.42 9.06L1.77 8.93L1.77 7.07L3.42 6.94A4.7 4.7 0 0 1 4.01 5.51L2.94 4.25L4.25 2.94L5.51 4.01A4.7 4.7 0 0 1 6.94 3.42Z" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),
  refresh: <path d="M13 8a5 5 0 0 1-8.7 3.4M3 8a5 5 0 0 1 8.7-3.4M11.8 2.5v2.4H9.4M4.2 13.5v-2.4h2.4" />,
  devicePlus: <path d="M2.5 3.5h11V11h-11zM6 13.5h4M8 11v2.5M8 5.25v3M6.5 6.75h3" />,
  signOut: <path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10 5l3 3-3 3M13 8H6.5" />,
  sidebar: <path d="M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM6.5 2.5v11" />,
  offline: <path d="M4.5 12.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.5-.7 3.4 3.4 0 0 1 .8 6.7H4.5ZM2.5 2.5l11 11" />,
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  copy: <path d="M5.5 5.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />,
  upload: <path d="M8 10.25v-7.5M5 5.5 8 2.5l3 3M3 13h10" />,
  restore: <path d="M3.5 6.5h6a3 3 0 0 1 0 6H6M3.5 6.5 6 4M3.5 6.5 6 9" />,
  eye: <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />,
  warning: <path d="M8 2.5 14 13H2L8 2.5ZM8 6.5v3M8 11.5h.01" />,
  at: <path d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10.5 5.5v3a1.5 1.5 0 0 0 3 0V8a5.5 5.5 0 1 0-2.2 4.4" />,
  mail: <path d="M3 3.5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM2.25 5 8 9l5.75-4" />,
  phone: <path d="M4.5 2.5h2l1 3-1.5 1a7 7 0 0 0 3 3l1-1.5 3 1v2a1 1 0 0 1-1 1A10.5 10.5 0 0 1 3.5 3.5a1 1 0 0 1 1-1Z" />,
  camera: <path d="M2.5 5.5a1 1 0 0 1 1-1h1.5l1-1.5h4l1 1.5h1.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6ZM8 10.75a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" />,
  briefcase: <path d="M2.5 5.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V5.5ZM6 4.5v-1a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M2.5 8.5h11" />,
  image: <path d="M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM2.5 11l3-3 3 3 2-2 3 3M10.5 6a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z" />,
  globe: <path d="M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM2 8h12M8 2c1.7 1.7 2.5 3.7 2.5 6S9.7 12.3 8 14C6.3 12.3 5.5 10.3 5.5 8S6.3 3.7 8 2Z" />,
  puzzle: <path d="M6 4.5v-1a1.5 1.5 0 0 1 3 0v1h3a1 1 0 0 1 1 1V8h-1a1.5 1.5 0 0 1 0 3h1v2a1 1 0 0 1-1 1H9v-1a1.5 1.5 0 0 0-3 0v1H3.5a1 1 0 0 1-1-1V9.5h1a1.5 1.5 0 0 0 0-3h-1v-1a1 1 0 0 1 1-1H6Z" />,
  smartphone: <path d="M5 2.5h6a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM7 11.5h2" />,
  terminal: <path d="M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM4.5 6.5l2 1.5-2 1.5M8 10h3" />,
  database: <path d="M8 6c2.8 0 5-.9 5-2s-2.2-2-5-2-5 .9-5 2 2.2 2 5 2ZM3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />,
  toggle: <path d="M5 4.5h6a3.5 3.5 0 0 1 0 7H5a3.5 3.5 0 0 1 0-7ZM5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />,
  palette: <path d="M8 14a6 6 0 1 1 6-6c0 1.7-1.4 2-2.5 2H10a1.5 1.5 0 0 0-1 2.5c.4.5.3 1.5-1 1.5ZM5 8h.01M7 5h.01M10 5.5h.01" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof GLYPHS;

/**
 * The app's stroked glyph set, drawn on a 16px grid. `strokeWidth` is in grid
 * units, so a glyph shown larger than 16px scales its line with it; the rail
 * lowers it to keep the same weight there.
 */
export function Icon({
  name,
  className = "h-3.5 w-3.5",
  strokeWidth = 1.5,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[name]}
    </svg>
  );
}
