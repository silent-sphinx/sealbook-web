const PATHS: Record<string, string> = {
  plus: "M8 3.5v9M3.5 8h9",
  search: "M7.25 12a4.75 4.75 0 1 0 0-9.5 4.75 4.75 0 0 0 0 9.5ZM10.75 10.75 13.5 13.5",
  chevron: "m6 4 4 4-4 4",
  trash: "M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8",
  pencil: "M11.5 2.5 13.5 4.5 5.5 12.5 3 13l.5-2.5 8-8Z",
  close: "M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5",
  check: "m3.5 8.5 3 3 6-7",
  repeat: "M3 7V6a2 2 0 0 1 2-2h7.5M10.5 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H3.5M5.5 14l-2-2 2-2",
  checkbox: "M4 2.5h8A1.5 1.5 0 0 1 13.5 4v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5Zm1.5 5.75 1.75 1.75 3.25-3.75",
};

export function TaskIcon({
  name,
  className = "h-3.5 w-3.5",
}: {
  name: keyof typeof PATHS;
  className?: string;
}) {
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
      <path d={PATHS[name]} />
    </svg>
  );
}
