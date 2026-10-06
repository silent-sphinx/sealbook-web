import { describe, expect, it } from "vitest";

import { parseMarkdown } from "./markdown";
import type { MdBlock } from "./markdown";
import {
  addColumn,
  addRow,
  canMergeRight,
  canSplit,
  columns,
  deleteColumn,
  deleteRow,
  mergeRight,
  modelFromBlock,
  replaceTableLines,
  setAlign,
  setCellText,
  splitCell,
  tableToMarkdown,
  type TableModel,
} from "./tableEdit";

function tableBlock(source: string): Extract<MdBlock, { kind: "table" }> {
  const block = parseMarkdown(source)[0];
  if (block.kind !== "table") throw new Error(`expected a table, got ${block.kind}`);
  return block;
}

/** Parses markdown into a model, so a test reads as the table a user sees. */
const model = (source: string): TableModel => modelFromBlock(tableBlock(source));

/** The model's own markdown, for round-trip assertions. */
const md = tableToMarkdown;

/** Every row's total span, which has to stay equal to the column count. */
function widths(table: TableModel): number[] {
  return table.rows.map((row) => row.reduce((total, cell) => total + cell.span, 0));
}

function rectangular(table: TableModel) {
  expect(new Set(widths(table))).toEqual(new Set([columns(table)]));
}

const BASIC = "| a | b |\n| --- | --- |\n| 1 | 2 |";

describe("round trip", () => {
  it("rewrites a table it just read", () => {
    expect(md(model(BASIC))).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("keeps alignment", () => {
    const source = "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |";
    expect(md(model(source))).toBe(source);
  });

  it("keeps a merged cell merged", () => {
    const source = "| wide ||\n| --- | --- |\n| 1 | 2 |";
    const table = model(source);
    expect(table.rows[0][0].span).toBe(2);
    expect(md(table)).toBe(source);
    expect(tableBlock(md(table)).header[0].span).toBe(2);
  });

  it("re-escapes a pipe inside a cell", () => {
    const table = model("| a | b |\n| --- | --- |\n| one \\| two | 2 |");
    expect(table.rows[1][0].text).toBe("one | two");
    expect(md(table)).toContain("one \\| two");
    expect(modelFromBlock(tableBlock(md(table))).rows[1][0].text).toBe("one | two");
  });
});

describe("rows", () => {
  it("adds a row of empty cells", () => {
    const table = addRow(model(BASIC), 2);
    expect(md(table)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n|  |  |");
    rectangular(table);
  });

  it("never inserts above the header", () => {
    const table = addRow(model(BASIC), 0);
    expect(table.rows[0].map((cell) => cell.text)).toEqual(["a", "b"]);
  });

  it("deletes a body row", () => {
    const table = deleteRow(model("| a |\n| --- |\n| 1 |\n| 2 |"), 1);
    expect(md(table)).toBe("| a |\n| --- |\n| 2 |");
  });

  it("refuses to delete the header", () => {
    const table = model(BASIC);
    expect(deleteRow(table, 0)).toBe(table);
  });

  it("leaves a header-only table when the last row goes", () => {
    const table = deleteRow(model(BASIC), 1);
    expect(md(table)).toBe("| a | b |\n| --- | --- |");
    expect(tableBlock(md(table)).rows).toEqual([]);
  });
});

describe("columns", () => {
  it("adds a column at the end", () => {
    const table = addColumn(model(BASIC), 2);
    expect(md(table)).toBe("| a | b |  |\n| --- | --- | --- |\n| 1 | 2 |  |");
    rectangular(table);
  });

  it("adds a column in the middle", () => {
    const table = addColumn(model(BASIC), 1);
    expect(md(table)).toBe("| a |  | b |\n| --- | --- | --- |\n| 1 |  | 2 |");
    rectangular(table);
  });

  it("grows a spanning cell rather than cutting it in two", () => {
    const table = addColumn(model("| wide ||\n| --- | --- |\n| 1 | 2 |"), 1);
    expect(table.rows[0][0].span).toBe(3);
    expect(columns(table)).toBe(3);
    rectangular(table);
  });

  it("deletes a column", () => {
    const table = deleteColumn(model("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |"), 1);
    expect(md(table)).toBe("| a | c |\n| --- | --- |\n| 1 | 3 |");
    rectangular(table);
  });

  it("shrinks a spanning cell when a column it covers goes", () => {
    const table = deleteColumn(model("| wide ||\n| --- | --- |\n| 1 | 2 |"), 0);
    expect(columns(table)).toBe(1);
    expect(table.rows[0][0].span).toBe(1);
    rectangular(table);
  });

  it("refuses to delete the only column", () => {
    const table = model("| a |\n| --- |\n| 1 |");
    expect(deleteColumn(table, 0)).toBe(table);
  });

  it("drops the alignment of the column that goes", () => {
    const table = deleteColumn(model("| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |"), 1);
    expect(table.align).toEqual(["left", "right"]);
  });
});

describe("merging", () => {
  it("merges a cell into the one on its right", () => {
    const table = mergeRight(model(BASIC), { row: 0, cell: 0 });
    expect(table.rows[0][0].span).toBe(2);
    expect(md(table)).toBe("| a b ||\n| --- | --- |\n| 1 | 2 |");
    rectangular(table);
  });

  it("keeps the absorbed text rather than dropping it", () => {
    const table = mergeRight(model(BASIC), { row: 1, cell: 0 });
    expect(table.rows[1][0].text).toBe("1 2");
  });

  it("merges an empty neighbour without leaving a stray space", () => {
    const table = mergeRight(model("| a |  |\n| --- | --- |\n| 1 | 2 |"), { row: 0, cell: 0 });
    expect(table.rows[0][0].text).toBe("a");
  });

  it("will not merge the last cell in a row", () => {
    const table = model(BASIC);
    expect(canMergeRight(table, { row: 0, cell: 1 })).toBe(false);
    expect(mergeRight(table, { row: 0, cell: 1 })).toBe(table);
  });

  it("splits a merged cell back into single columns", () => {
    const merged = mergeRight(model("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |"), {
      row: 0,
      cell: 0,
    });
    const table = splitCell(merged, { row: 0, cell: 0 });
    expect(table.rows[0].map((cell) => cell.span)).toEqual([1, 1, 1]);
    expect(md(table)).toBe("| a b |  | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |");
    rectangular(table);
  });

  it("only offers a split on a cell that spans", () => {
    const table = model(BASIC);
    expect(canSplit(table, { row: 0, cell: 0 })).toBe(false);
    expect(canSplit(mergeRight(table, { row: 0, cell: 0 }), { row: 0, cell: 0 })).toBe(true);
  });

  it("merges three columns into one", () => {
    let table = model("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |");
    table = mergeRight(table, { row: 0, cell: 0 });
    table = mergeRight(table, { row: 0, cell: 0 });
    expect(table.rows[0][0].span).toBe(3);
    expect(md(table)).toBe("| a b c |||\n| --- | --- | --- |\n| 1 | 2 | 3 |");
    expect(tableBlock(md(table)).header[0].span).toBe(3);
  });
});

describe("cell text and alignment", () => {
  it("sets a cell's markdown", () => {
    const table = setCellText(model(BASIC), { row: 1, cell: 0 }, "**8 Aug**");
    expect(md(table)).toContain("| **8 Aug** | 2 |");
  });

  it("flattens a newline that would end the row", () => {
    const table = setCellText(model(BASIC), { row: 1, cell: 0 }, "one\ntwo");
    expect(table.rows[1][0].text).toBe("one two");
    expect(md(table).split("\n")).toHaveLength(3);
  });

  it("sets a column's alignment", () => {
    expect(md(setAlign(model(BASIC), 1, "right"))).toBe("| a | b |\n| --- | --: |\n| 1 | 2 |");
  });
});

describe("replaceTableLines", () => {
  it("puts the rewritten table back where it was", () => {
    const body = `## Week\n\n${BASIC}\n\nAfter.`;
    const block = parseMarkdown(body)[1];
    if (block.kind !== "table" || !block.line) throw new Error("expected a placed table");
    const next = replaceTableLines(body, block.line, md(addRow(model(BASIC), 2)));
    expect(next).toBe(`## Week\n\n${BASIC}\n|  |  |\n\nAfter.`);
  });

  it("leaves a body it cannot address alone", () => {
    const body = "| a |\n| --- |";
    expect(replaceTableLines(body, { from: 0, to: 99 }, "x")).toBe(body);
  });
});
