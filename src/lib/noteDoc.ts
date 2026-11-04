/**
 * Markdown to editor document and back.
 *
 * Markdown stays the stored form of a note, because it is what the export paths,
 * the Rust CLI and any later client read. The editor works on a ProseMirror
 * document, so every open parses and every save serialises.
 *
 * The parse direction reuses `parseMarkdown` rather than adding a second
 * markdown implementation: it is the one the security review covered, and a
 * second parser would be a second set of rules for what a hostile note can do.
 */

import {
  emptyTableLayout,
  MD_TABLE_FILLS,
  parseMarkdown,
  writeTableLayout,
  type MdBlock,
  type MdInline,
  type MdListItem,
  type MdTableFill,
} from "./markdown";

export type DocMark = { type: string; attrs?: Record<string, unknown> };

export type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
};

export type Doc = { type: "doc"; content: DocNode[] };

/** An empty paragraph, which is the smallest document the schema accepts. */
function emptyDoc(): Doc {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

export function markdownToDoc(markdown: string): Doc {
  const content = blocksToNodes(parseMarkdown(markdown));
  return content.length > 0 ? { type: "doc", content } : emptyDoc();
}

/** Ids of the photos a markdown body shows, read from the parsed document. */
export function attachmentIdsIn(markdown: string): Set<string> {
  const ids = new Set<string>();
  const visit = (node: DocNode) => {
    const id = node.attrs?.attachmentId;
    if (node.type === "attachmentImage" && typeof id === "string") ids.add(id);
    node.content?.forEach(visit);
  };
  markdownToDoc(markdown).content.forEach(visit);
  return ids;
}

function blocksToNodes(blocks: MdBlock[]): DocNode[] {
  const out: DocNode[] = [];
  for (const block of blocks) out.push(...blockToNodes(block));
  return out;
}

function blockToNodes(block: MdBlock): DocNode[] {
  switch (block.kind) {
    case "heading":
      return [{ type: "heading", attrs: { level: block.level }, ...inlineContent(block.children) }];
    case "paragraph":
      return [{ type: "paragraph", ...inlineContent(block.children) }];
    case "rule":
      return [{ type: "horizontalRule" }];
    case "code":
      return [
        {
          type: "codeBlock",
          attrs: { language: block.language },
          // An empty code block carries no text node: the schema rejects one.
          ...(block.text ? { content: [{ type: "text", text: block.text }] } : {}),
        },
      ];
    case "quote": {
      const inner = blocksToNodes(block.blocks);
      return [{ type: "blockquote", content: inner.length > 0 ? inner : [{ type: "paragraph" }] }];
    }
    case "list":
      return listToNodes(block);
    case "table":
      return [tableToNode(block)];
  }
}

/**
 * A markdown list may mix task items with plain ones; the editor schema keeps
 * `taskList` and `bulletList` apart, so a mixed list becomes one node per run.
 */
function listToNodes(block: Extract<MdBlock, { kind: "list" }>): DocNode[] {
  const out: DocNode[] = [];
  let run: MdListItem[] = [];
  let runIsTask = false;
  let consumed = 0;

  const flush = () => {
    if (run.length === 0) return;
    out.push(
      runIsTask
        ? { type: "taskList", content: run.map(taskItemNode) }
        : block.ordered
          ? {
              type: "orderedList",
              attrs: { start: block.start + consumed },
              content: run.map(listItemNode),
            }
          : { type: "bulletList", content: run.map(listItemNode) },
    );
    consumed += run.length;
    run = [];
  };

  for (const item of block.items) {
    if (run.length > 0 && item.task !== runIsTask) flush();
    runIsTask = item.task;
    run.push(item);
  }
  flush();
  return out;
}

/** A list item leads with a paragraph, which the schema requires. */
function itemContent(item: MdListItem): DocNode[] {
  return [{ type: "paragraph", ...inlineContent(item.children) }, ...blocksToNodes(item.blocks)];
}

function listItemNode(item: MdListItem): DocNode {
  return { type: "listItem", content: itemContent(item) };
}

function taskItemNode(item: MdListItem): DocNode {
  return { type: "taskItem", attrs: { checked: item.checked }, content: itemContent(item) };
}

function tableToNode(block: Extract<MdBlock, { kind: "table" }>): DocNode {
  const { heights, fills, rowspans } = block.layout;
  const grid = [block.header, ...block.rows];

  // A position covered by a rowspan reaching it carries no cell of its own, so
  // the placeholder the pipe row had to spell is dropped here.
  const covered = new Set<string>();
  grid.forEach((cells, r) => {
    let column = 0;
    for (const cell of cells) {
      const span = rowspans[`${r}.${column}`] ?? 1;
      for (let dr = 1; dr < span; dr += 1) {
        for (let dc = 0; dc < cell.span; dc += 1) covered.add(`${r + dr}.${column + dc}`);
      }
      column += cell.span;
    }
  });

  const row = (cells: Extract<MdBlock, { kind: "table" }>["header"], r: number, type: string): DocNode => {
    const content: DocNode[] = [];
    let column = 0;
    for (const cell of cells) {
      const at = `${r}.${column}`;
      if (!covered.has(at)) {
        content.push({
          type,
          attrs: {
            colspan: cell.span > 1 ? cell.span : 1,
            rowspan: rowspans[at] ?? 1,
            colwidth: null,
            align: block.align[column] ?? null,
            background: fills[at] ?? null,
          },
          content: [{ type: "paragraph", ...inlineContent(cell.children) }],
        });
      }
      column += cell.span;
    }
    const height = heights[r];
    return {
      type: "tableRow",
      ...(typeof height === "number" ? { attrs: { height } } : {}),
      content,
    };
  };

  return {
    type: "table",
    content: grid.map((cells, r) => row(cells, r, r === 0 ? "tableHeader" : "tableCell")),
  };
}

/** Omits `content` entirely when empty, which an empty block node requires. */
function inlineContent(nodes: MdInline[]): { content?: DocNode[] } {
  const content = inlineToNodes(nodes, []);
  return content.length > 0 ? { content } : {};
}

function inlineToNodes(nodes: MdInline[], marks: DocMark[]): DocNode[] {
  const out: DocNode[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        // A zero-length text node is not a valid document node.
        if (node.text) out.push(textNode(node.text, marks));
        break;
      case "code":
        if (node.text) out.push(textNode(node.text, withMark(marks, { type: "code" })));
        break;
      case "break":
        out.push({ type: "hardBreak" });
        break;
      case "strong":
        out.push(...inlineToNodes(node.children, withMark(marks, { type: "bold" })));
        break;
      case "em":
        out.push(...inlineToNodes(node.children, withMark(marks, { type: "italic" })));
        break;
      case "strike":
        out.push(...inlineToNodes(node.children, withMark(marks, { type: "strike" })));
        break;
      case "link":
        out.push(
          ...inlineToNodes(node.children, withMark(marks, { type: "link", attrs: { href: node.href } })),
        );
        break;
      case "image":
        // An inline atom, not a text node with marks: the editor renders it
        // through a node view that resolves the attachment id to a blob.
        out.push({
          type: "attachmentImage",
          attrs: { attachmentId: node.attachmentId, alt: node.alt },
        });
        break;
    }
  }
  return out;
}

function textNode(text: string, marks: DocMark[]): DocNode {
  return marks.length > 0 ? { type: "text", text, marks } : { type: "text", text };
}

function withMark(marks: DocMark[], mark: DocMark): DocMark[] {
  return marks.some((existing) => existing.type === mark.type) ? marks : [...marks, mark];
}

/* ------------------------------------------------------------------ *
 * Document to markdown
 * ------------------------------------------------------------------ */

export function docToMarkdown(doc: Doc | DocNode): string {
  return serializeBlocks(doc.content ?? [], "").replace(/[ \t]+$/gmu, "").trim();
}

function serializeBlocks(nodes: DocNode[], indent: string): string {
  return nodes
    .map((node) => serializeBlock(node, indent))
    .filter((part) => part !== null)
    .join("\n\n");
}

function serializeBlock(node: DocNode, indent: string): string {
  switch (node.type) {
    case "paragraph": {
      const text = serializeInline(node.content ?? []);
      // An empty paragraph still has to occupy a line, or two blocks either side
      // of it would merge into one on the way back in.
      return indent + escapeBlockStart(text);
    }
    case "heading": {
      const level = clampLevel(node.attrs?.level);
      return `${indent}${"#".repeat(level)} ${serializeInline(node.content ?? [])}`;
    }
    case "horizontalRule":
      return `${indent}---`;
    case "codeBlock":
      return serializeCodeBlock(node, indent);
    case "blockquote": {
      const body = serializeBlocks(node.content ?? [], "");
      return body
        .split("\n")
        .map((line) => `${indent}>${line ? ` ${line}` : ""}`)
        .join("\n");
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return serializeList(node, indent);
    case "table":
      return serializeTable(node, indent);
    default:
      // An unknown block still contributes its text rather than vanishing.
      return indent + serializeInline(node.content ?? []);
  }
}

function clampLevel(level: unknown): number {
  return typeof level === "number" && level >= 1 && level <= 6 ? Math.floor(level) : 1;
}

/**
 * The fence is widened past any run of backticks in the body, so a code block
 * containing a fence cannot close its own.
 */
function serializeCodeBlock(node: DocNode, indent: string): string {
  const text = (node.content ?? []).map((child) => child.text ?? "").join("");
  const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
  let longest = 0;
  for (const run of text.match(/`+/gu) ?? []) longest = Math.max(longest, run.length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  const body = text ? text.split("\n").map((line) => indent + line) : [];
  return [`${indent}${fence}${language}`, ...body, `${indent}${fence}`].join("\n");
}

function serializeList(node: DocNode, indent: string): string {
  const ordered = node.type === "orderedList";
  const task = node.type === "taskList";
  const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;
  const lines: string[] = [];

  (node.content ?? []).forEach((item, index) => {
    const marker = task
      ? `- [${item.attrs?.checked === true ? "x" : " "}] `
      : ordered
        ? `${start + index}. `
        : "- ";
    const [first, ...rest] = item.content ?? [];
    const head = first ? serializeBlock(first, "") : "";
    lines.push(`${indent}${marker}${head}`);
    // Continuation lines sit under the item's text, so the run reads as nested
    // rather than as a sibling of the list itself.
    const pad = indent + " ".repeat(marker.length);
    for (const block of rest) lines.push(serializeBlock(block, pad));
  });

  return lines.join("\n");
}

type PlacedCell = { cell: DocNode; row: number; column: number; colspan: number; rowspan: number };

/**
 * Where each cell sits once spans are taken into account. A row node holds only
 * the cells that begin in it, so a column is found by stepping over whatever a
 * rowspan above has already claimed.
 */
function placeCells(rows: DocNode[]): { placed: PlacedCell[]; covered: Set<string> } {
  const placed: PlacedCell[] = [];
  const covered = new Set<string>();
  rows.forEach((row, r) => {
    let column = 0;
    for (const cell of row.content ?? []) {
      while (covered.has(`${r}.${column}`)) column += 1;
      const colspan = spanOf(cell, "colspan");
      const rowspan = spanOf(cell, "rowspan");
      placed.push({ cell, row: r, column, colspan, rowspan });
      for (let dr = 1; dr < rowspan; dr += 1) {
        for (let dc = 0; dc < colspan; dc += 1) covered.add(`${r + dr}.${column + dc}`);
      }
      column += colspan;
    }
  });
  return { placed, covered };
}

function serializeTable(node: DocNode, indent: string): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return "";
  const cellText = (cell: DocNode): string =>
    serializeBlocks(cell.content ?? [], "")
      // A hard break has no spelling inside a cell, so it falls back to a space.
      .replace(/\\\n/gu, "\n")
      .replace(/\n+/gu, " ")
      .replace(/\|/gu, "\\|")
      .trim();

  const { placed } = placeCells(rows);
  // The header defines the width, as it does in the pipe grammar.
  const columns = placed
    .filter((entry) => entry.row === 0)
    .reduce((total, entry) => Math.max(total, entry.column + entry.colspan), 0);
  if (columns === 0) return "";

  const starts = new Map(placed.map((entry) => [`${entry.row}.${entry.column}`, entry]));

  /*
   * A row is written one grid column at a time. A column a colspan covers is an
   * empty segment with no space, which is what the parser folds back into the
   * span; a column a rowspan covers is an ordinary empty cell, so that a reader
   * knowing nothing of the sidecar still sees a well-formed table.
   */
  const line = (r: number): string => {
    let out = `${indent}|`;
    for (let column = 0; column < columns; ) {
      const entry = starts.get(`${r}.${column}`);
      if (entry === undefined) {
        out += "  |";
        column += 1;
        continue;
      }
      out += ` ${cellText(entry.cell)} |`;
      out += "|".repeat(Math.min(entry.colspan, columns - column) - 1);
      column += entry.colspan;
    }
    return out;
  };

  const alignAt = (column: number): string => {
    const entry = placed.find(
      (candidate) =>
        candidate.row === 0 && column >= candidate.column && column < candidate.column + candidate.colspan,
    );
    const align = entry?.cell.attrs?.align;
    return align === "center" ? ":-:" : align === "left" ? ":--" : align === "right" ? "--:" : "---";
  };

  const layout = emptyTableLayout();
  rows.forEach((row, r) => {
    const height = row.attrs?.height;
    if (typeof height === "number" && height > 0) layout.heights[r] = Math.round(height);
  });
  for (const entry of placed) {
    const at = `${entry.row}.${entry.column}`;
    const fill = entry.cell.attrs?.background;
    if (typeof fill === "string" && (MD_TABLE_FILLS as readonly string[]).includes(fill)) {
      layout.fills[at] = fill as MdTableFill;
    }
    if (entry.rowspan > 1) layout.rowspans[at] = entry.rowspan;
  }

  const sidecar = writeTableLayout(layout);
  const delimiter = Array.from({ length: columns }, (_, column) => alignAt(column));

  return [
    line(0),
    `${indent}| ${delimiter.join(" | ")} |`,
    ...rows.slice(1).map((_, index) => line(index + 1)),
    ...(sidecar ? [`${indent}${sidecar}`] : []),
  ].join("\n");
}

function spanOf(cell: DocNode, key: "colspan" | "rowspan"): number {
  const span = cell.attrs?.[key];
  return typeof span === "number" && span > 1 ? span : 1;
}

function serializeInline(nodes: DocNode[]): string {
  let out = "";
  for (const node of mergeRuns(nodes)) {
    if (node.type === "hardBreak") {
      out += "\\\n";
      continue;
    }
    if (node.type === "attachmentImage") {
      const id = typeof node.attrs?.attachmentId === "string" ? node.attrs.attachmentId : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      if (id) out += `![${alt}](attachment:${id})`;
      continue;
    }
    if (node.type !== "text" || !node.text) continue;
    out += applyMarks(node.text, node.marks ?? []);
  }
  return out;
}

/** Adjacent nodes carrying the same marks become one, so `**a****b**` cannot occur. */
function mergeRuns(nodes: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      last.type === "text" &&
      node.type === "text" &&
      sameMarks(last.marks ?? [], node.marks ?? [])
    ) {
      out[out.length - 1] = { ...last, text: (last.text ?? "") + (node.text ?? "") };
      continue;
    }
    out.push(node);
  }
  return out;
}

function sameMarks(a: DocMark[], b: DocMark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((mark, index) => {
    const other = b[index];
    return mark.type === other.type && JSON.stringify(mark.attrs ?? {}) === JSON.stringify(other.attrs ?? {});
  });
}

/** Innermost first: code, then the emphasis marks, then the link around them. */
function applyMarks(text: string, marks: DocMark[]): string {
  const has = (type: string) => marks.some((mark) => mark.type === type);
  let out: string;
  if (has("code")) {
    // Backticks inside the span widen its own fence rather than being escaped,
    // which is the only form inline code has.
    let longest = 0;
    for (const run of text.match(/`+/gu) ?? []) longest = Math.max(longest, run.length);
    const fence = "`".repeat(longest + 1);
    const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
    out = `${fence}${pad}${text}${pad}${fence}`;
  } else {
    out = escapeText(text);
  }
  if (has("strike")) out = wrap(out, "~~");
  if (has("bold")) out = wrap(out, "**");
  if (has("italic")) out = wrap(out, "*");
  const link = marks.find((mark) => mark.type === "link");
  const href = link && typeof link.attrs?.href === "string" ? link.attrs.href : "";
  if (href) out = `[${out}](${href})`;
  return out;
}

/**
 * Markers go inside the run's own whitespace: `** bold **` is not emphasis, so
 * the spaces have to stay outside the delimiters.
 */
function wrap(text: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/u.exec(text);
  if (match === null || match[2] === "") return text;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

/**
 * Characters the inline scanner acts on. `*` is escaped wherever it appears
 * because it pairs inside a word; `_` only where it could open emphasis, so
 * `snake_case_name` survives without backslashes. A node starting with `_` is
 * escaped because the character before it belongs to the previous node.
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/gu, "\\\\")
    .replace(/[`*[]/gu, "\\$&")
    .replace(/(?<![\p{L}\p{N}_])_/gu, "\\$&")
    .replace(/~~/gu, "\\~\\~");
}

/**
 * Prose that would otherwise open a block of its own. Every line is escaped, not
 * just the first: a hard break puts a newline inside a paragraph, and a line
 * after one would otherwise be read back as a list, heading or quote.
 */
function escapeBlockStart(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)(#{1,6})(\s|$)/u, "$1\\$2$3")
        .replace(/^(\s*)([-+>])(\s|$)/u, "$1\\$2$3")
        .replace(/^(\s*)(\d{1,9})([.)])(\s)/u, "$1$2\\$3$4"),
    )
    .join("\n");
}
