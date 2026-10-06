/**
 * Text transforms behind the editor's formatting toolbar. Pure over a value and
 * a selection, so the caller applies the result and restores the range.
 */

export type Selection = {
  text: string;
  start: number;
  end: number;
};

export type InlineAction = "bold" | "italic" | "strike" | "code";
export type ListAction = "bullet" | "ordered" | "task" | "quote";
export type HeadingAction = "paragraph" | "h1" | "h2" | "h3";
export type InsertAction = "link" | "codeblock" | "rule" | "table";
export type MarkdownAction = InlineAction | ListAction | HeadingAction | InsertAction;

const WRAP: Record<InlineAction, string> = {
  bold: "**",
  italic: "*",
  strike: "~~",
  code: "`",
};

const HEADING_LEVEL: Record<Exclude<HeadingAction, "paragraph">, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
};

const LIST_PREFIX = /^([ \t]*)(?:[-*+][ \t]\[[ xX]\][ \t]|[-*+][ \t]|\d{1,9}[.)][ \t])/u;
const QUOTE_PREFIX = /^([ \t]*)>[ \t]?/u;
const HEADING_PREFIX = /^([ \t]*)(#{1,6})[ \t]/u;
const INDENT = /^[ \t]*/u;

export function applyMarkdown(action: MarkdownAction, selection: Selection): Selection {
  switch (action) {
    case "bold":
    case "italic":
    case "strike":
    case "code":
      return toggleWrap(WRAP[action], selection);
    case "bullet":
    case "ordered":
    case "task":
    case "quote":
      return toggleList(action, selection);
    case "paragraph":
    case "h1":
    case "h2":
    case "h3":
      return setHeading(action, selection);
    case "link":
      return insertLink(selection);
    case "codeblock":
      return fence(selection);
    case "rule":
      return insertRule(selection);
    case "table":
      return insertTable(selection);
  }
}

/** Heading level under the caret, 0 for a line that is not a heading. */
export function headingLevelAt(text: string, position: number): number {
  const { from, to } = lineRange(text, position, position);
  const match = HEADING_PREFIX.exec(text.slice(from, to));
  return match ? match[2].length : 0;
}

/**
 * The lines the selection touches. One ending exactly on a line break stops at
 * the line before it, so dragging through a line does not prefix the next.
 */
function lineRange(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const tail = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const next = text.indexOf("\n", tail);
  return { from, to: next === -1 ? text.length : next };
}

function splice(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to);
}

function toggleWrap(marker: string, selection: Selection): Selection {
  const { text, start, end } = selection;
  const inner = text.slice(start, end);
  const width = marker.length;

  if (
    inner.length > width * 2 &&
    inner.startsWith(marker) &&
    inner.endsWith(marker)
  ) {
    const stripped = inner.slice(width, inner.length - width);
    return { text: splice(text, start, end, stripped), start, end: start + stripped.length };
  }

  if (
    start >= width &&
    text.slice(start - width, start) === marker &&
    text.slice(end, end + width) === marker
  ) {
    return {
      text: splice(text, start - width, end + width, inner),
      start: start - width,
      end: end - width,
    };
  }

  return {
    text: splice(text, start, end, marker + inner + marker),
    start: start + width,
    end: end + width,
  };
}

/** The list kinds replace one another, so no line ends up with two markers. */
function toggleList(action: ListAction, selection: Selection): Selection {
  const { text, start, end } = selection;
  const { from, to } = lineRange(text, start, end);
  const lines = text.slice(from, to).split("\n");
  const pattern = action === "quote" ? QUOTE_PREFIX : LIST_PREFIX;
  // A wholly blank block takes the prefix rather than counting as prefixed
  // already, so the button still works on an empty line.
  const written = lines.filter((line) => line.trim());
  const remove =
    written.length > 0 && written.every((line) => matchesKind(action, line));

  let ordinal = 0;
  const next = lines.map((line) => {
    const bare = line.replace(pattern, "$1");
    if (remove) return bare;
    if (!line.trim() && lines.length > 1) return line;
    ordinal += 1;
    const indent = INDENT.exec(bare)?.[0] ?? "";
    return indent + prefixFor(action, ordinal) + bare.slice(indent.length);
  });

  return reselect(selection, from, to, lines, next);
}

function matchesKind(action: ListAction, line: string): boolean {
  switch (action) {
    case "quote":
      return QUOTE_PREFIX.test(line);
    case "task":
      return /^[ \t]*[-*+][ \t]\[[ xX]\][ \t]/u.test(line);
    case "bullet":
      return /^[ \t]*[-*+][ \t](?!\[[ xX]\][ \t])/u.test(line);
    case "ordered":
      return /^[ \t]*\d{1,9}[.)][ \t]/u.test(line);
  }
}

function prefixFor(action: ListAction, ordinal: number): string {
  switch (action) {
    case "quote":
      return "> ";
    case "task":
      return "- [ ] ";
    case "bullet":
      return "- ";
    case "ordered":
      return `${ordinal}. `;
  }
}

function setHeading(action: HeadingAction, selection: Selection): Selection {
  const { text, start, end } = selection;
  const { from, to } = lineRange(text, start, end);
  const lines = text.slice(from, to).split("\n");
  const level = action === "paragraph" ? 0 : HEADING_LEVEL[action];
  const next = lines.map((line) => {
    const bare = line.replace(HEADING_PREFIX, "$1");
    if (level === 0) return bare;
    const indent = INDENT.exec(bare)?.[0] ?? "";
    return `${indent}${"#".repeat(level)} ${bare.slice(indent.length)}`;
  });
  return reselect(selection, from, to, lines, next);
}

/** A collapsed caret keeps its place in the line; a range covers the block. */
function reselect(
  selection: Selection,
  from: number,
  to: number,
  lines: string[],
  next: string[],
): Selection {
  const replaced = next.join("\n");
  const text = splice(selection.text, from, to, replaced);
  if (selection.start !== selection.end) {
    return { text, start: from, end: from + replaced.length };
  }
  const shift = next[0].length - lines[0].length;
  const caret = Math.min(Math.max(selection.start + shift, from), from + replaced.length);
  return { text, start: caret, end: caret };
}

/** `url` is left selected, so the target is what gets typed over. */
function insertLink(selection: Selection): Selection {
  const { text, start, end } = selection;
  const label = text.slice(start, end) || "text";
  const target = start + label.length + 3;
  return {
    text: splice(text, start, end, `[${label}](url)`),
    start: target,
    end: target + 3,
  };
}

function fence(selection: Selection): Selection {
  const { text, start, end } = selection;
  const { from, to } = lineRange(text, start, end);
  const body = text.slice(from, to);
  return {
    text: splice(text, from, to, "```\n" + body + "\n```"),
    start: from + 4,
    end: from + 4 + body.length,
  };
}

/** A starter table, with the first heading selected to type over. */
function insertTable(selection: Selection): Selection {
  const { text, start, end } = selection;
  const { from, to } = lineRange(text, start, end);
  const table = "| Column | Column |\n| --- | --- |\n|  |  |";
  // A table only ever starts a block, so it cannot be appended to a line of prose.
  if (text.slice(from, to).trim() === "") {
    return { text: splice(text, from, to, table), start: from + 2, end: from + 8 };
  }
  return {
    text: splice(text, to, to, `\n\n${table}`),
    start: to + 4,
    end: to + 10,
  };
}

function insertRule(selection: Selection): Selection {
  const { text, start, end } = selection;
  const { to } = lineRange(text, start, end);
  const inserted = text.slice(to, to + 1) === "\n" ? "\n---" : "\n---\n";
  const caret = to + inserted.length;
  return { text: splice(text, to, to, inserted), start: caret, end: caret };
}
