/**
 * A very small markdown subset, parsed to a tree of plain objects.
 */

export type MdInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: MdInline[] }
  | { kind: "em"; children: MdInline[] }
  | { kind: "strike"; children: MdInline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: MdInline[] };

export type MdListItem = {
  children: MdInline[];
  task: boolean;
  checked: boolean;
};

/** A column's alignment, null where the delimiter row asked for none. */
export type MdAlign = "left" | "center" | "right" | null;

export type MdTableCell = {
  children: MdInline[];
  /** Markdown source of the cell, for the table editor to put back. */
  raw: string;
  /** Columns covered. Above 1 only for a cell written with a doubled pipe. */
  span: number;
};

export type MdBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { kind: "paragraph"; children: MdInline[] }
  | { kind: "list"; ordered: boolean; start: number; items: MdListItem[] }
  | { kind: "quote"; blocks: MdBlock[] }
  | { kind: "code"; language: string | null; text: string }
  | {
      kind: "table";
      align: MdAlign[];
      header: MdTableCell[];
      rows: MdTableCell[][];
      /**
       * Lines the table occupies, for writing an edit back. Set only at the top
       * level: inside a quote the parser sees lines with the marker stripped, so
       * an index into them would not address the note's own text.
       */
      line: { from: number; to: number } | null;
    }
  | { kind: "rule" };

/**
 * Base for resolving a relative link. A fixed default rather than
 * `window.location` keeps the parser pure, so it is testable under node and
 * gives the same answer wherever it runs.
 */
const PARSE_BASE = "https://sealbook.invalid/";

/** Deeper than this and `>>>>>` stays literal, so input cannot drive recursion. */
const QUOTE_DEPTH_LIMIT = 4;

const ESCAPABLE = "\\`*_~[]()#>!+-.";

export function parseMarkdown(source: string, base: string = PARSE_BASE): MdBlock[] {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  return parseBlocks(lines, base, 1);
}

function parseBlocks(lines: string[], base: string, depth: number): MdBlock[] {
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = fenceMarker(line);
    if (fence) {
      const language = line.trim().slice(fence.length).trim() || null;
      const body: string[] = [];
      i += 1;
      // An unterminated fence runs to the end of the input rather than
      // swallowing the rest of the note.
      while (i < lines.length && fenceMarker(lines[i]) !== fence) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: "code", language, text: body.join("\n") });
      continue;
    }

    const heading = /^ {0,3}(#{1,6})[ \t]+(.*)$/u.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2].replace(/[ \t]+#+[ \t]*$/u, ""), base, false),
      });
      i += 1;
      continue;
    }

    // Before the list rule, so `- - -` is a break rather than a one-item list.
    if (isThematicBreak(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    if (/^ {0,3}>/u.test(line)) {
      const quoted: string[] = [];
      // Lazy continuation, but only for plain text: a heading or list after a
      // quoted line starts its own block rather than being swallowed.
      while (
        i < lines.length &&
        (/^ {0,3}>/u.test(lines[i]) ||
          (quoted.length > 0 && lines[i].trim() !== "" && !startsBlock(lines[i])))
      ) {
        quoted.push(lines[i].replace(/^ {0,3}>[ \t]?/u, ""));
        i += 1;
      }
      if (depth >= QUOTE_DEPTH_LIMIT) {
        blocks.push({ kind: "paragraph", children: parseInline(quoted.join("\n"), base, false) });
      } else {
        blocks.push({ kind: "quote", blocks: parseBlocks(quoted, base, depth + 1) });
      }
      continue;
    }

    const item = listItem(line);
    if (item) {
      const items: MdListItem[] = [];
      const ordered = item.ordered;
      const start = item.start;
      while (i < lines.length) {
        const current = listItem(lines[i]);
        if (current && current.ordered === ordered && !isThematicBreak(lines[i])) {
          items.push(toListItem(current.text, base));
          i += 1;
          continue;
        }
        // One blank line between items keeps the list together; anything else
        // ends it.
        if (!lines[i].trim()) {
          const next = lines[i + 1];
          const following = next === undefined ? null : listItem(next);
          if (following && following.ordered === ordered && !isThematicBreak(next)) {
            i += 1;
            continue;
          }
        }
        break;
      }
      blocks.push({ kind: "list", ordered, start, items });
      continue;
    }

    const table = readTable(lines, i, base, depth);
    if (table) {
      blocks.push(table.block);
      i = table.next;
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    if (paragraph.length === 0) {
      // Defensive: a line that claims to start a block but reached no branch
      // above would otherwise loop for ever.
      paragraph.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(paragraph.join("\n"), base, false) });
  }
  return blocks;
}

function startsBlock(line: string): boolean {
  return (
    fenceMarker(line) !== null ||
    /^ {0,3}(#{1,6})[ \t]+/u.test(line) ||
    /^ {0,3}>/u.test(line) ||
    isThematicBreak(line) ||
    listItem(line) !== null
  );
}

function fenceMarker(line: string): string | null {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("```")) return "```";
  if (trimmed.startsWith("~~~")) return "~~~";
  return null;
}

/**
 * Three or more of the same marker, spaces allowed between. Checked by scanning
 * rather than with a regex, so a line of fifty thousand asterisks cannot make a
 * quantifier backtrack.
 */
function isThematicBreak(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  const marker = trimmed[0];
  if (marker !== "-" && marker !== "*" && marker !== "_") return false;
  let count = 0;
  for (const char of trimmed) {
    if (char === marker) count += 1;
    else if (char !== " " && char !== "\t") return false;
  }
  return count >= 3;
}

function listItem(line: string): { ordered: boolean; start: number; text: string } | null {
  const bullet = /^[ \t]*([-*+])[ \t]+(.*)$/u.exec(line);
  if (bullet) return { ordered: false, start: 1, text: bullet[2] };
  const numbered = /^[ \t]*(\d{1,9})[.)][ \t]+(.*)$/u.exec(line);
  if (numbered) return { ordered: true, start: Number(numbered[1]), text: numbered[2] };
  return null;
}

/**
 * A GFM pipe table: a header row, a delimiter row describing exactly those
 * columns, then rows until a blank line or another block.
 *
 * Like GFM, this does not interrupt a paragraph. `startsBlock` cannot report a
 * header row without looking at the line after it, and a table that could cut a
 * paragraph in half would make every line containing a pipe ambiguous.
 */
function readTable(
  lines: string[],
  start: number,
  base: string,
  depth: number,
): { block: MdBlock; next: number } | null {
  const header = splitRow(lines[start]);
  if (header === null) return null;
  const delimiter = lines[start + 1];
  if (delimiter === undefined) return null;
  const align = delimiterAlignments(delimiter);
  if (align === null) return null;
  const columns = align.length;
  const headerCells = cellsWithSpans(header);
  if (width(headerCells) !== columns) return null;

  const rows: MdTableCell[][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
    const cells = splitRow(lines[i]);
    if (cells === null) break;
    rows.push(fitRow(cellsWithSpans(cells), columns).map((cell) => toTableCell(cell, base)));
    i += 1;
  }

  return {
    block: {
      kind: "table",
      align,
      header: headerCells.map((cell) => toTableCell(cell, base)),
      rows,
      line: depth === 1 ? { from: start, to: i } : null,
    },
    next: i,
  };
}

type RawCell = { text: string; span: number };

function toTableCell({ text, span }: RawCell, base: string): MdTableCell {
  const raw = text.trim();
  return { children: parseInline(raw, base, false), raw, span };
}

function width(cells: RawCell[]): number {
  let total = 0;
  for (const cell of cells) total += cell.span;
  return total;
}

/**
 * Folds the doubled pipes of `| spans two ||` into a span on the cell before
 * them. A zero-length segment is the only marker: `| a | | b |`, with a space
 * between the pipes, stays an ordinary empty cell.
 */
function cellsWithSpans(segments: string[]): RawCell[] {
  const cells: RawCell[] = [];
  for (const segment of segments) {
    if (segment === "" && cells.length > 0) {
      cells[cells.length - 1].span += 1;
      continue;
    }
    cells.push({ text: segment, span: 1 });
  }
  return cells;
}

/** Pads a short row and drops what runs past the header, spans included. */
function fitRow(cells: RawCell[], columns: number): RawCell[] {
  const out: RawCell[] = [];
  let used = 0;
  for (const cell of cells) {
    if (used >= columns) break;
    const span = Math.min(cell.span, columns - used);
    out.push({ text: cell.text, span });
    used += span;
  }
  while (used < columns) {
    out.push({ text: "", span: 1 });
    used += 1;
  }
  return out;
}

/**
 * One row's cells, split on unescaped pipes. A row has to carry at least one, so
 * a bare line of text cannot be read as a single-column table.
 */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  let body = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === "\\" && body[i + 1] === "|") {
      cell += "|";
      i += 1;
      continue;
    }
    if (body[i] === "|") {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += body[i];
  }
  cells.push(cell);
  return cells;
}

/**
 * `| --- | :-: |`: every cell dashes, with colons for alignment. Scanned rather
 * than matched, so a long line of dashes that is not a delimiter cannot make a
 * quantifier backtrack.
 */
function delimiterAlignments(line: string): MdAlign[] | null {
  const cells = splitRow(line);
  if (cells === null) return null;
  const align: MdAlign[] = [];
  for (const cell of cells) {
    const text = cell.trim();
    const left = text.startsWith(":");
    const right = text.length > 1 && text.endsWith(":");
    const from = left ? 1 : 0;
    const to = right ? text.length - 1 : text.length;
    if (to <= from) return null;
    for (let i = from; i < to; i += 1) {
      if (text[i] !== "-") return null;
    }
    align.push(left && right ? "center" : left ? "left" : right ? "right" : null);
  }
  return align;
}

function toListItem(text: string, base: string): MdListItem {
  const task = /^\[([ xX])\][ \t]+(.*)$/u.exec(text);
  if (task) {
    return {
      children: parseInline(task[2], base, false),
      task: true,
      checked: task[1].toLowerCase() === "x",
    };
  }
  return { children: parseInline(text, base, false), task: false, checked: false };
}

/**
 * Single-pass inline scanner. No regex with a nested quantifier runs over the
 * body: at a 4 MiB object ceiling, a lazily-quantified emphasis pattern against
 * many unmatched delimiters is a real hang of the reader's own tab.
 */
function parseInline(source: string, base: string, inLink: boolean): MdInline[] {
  const out: MdInline[] = [];
  let buffer = "";
  let i = 0;
  // A closer that is absent after one position is absent after every later one,
  // so remembering the first failure is what keeps this linear. Without it a body
  // of unmatched delimiters is quadratic, which at this size ceiling is a hang.
  const noCloser = new Map<string, number>();
  const failed = (key: string, from: number): boolean => {
    const first = noCloser.get(key);
    return first !== undefined && from >= first;
  };
  const recordFailure = (key: string, from: number) => {
    if (!noCloser.has(key)) noCloser.set(key, from);
  };

  const flush = () => {
    if (buffer) {
      out.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  while (i < source.length) {
    const char = source[i];

    if (char === "\\" && i + 1 < source.length && ESCAPABLE.includes(source[i + 1])) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    // A soft break is a space, so a wrapped paragraph reads as one.
    if (char === "\n") {
      buffer += " ";
      i += 1;
      continue;
    }

    if (char === "`") {
      const run = runLength(source, i, "`");
      const key = `code:${run}`;
      const closing = failed(key, i + run) ? -1 : findRun(source, i + run, "`", run);
      if (closing !== -1) {
        flush();
        out.push({ kind: "code", text: source.slice(i + run, closing).replace(/\n/gu, " ").trim() });
        i = closing + run;
        continue;
      }
      // The whole run is literal, so step over all of it rather than one char.
      recordFailure(key, i + run);
      buffer += source.slice(i, i + run);
      i += run;
      continue;
    }

    if (char === "~" && source[i + 1] === "~") {
      const closing = failed("~~", i + 2) ? -1 : findDelimiter(source, i + 2, "~~");
      if (closing === -1) recordFailure("~~", i + 2);
      if (closing !== -1) {
        flush();
        out.push({ kind: "strike", children: parseInline(source.slice(i + 2, closing), base, inLink) });
        i = closing + 2;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      const double = source[i + 1] === char;
      const delim = double ? char + char : char;
      const from = i + delim.length;
      const closing = failed(delim, from) ? -1 : findDelimiter(source, from, delim);
      if (closing === -1) recordFailure(delim, from);
      if (closing !== -1 && closing > from) {
        flush();
        const children = parseInline(source.slice(i + delim.length, closing), base, inLink);
        out.push(double ? { kind: "strong", children } : { kind: "em", children });
        i = closing + delim.length;
        continue;
      }
    }

    // `![alt](url)` degrades to the link form: a remote image would be blocked by
    // the CSP anyway, and allowing a `data:` one invites the size ceiling.
    if (char === "!" && source[i + 1] === "[" && !inLink) {
      i += 1;
      continue;
    }

    if (char === "[" && !inLink) {
      // No `](` left in the body means no link can start here or later.
      if (failed("link", i) || source.indexOf("](", i) === -1) {
        recordFailure("link", i);
      } else {
        const link = readLink(source, i, base);
        if (link) {
          flush();
          out.push(link.node);
          i = link.end;
          continue;
        }
      }
    }

    if ((char === "h" || char === "H") && !inLink && isAutolinkStart(source, i)) {
      const end = urlEnd(source, i);
      const href = safeHref(source.slice(i, end), base);
      if (href) {
        flush();
        out.push({ kind: "link", href, children: [{ kind: "text", text: source.slice(i, end) }] });
        i = end;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }

  flush();
  return out;
}

function runLength(source: string, start: number, char: string): number {
  let n = 0;
  while (source[start + n] === char) n += 1;
  return n;
}

/** The next run of exactly `length` backticks, so `` `a` `` nests correctly. */
function findRun(source: string, from: number, char: string, length: number): number {
  let i = from;
  while (i < source.length) {
    if (source[i] !== char) {
      i += 1;
      continue;
    }
    const run = runLength(source, i, char);
    if (run === length) return i;
    i += run;
  }
  return -1;
}

/**
 * The closing emphasis delimiter, skipping code spans so that a `*` inside
 * backticks cannot close emphasis opened outside them.
 */
function findDelimiter(source: string, from: number, delim: string): number {
  let i = from;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "`") {
      const run = runLength(source, i, "`");
      const closing = findRun(source, i + run, "`", run);
      i = closing === -1 ? i + run : closing + run;
      continue;
    }
    if (source.startsWith(delim, i)) return i;
    i += 1;
  }
  return -1;
}

function readLink(
  source: string,
  start: number,
  base: string,
): { node: MdInline; end: number } | null {
  let depth = 0;
  let i = start;
  let labelEnd = -1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "[") depth += 1;
    else if (source[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        labelEnd = i;
        break;
      }
    }
    i += 1;
  }
  if (labelEnd === -1 || source[labelEnd + 1] !== "(") return null;
  const close = source.indexOf(")", labelEnd + 2);
  if (close === -1) return null;
  const href = safeHref(source.slice(labelEnd + 2, close), base);
  if (!href) {
    // A rejected target renders as its own source, visibly and inertly, rather
    // than as a link the reader might trust.
    return {
      node: { kind: "text", text: source.slice(start, close + 1) },
      end: close + 1,
    };
  }
  return {
    node: {
      kind: "link",
      href,
      children: parseInline(source.slice(start + 1, labelEnd), base, true),
    },
    end: close + 1,
  };
}

function isAutolinkStart(source: string, i: number): boolean {
  const before = i === 0 ? "" : source[i - 1];
  if (before && /[\p{L}\p{N}]/u.test(before)) return false;
  const rest = source.slice(i, i + 8).toLowerCase();
  return rest.startsWith("http://") || rest.startsWith("https://");
}

function urlEnd(source: string, start: number): number {
  let i = start;
  while (i < source.length && !/[\s<>"']/u.test(source[i])) i += 1;
  while (i > start && ".,;:!?)]}".includes(source[i - 1])) i -= 1;
  return i;
}

/**
 * The only way a `link` node is created. An allow-list of schemes, so
 * `javascript:`, `data:`, `vbscript:`, `blob:` and anything exotic are rejected
 * without having to be enumerated.
 */
export function safeHref(raw: string, base: string = PARSE_BASE): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /[\s<>"]/u.test(trimmed)) return null;
  try {
    // Resolving against a base is what gives a relative target a scheme to
    // check; a bare `foo` would pass a naive prefix test.
    const url = new URL(trimmed, base);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return url.href;
    }
    return null;
  } catch {
    return null;
  }
}

/** Plain text for a list row preview: markers dropped, whitespace collapsed. */
export function stripMarkdown(source: string): string {
  return source
    .replace(/\r\n?/gu, "\n")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gmu, "")
    .replace(/^[ \t]*>[ \t]?/gmu, "")
    .replace(/^[ \t]*[-*+][ \t]+(\[[ xX]\][ \t]+)?/gmu, "")
    .replace(/^[ \t]*\d{1,9}[.)][ \t]+/gmu, "")
    .replace(/^[-\t :|]+$/gmu, " ")
    .replace(/\|/gu, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/[*_~]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
