import type { MdAlign, MdBlock, MdTableCell } from "./markdown";

/**
 * The table behind the editor's graphical controls, and its markdown.
 *
 * A row holds cells, not columns: a cell written with a doubled pipe covers
 * `span` columns, so a cell's index is not its column. Every operation keeps
 * each row's total span equal to `align.length`, which is what makes the table
 * rectangular and the markdown it writes re-readable.
 */
export type TableCell = { text: string; span: number };

export type TableModel = {
  align: MdAlign[];
  /** Row 0 is the header. */
  rows: TableCell[][];
};

export type CellRef = { row: number; cell: number };

export function modelFromBlock(block: Extract<MdBlock, { kind: "table" }>): TableModel {
  const strip = (cells: MdTableCell[]): TableCell[] =>
    cells.map((cell) => ({ text: cell.raw, span: cell.span }));
  return { align: [...block.align], rows: [strip(block.header), ...block.rows.map(strip)] };
}

export function columns(model: TableModel): number {
  return model.align.length;
}

/** The column a cell starts in, which the spans to its left push along. */
export function columnOf(row: TableCell[], cell: number): number {
  let column = 0;
  for (let i = 0; i < cell && i < row.length; i += 1) column += row[i].span;
  return column;
}

/** The cell covering a column, and how far into its span that column sits. */
function cellAtColumn(row: TableCell[], column: number): { cell: number; offset: number } {
  let at = 0;
  for (let i = 0; i < row.length; i += 1) {
    if (column < at + row[i].span) return { cell: i, offset: column - at };
    at += row[i].span;
  }
  return { cell: row.length - 1, offset: 0 };
}

const copy = (model: TableModel): TableModel => ({
  align: [...model.align],
  rows: model.rows.map((row) => row.map((cell) => ({ ...cell }))),
});

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

export function setCellText(model: TableModel, ref: CellRef, text: string): TableModel {
  const next = copy(model);
  const row = next.rows[ref.row];
  if (!row?.[ref.cell]) return model;
  // A newline would end the row. Pipes are escaped when the table is written.
  row[ref.cell].text = text.replace(/[\r\n]+/gu, " ");
  return next;
}

export function setAlign(model: TableModel, column: number, align: MdAlign): TableModel {
  if (column < 0 || column >= model.align.length) return model;
  const next = copy(model);
  next.align[column] = align;
  return next;
}

/** A row of plain single-column cells, inserted at `at`. Never before the header. */
export function addRow(model: TableModel, at: number): TableModel {
  const next = copy(model);
  const row = Array.from({ length: columns(model) }, () => ({ text: "", span: 1 }));
  next.rows.splice(clamp(at, 1, next.rows.length), 0, row);
  return next;
}

export function deleteRow(model: TableModel, at: number): TableModel {
  // The header defines the columns, so it is the one row that cannot go.
  if (at <= 0 || at >= model.rows.length) return model;
  const next = copy(model);
  next.rows.splice(at, 1);
  return next;
}

/**
 * A column inserted at `at`. A cell already spanning across that boundary grows
 * rather than being cut in two, which is the only way to keep the row's total
 * span equal to the new column count.
 */
export function addColumn(model: TableModel, at: number): TableModel {
  const column = clamp(at, 0, columns(model));
  const next = copy(model);
  next.align.splice(column, 0, null);
  next.rows = next.rows.map((row) => {
    const { cell, offset } = cellAtColumn(row, column);
    if (column === columns(model)) return [...row, { text: "", span: 1 }];
    if (offset > 0) {
      const grown = row.map((item, index) =>
        index === cell ? { ...item, span: item.span + 1 } : item,
      );
      return grown;
    }
    const out = [...row];
    out.splice(cell, 0, { text: "", span: 1 });
    return out;
  });
  return next;
}

export function deleteColumn(model: TableModel, at: number): TableModel {
  if (columns(model) <= 1 || at < 0 || at >= columns(model)) return model;
  const next = copy(model);
  next.align.splice(at, 1);
  next.rows = next.rows.map((row) => {
    const { cell } = cellAtColumn(row, at);
    if (row[cell].span > 1) {
      return row.map((item, index) =>
        index === cell ? { ...item, span: item.span - 1 } : item,
      );
    }
    return row.filter((_, index) => index !== cell);
  });
  return next;
}

/** Absorbs the next cell in the row, keeping this one's text. */
export function mergeRight(model: TableModel, ref: CellRef): TableModel {
  const row = model.rows[ref.row];
  if (!row || ref.cell < 0 || ref.cell >= row.length - 1) return model;
  const next = copy(model);
  const target = next.rows[ref.row];
  const absorbed = target.splice(ref.cell + 1, 1)[0];
  target[ref.cell].span += absorbed.span;
  // The absorbed text would otherwise vanish without a trace.
  if (absorbed.text.trim()) {
    target[ref.cell].text = `${target[ref.cell].text} ${absorbed.text}`.trim();
  }
  return next;
}

export function splitCell(model: TableModel, ref: CellRef): TableModel {
  const row = model.rows[ref.row];
  if (!row?.[ref.cell] || row[ref.cell].span <= 1) return model;
  const next = copy(model);
  const target = next.rows[ref.row];
  const span = target[ref.cell].span;
  target[ref.cell].span = 1;
  target.splice(
    ref.cell + 1,
    0,
    ...Array.from({ length: span - 1 }, () => ({ text: "", span: 1 })),
  );
  return next;
}

export function canMergeRight(model: TableModel, ref: CellRef): boolean {
  const row = model.rows[ref.row];
  return Boolean(row) && ref.cell >= 0 && ref.cell < row.length - 1;
}

export function canSplit(model: TableModel, ref: CellRef): boolean {
  return (model.rows[ref.row]?.[ref.cell]?.span ?? 1) > 1;
}

const DELIMITER: Record<Exclude<MdAlign, null> | "none", string> = {
  none: "---",
  left: ":--",
  center: ":-:",
  right: "--:",
};

/**
 * Markdown for the table. A spanning cell is written as its text followed by one
 * pipe per column it covers, which is how `cellsWithSpans` reads it back.
 */
export function tableToMarkdown(model: TableModel): string {
  const [header, ...body] = model.rows;
  // A pipe in a cell is escaped here rather than in the model, so the text the
  // editor shows is the text the reader sees.
  const escape = (text: string) => text.replace(/\|/gu, "\\|");
  const row = (cells: TableCell[]) =>
    `|${cells.map((cell) => ` ${escape(cell.text)} ${"|".repeat(cell.span - 1)}`).join("|")}|`;
  const delimiter = `| ${model.align.map((align) => DELIMITER[align ?? "none"]).join(" | ")} |`;
  return [row(header), delimiter, ...body.map(row)].join("\n");
}

/**
 * Puts a rewritten table back into a note body.
 *
 * The body is normalised to `\n` first, because the line numbers come from the
 * parser, which normalises before it splits.
 */
export function replaceTableLines(
  body: string,
  line: { from: number; to: number },
  markdown: string,
): string {
  const lines = body.replace(/\r\n?/gu, "\n").split("\n");
  if (line.from < 0 || line.to > lines.length || line.from >= line.to) return body;
  lines.splice(line.from, line.to - line.from, ...markdown.split("\n"));
  return lines.join("\n");
}
