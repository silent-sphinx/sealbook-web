import { focusRing } from "../lib/styles";
import type { HeadingAction, MarkdownAction } from "../lib/markdownEdit";

type Props = {
  /** Heading level under the caret, 0 for a plain paragraph. */
  headingLevel: number;
  onAction: (action: MarkdownAction) => void;
  disabled?: boolean;
};

const HEADING_OPTIONS: { value: HeadingAction; label: string; level: number }[] = [
  { value: "paragraph", label: "Paragraph", level: 0 },
  { value: "h1", label: "Heading 1", level: 1 },
  { value: "h2", label: "Heading 2", level: 2 },
  { value: "h3", label: "Heading 3", level: 3 },
];

function Stroke({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Letterforms, not paths: the font already draws these three. */
const GLYPHS: Partial<Record<MarkdownAction, React.ReactNode>> = {
  bold: <span className="text-[13px] font-bold leading-none">B</span>,
  italic: <span className="font-serif text-[13px] italic leading-none">I</span>,
  strike: <span className="text-[13px] leading-none line-through">S</span>,
};

const ICONS: Partial<Record<MarkdownAction, React.ReactNode>> = {
  code: <Stroke><path d="M6 4 2.5 8 6 12M10 4l3.5 4-3.5 4" /></Stroke>,
  bullet: <Stroke><path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5" /><circle cx="3" cy="4.5" r=".9" fill="currentColor" stroke="none" /><circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none" /><circle cx="3" cy="11.5" r=".9" fill="currentColor" stroke="none" /></Stroke>,
  ordered: <Stroke><path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7M2 3.5h.9v2.2M2 8h1.8L2 10.2h1.8M2 11.3h1.8v1.1H2.6v1.1H4" /></Stroke>,
  task: <Stroke><rect x="2" y="2.6" width="4.4" height="4.4" rx="1.2" /><path d="M9 4.8h4.8M3 11.4l1.2 1.2 2.2-2.6M9 11.6h4.8" /></Stroke>,
  quote: <Stroke><path d="M3 4v8" /><path d="M6.5 5h6.5M6.5 8h6.5M6.5 11h4" /></Stroke>,
  link: <Stroke><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.9.9" /><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.9-.9" /></Stroke>,
  codeblock: <Stroke><rect x="1.8" y="3" width="12.4" height="10" rx="1.6" /><path d="M6.2 6.6 4.5 8l1.7 1.4M9.8 6.6 11.5 8l-1.7 1.4" /></Stroke>,
  table: <Stroke><rect x="1.8" y="3" width="12.4" height="10" rx="1.4" /><path d="M1.8 6.4h12.4M6.2 6.4V13M10.2 6.4V13" /></Stroke>,
  rule: <Stroke><path d="M2 8h12M4 4.5h8M4 11.5h8" strokeOpacity=".45" /><path d="M2 8h12" /></Stroke>,
};

const GROUPS: { action: MarkdownAction; label: string; hint: string }[][] = [
  [
    { action: "bold", label: "Bold", hint: "Bold" },
    { action: "italic", label: "Italic", hint: "Italic" },
    { action: "strike", label: "Strikethrough", hint: "Strikethrough" },
    { action: "code", label: "Inline code", hint: "Inline code" },
  ],
  [
    { action: "bullet", label: "Bulleted list", hint: "Bulleted list" },
    { action: "ordered", label: "Numbered list", hint: "Numbered list" },
    { action: "task", label: "Task list", hint: "Task list" },
    { action: "quote", label: "Quote", hint: "Quote" },
  ],
  [
    { action: "link", label: "Link", hint: "Link" },
    { action: "codeblock", label: "Code block", hint: "Code block" },
    { action: "rule", label: "Divider", hint: "Divider" },
    { action: "table", label: "Table", hint: "Table" },
  ],
];

/**
 * Each button is a markdown transform over the textarea's selection, not a
 * rich-text command: the note is stored as the source a user could have typed.
 */
export function NoteToolbar({ headingLevel, onAction, disabled = false }: Props) {
  const current =
    HEADING_OPTIONS.find((option) => option.level === headingLevel) ?? HEADING_OPTIONS[0];

  return (
    <div className="note-toolbar flex h-full items-center gap-0.5 overflow-x-auto px-2">
      <select
        value={current.value}
        onChange={(event) => onAction(event.target.value as HeadingAction)}
        disabled={disabled}
        aria-label="Block style"
        className={`h-7 shrink-0 cursor-pointer appearance-none rounded-md border-0 bg-transparent py-0 pl-2 pr-6 text-[11px] font-medium text-mute transition-colors hover:bg-surface hover:text-text disabled:opacity-40 ${focusRing}`}
      >
        {HEADING_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {GROUPS.map((group, index) => (
        <div key={index} className="flex items-center gap-0.5">
          <span className="note-toolbar-divider mx-1.5" aria-hidden="true" />
          {group.map(({ action, label, hint }) => (
            <button
              key={action}
              type="button"
              onClick={() => onAction(action)}
              disabled={disabled}
              title={hint}
              aria-label={label}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-mute transition-colors hover:bg-surface hover:text-text disabled:opacity-40 disabled:hover:bg-transparent ${focusRing}`}
            >
              {GLYPHS[action] ?? ICONS[action]}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
