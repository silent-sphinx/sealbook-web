/**
 * A very small markdown subset, parsed to a tree of plain objects.
 */

export type MdInline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: MdInline[] }
  | { kind: "em"; children: MdInline[] }
  | { kind: "strike"; children: MdInline[] }
  | { kind: "code"; text: string }
  | { kind: "break" }
  | { kind: "link"; href: string; children: MdInline[] }
  /**
   * A note photo: `![alt](attachment:<id>)`. Only this internal scheme is
   * accepted as an image; the body renderer resolves the id to a locally-cached
   * blob. In any other markdown renderer it degrades to a broken image showing
   * the alt text, which is better than a silently dropped or garbage artifact.
   */
  | { kind: "image"; attachmentId: string; alt: string };

/** The scheme that marks a note-photo reference in the body. */
const ATTACHMENT_SCHEME = "attachment:";

export type MdListItem = {
  children: MdInline[];
  task: boolean;
  checked: boolean;
  /**
   * Index of the line this item's marker sits on, for writing a checkbox back.
   * Null where the lines are not the source's own, which is inside a quote.
   */
  line: number | null;
  /** Nested lists under this item. */
  blocks: MdBlock[];
};

/** A column's alignment, null where the delimiter row asked for none. */
export type MdAlign = "left" | "center" | "right" | null;

/**
 * A cell fill. Named rather than free colour: the sidecar is rewritten from the
 * editor, so an arbitrary value would be an unchecked string on its way into a
 * style attribute, and a fixed set can be tuned to the one theme.
 */
export const MD_TABLE_FILLS = ["grey", "red", "amber", "green", "blue", "purple"] as const;

export type MdTableFill = (typeof MD_TABLE_FILLS)[number];

/**
 * Table presentation the pipe grammar cannot spell, carried in a trailing
 * comment so that every other reader renders the table and ignores this.
 * Keys are row indices, or `row.column` grid positions with the header as row 0.
 */
export type MdTableLayout = {
  /** Row height in pixels. */
  heights: Record<number, number>;
  fills: Record<string, MdTableFill>;
  /** Rows a cell covers, only ever above 1. */
  rowspans: Record<string, number>;
};

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
      layout: MdTableLayout;
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

const ESCAPABLE = "\\`*_~[]()#>!+-.|";

export function parseMarkdown(source: string, base: string = PARSE_BASE): MdBlock[] {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n");
  return parseBlocks(lines, base, 1, 0);
}

/** Deeper than this and an indented item joins its parent's level instead. */
const LIST_DEPTH_LIMIT = 6;

/**
 * `lineBase` maps `lines[i]` to source line `lineBase + i`, and is null where
 * that mapping does not hold: inside a quote the markers are stripped first, so
 * an index into these lines does not address the source's own text.
 */
function parseBlocks(
  lines: string[],
  base: string,
  depth: number,
  lineBase: number | null,
): MdBlock[] {
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
      while (i < lines.length) {
        const closing = fenceMarker(lines[i]);
        // Only a run of the same character and at least as long closes the
        // block, so a shorter fence inside it is content rather than its end.
        if (closing !== null && closing.char === fence.char && closing.length >= fence.length) {
          break;
        }
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
        blocks.push({ kind: "quote", blocks: parseBlocks(quoted, base, depth + 1, null) });
      }
      continue;
    }

    const item = listItem(line);
    if (item) {
      const items: MdListItem[] = [];
      const ordered = item.ordered;
      const start = item.start;
      const baseIndent = item.indent;
      while (i < lines.length) {
        const current = listItem(lines[i]);
        // Indented past the first marker, so the run belongs under the item
        // above rather than beside it.
        if (
          current &&
          current.indent > baseIndent &&
          items.length > 0 &&
          depth < LIST_DEPTH_LIMIT &&
          !isThematicBreak(lines[i])
        ) {
          const from = i;
          while (i < lines.length) {
            const nested = listItem(lines[i]);
            if (nested && nested.indent > baseIndent && !isThematicBreak(lines[i])) {
              i += 1;
              continue;
            }
            if (!lines[i].trim()) {
              const next = lines[i + 1];
              const following = next === undefined ? null : listItem(next);
              if (following && following.indent > baseIndent && !isThematicBreak(next)) {
                i += 1;
                continue;
              }
            }
            break;
          }
          // Dedented, so the nested run parses against its own left edge, but
          // the line mapping is kept: only leading whitespace was removed.
          items[items.length - 1].blocks.push(
            ...parseBlocks(
              dedent(lines.slice(from, i)),
              base,
              depth + 1,
              lineBase === null ? null : lineBase + from,
            ),
          );
          continue;
        }
        if (current && current.ordered === ordered && !isThematicBreak(lines[i])) {
          items.push(toListItem(current.text, base, lineBase === null ? null : lineBase + i));
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

    const table = readTable(lines, i, base, lineBase);
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

/** The fence a line opens: which character, and how long the run is. */
function fenceMarker(line: string): { char: string; length: number } | null {
  const trimmed = line.trimStart();
  const char = trimmed[0];
  if (char !== "`" && char !== "~") return null;
  let length = 0;
  while (trimmed[length] === char) length += 1;
  return length >= 3 ? { char, length } : null;
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

function listItem(
  line: string,
): { ordered: boolean; start: number; text: string; indent: number } | null {
  const bullet = /^([ \t]*)([-*+])[ \t]+(.*)$/u.exec(line);
  if (bullet) {
    return { ordered: false, start: 1, text: bullet[3], indent: columnWidth(bullet[1]) };
  }
  const numbered = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/u.exec(line);
  if (numbered) {
    return {
      ordered: true,
      start: Number(numbered[2]),
      text: numbered[3],
      indent: columnWidth(numbered[1]),
    };
  }
  return null;
}

/** Leading whitespace as columns, a tab advancing to the next multiple of four. */
function columnWidth(indent: string): number {
  let width = 0;
  for (const char of indent) width = char === "\t" ? width + 4 - (width % 4) : width + 1;
  return width;
}

/**
 * Removes the whitespace prefix every written line in the run shares, so a
 * nested list parses against its own left edge. Only leading whitespace goes,
 * so line indexes into the run still address the same source lines.
 */
function dedent(lines: string[]): string[] {
  let prefix: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = /^[ \t]*/u.exec(line)?.[0] ?? "";
    if (prefix === null) {
      prefix = indent;
      continue;
    }
    let shared = 0;
    while (shared < prefix.length && shared < indent.length && prefix[shared] === indent[shared]) {
      shared += 1;
    }
    prefix = prefix.slice(0, shared);
  }
  const shared = prefix;
  if (!shared) return lines;
  return lines.map((line) => (line.startsWith(shared) ? line.slice(shared.length) : line.trimStart()));
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
  lineBase: number | null,
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

  const layout = readTableLayout(lines[i]);
  if (layout !== null) i += 1;

  return {
    block: {
      kind: "table",
      align,
      header: headerCells.map((cell) => toTableCell(cell, base)),
      rows,
      layout: layout ?? emptyTableLayout(),
      line: lineBase === null ? null : { from: lineBase + start, to: lineBase + i },
    },
    next: i,
  };
}

export function emptyTableLayout(): MdTableLayout {
  return { heights: {}, fills: {}, rowspans: {} };
}

const TABLE_LAYOUT = /^[ \t]*<!--[ \t]*sealbook:table[ \t]*(.*?)[ \t]*-->[ \t]*$/u;

/**
 * `<!-- sealbook:table h=0:44 bg=1.2:amber rs=1.0:2 -->`, the line a table may
 * be followed by. Each key holds a comma-separated list of `index:value`, and
 * anything unreadable is dropped rather than failing the line, so a note written
 * by a later version loses the attribute instead of growing a stray paragraph.
 */
function readTableLayout(line: string | undefined): MdTableLayout | null {
  if (line === undefined) return null;
  const match = TABLE_LAYOUT.exec(line);
  if (match === null) return null;

  const layout = emptyTableLayout();
  for (const group of match[1].split(/[ \t]+/u)) {
    const split = group.indexOf("=");
    if (split < 1) continue;
    const key = group.slice(0, split);
    for (const entry of group.slice(split + 1).split(",")) {
      const at = entry.indexOf(":");
      if (at < 1) continue;
      const index = entry.slice(0, at);
      const value = entry.slice(at + 1);
      if (key === "h" && /^\d+$/u.test(index)) {
        const height = Number(value);
        if (Number.isInteger(height) && height > 0 && height <= 2000) layout.heights[Number(index)] = height;
      } else if (key === "bg" && /^\d+\.\d+$/u.test(index)) {
        if ((MD_TABLE_FILLS as readonly string[]).includes(value)) layout.fills[index] = value as MdTableFill;
      } else if (key === "rs" && /^\d+\.\d+$/u.test(index)) {
        const span = Number(value);
        if (Number.isInteger(span) && span > 1 && span <= 1000) layout.rowspans[index] = span;
      }
    }
  }
  return layout;
}

/** The sidecar for a table, or an empty string where it would carry nothing. */
export function writeTableLayout(layout: MdTableLayout): string {
  const list = (entries: [string, number | string][]): string =>
    entries.map(([index, value]) => `${index}:${value}`).join(",");

  const groups: string[] = [];
  const heights = Object.entries(layout.heights).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (heights.length > 0) groups.push(`h=${list(heights)}`);
  const fills = Object.entries(layout.fills).sort(byPosition);
  if (fills.length > 0) groups.push(`bg=${list(fills)}`);
  const rowspans = Object.entries(layout.rowspans).sort(byPosition);
  if (rowspans.length > 0) groups.push(`rs=${list(rowspans)}`);

  return groups.length === 0 ? "" : `<!-- sealbook:table ${groups.join(" ")} -->`;
}

function byPosition(a: [string, unknown], b: [string, unknown]): number {
  const [aRow, aCol] = a[0].split(".").map(Number);
  const [bRow, bCol] = b[0].split(".").map(Number);
  return aRow - bRow || aCol - bCol;
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

function toListItem(text: string, base: string, line: number | null): MdListItem {
  const task = /^\[([ xX])\][ \t]+(.*)$/u.exec(text);
  if (task) {
    return {
      children: parseInline(task[2], base, false),
      task: true,
      checked: task[1].toLowerCase() === "x",
      line,
      blocks: [],
    };
  }
  return { children: parseInline(text, base, false), task: false, checked: false, line, blocks: [] };
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

    // A trailing backslash is a hard break, which is the spelling written back.
    if (char === "\\" && source[i + 1] === "\n") {
      flush();
      out.push({ kind: "break" });
      i += 2;
      continue;
    }

    if (char === "\\" && i + 1 < source.length && ESCAPABLE.includes(source[i + 1])) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    if (char === "\n") {
      // Two trailing spaces are GFM's other hard break. Otherwise a soft break
      // is a space, so a wrapped paragraph reads as one.
      if (/ {2,}$/u.test(buffer)) {
        buffer = buffer.replace(/ +$/u, "");
        flush();
        out.push({ kind: "break" });
      } else {
        buffer += " ";
      }
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
      // Underscore does not pair inside a word, so `compose_portainer` and
      // `a_b_c` stay literal. Asterisk keeps the intraword spelling GFM allows.
      const opens = char !== "_" || !isWordChar(source[i - 1]);
      const closes = (at: number, length: number): boolean =>
        char !== "_" || !isWordChar(source[at + length]);

      if (opens && runLength(source, i, char) >= 3) {
        const triple = char.repeat(3);
        const from = i + 3;
        const closing = failed(triple, from)
          ? -1
          : findDelimiter(source, from, triple, (at) => closes(at, 3));
        if (closing !== -1 && closing > from) {
          flush();
          const children = parseInline(source.slice(from, closing), base, inLink);
          out.push({ kind: "strong", children: [{ kind: "em", children }] });
          i = closing + 3;
          continue;
        }
        recordFailure(triple, from);
      }

      if (opens) {
        const double = source[i + 1] === char;
        const delim = double ? char + char : char;
        const from = i + delim.length;
        const closing = failed(delim, from)
          ? -1
          : findDelimiter(source, from, delim, (at) => closes(at, delim.length));
        if (closing === -1) recordFailure(delim, from);
        if (closing !== -1 && closing > from) {
          flush();
          const children = parseInline(source.slice(i + delim.length, closing), base, inLink);
          out.push(double ? { kind: "strong", children } : { kind: "em", children });
          i = closing + delim.length;
          continue;
        }
      }
    }

    // `![alt](attachment:<id>)` is a note photo. Any other `![alt](url)` degrades
    // to the link form: a remote image would be blocked by the CSP anyway, and a
    // `data:` one invites the size ceiling.
    if (char === "!" && source[i + 1] === "[" && !inLink) {
      const image = readAttachmentImage(source, i);
      if (image) {
        flush();
        out.push(image.node);
        i = image.end;
        continue;
      }
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

/** Letters, digits and `_`, the characters an underscore may not pair between. */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_]/u.test(char);
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
function findDelimiter(
  source: string,
  from: number,
  delim: string,
  accept?: (at: number) => boolean,
): number {
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
    if (source.startsWith(delim, i) && (accept === undefined || accept(i))) return i;
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

/**
 * Reads `![alt](attachment:<id>)` starting at the `!`. Returns null for anything
 * whose target is not the attachment scheme, so an ordinary image falls through
 * to the existing degrade path. The id is taken literally and validated by the
 * renderer against the note's attachment list, so an unknown id simply shows the
 * alt text rather than fetching anything.
 */
function readAttachmentImage(
  source: string,
  start: number,
): { node: MdInline; end: number } | null {
  // start is the `!`; the label begins at start + 1 with `[`.
  const labelStart = start + 1;
  const labelEnd = source.indexOf("]", labelStart + 1);
  if (labelEnd === -1 || source[labelEnd + 1] !== "(") return null;
  const close = source.indexOf(")", labelEnd + 2);
  if (close === -1) return null;
  const target = source.slice(labelEnd + 2, close).trim();
  if (!target.startsWith(ATTACHMENT_SCHEME)) return null;
  const attachmentId = target.slice(ATTACHMENT_SCHEME.length).trim();
  if (!attachmentId || /[\s()]/u.test(attachmentId)) return null;
  const alt = source.slice(labelStart + 1, labelEnd);
  return { node: { kind: "image", attachmentId, alt }, end: close + 1 };
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
/** Plain text of an inline tree, for a label that cannot carry elements. */
export function inlineText(nodes: MdInline[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text" || node.kind === "code") out += node.text;
    else if (node.kind === "break") out += " ";
    else if (node.kind === "image") out += node.alt;
    else out += inlineText(node.children);
  }
  return out;
}

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
