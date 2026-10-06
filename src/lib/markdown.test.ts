import { describe, expect, it } from "vitest";

import { inlineText, parseMarkdown, repairPipeTables, safeHref, stripMarkdown } from "./markdown";
import type { MdBlock, MdInline, MdListItem, MdTableCell } from "./markdown";

const text = (value: string): MdInline => ({ kind: "text", text: value });

/** Flattens a tree to the text a reader would see, for assertions about content. */
function flatten(nodes: MdInline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
        case "code":
          return node.text;
        case "break":
          return " ";
        default:
          return flatten(node.children);
      }
    })
    .join("");
}

function only(source: string): MdBlock {
  const blocks = parseMarkdown(source);
  expect(blocks).toHaveLength(1);
  return blocks[0];
}

describe("parseMarkdown blocks", () => {
  it("reads an ATX heading and its level", () => {
    expect(only("### Monday")).toEqual({
      kind: "heading",
      level: 3,
      children: [text("Monday")],
    });
  });

  it("leaves a hash with no space as a paragraph", () => {
    expect(only("#tag").kind).toBe("paragraph");
  });

  it("joins a wrapped paragraph with a soft break", () => {
    const block = only("one\ntwo");
    expect(block.kind).toBe("paragraph");
    expect(flatten((block as { children: MdInline[] }).children)).toBe("one two");
  });

  it("separates paragraphs on a blank line", () => {
    expect(parseMarkdown("one\n\ntwo")).toHaveLength(2);
  });

  it("reads an unordered list", () => {
    const block = only("- milk\n- bread");
    expect(block).toMatchObject({ kind: "list", ordered: false, start: 1 });
    expect((block as { items: { children: MdInline[] }[] }).items).toHaveLength(2);
  });

  it("honours the first number of an ordered list", () => {
    expect(only("3. third\n4. fourth")).toMatchObject({ kind: "list", ordered: true, start: 3 });
  });

  it("keeps a list together across a single blank line", () => {
    const block = only("- a\n\n- b");
    expect((block as { items: unknown[] }).items).toHaveLength(2);
  });

  it("reads both task item states", () => {
    const block = only("- [ ] todo\n- [x] done");
    expect((block as { items: { task: boolean; checked: boolean }[] }).items).toEqual([
      { children: [text("todo")], task: true, checked: false, line: 0, blocks: [] },
      { children: [text("done")], task: true, checked: true, line: 1, blocks: [] },
    ]);
  });

  it("does not mistake a thematic break for a one-item list", () => {
    expect(only("- - -")).toEqual({ kind: "rule" });
    expect(only("***")).toEqual({ kind: "rule" });
    expect(only("___")).toEqual({ kind: "rule" });
  });

  it("reads a fenced block with its info string, verbatim", () => {
    expect(only("```ts\nconst a = **1**;\n```")).toEqual({
      kind: "code",
      language: "ts",
      text: "const a = **1**;",
    });
  });

  it("runs an unterminated fence to the end rather than dropping it", () => {
    expect(only("```\nstill here")).toEqual({ kind: "code", language: null, text: "still here" });
  });

  it("nests a blockquote", () => {
    const block = only("> quoted");
    expect(block.kind).toBe("quote");
    expect((block as { blocks: MdBlock[] }).blocks[0].kind).toBe("paragraph");
  });

  it("keeps quoting literal past the depth cap", () => {
    // Four levels is the cap, so the fifth marker must survive as text.
    const flat = JSON.stringify(parseMarkdown("> > > > > deep"));
    expect(flat).toContain(">");
  });

  it("parses CRLF input the same as LF", () => {
    expect(parseMarkdown("# a\r\n\r\n- b\r\n")).toEqual(parseMarkdown("# a\n\n- b\n"));
  });

  it("starts a heading after a quoted line instead of swallowing it", () => {
    const blocks = parseMarkdown("> quoted\n# heading");
    expect(blocks.map((block) => block.kind)).toEqual(["quote", "heading"]);
  });
});

describe("parseMarkdown inline", () => {
  function inline(source: string): MdInline[] {
    const block = only(source);
    return (block as { children: MdInline[] }).children;
  }

  it("reads bold, italic and strikethrough", () => {
    expect(inline("**b**")).toEqual([{ kind: "strong", children: [text("b")] }]);
    expect(inline("__b__")).toEqual([{ kind: "strong", children: [text("b")] }]);
    expect(inline("*i*")).toEqual([{ kind: "em", children: [text("i")] }]);
    expect(inline("_i_")).toEqual([{ kind: "em", children: [text("i")] }]);
    expect(inline("~~s~~")).toEqual([{ kind: "strike", children: [text("s")] }]);
  });

  it("reads bold inside a heading", () => {
    const block = only("## a **b**");
    expect((block as { children: MdInline[] }).children).toEqual([
      text("a "),
      { kind: "strong", children: [text("b")] },
    ]);
  });

  it("leaves an unmatched delimiter as text", () => {
    expect(inline("a ** b")).toEqual([text("a ** b")]);
  });

  it("does not emphasise inside inline code", () => {
    expect(inline("`a*b*c`")).toEqual([{ kind: "code", text: "a*b*c" }]);
  });

  it("does not let a delimiter inside code close emphasis opened outside it", () => {
    expect(inline("*a `b*c` d*")).toEqual([
      { kind: "em", children: [text("a "), { kind: "code", text: "b*c" }, text(" d")] },
    ]);
  });

  it("reads a doubled backtick span containing a backtick", () => {
    expect(inline("``a ` b``")).toEqual([{ kind: "code", text: "a ` b" }]);
  });

  it("honours a backslash escape", () => {
    expect(inline("\\*not italic\\*")).toEqual([text("*not italic*")]);
  });

  it("autolinks a bare url but not one glued to a word", () => {
    expect(inline("see https://example.com now")).toEqual([
      text("see "),
      { kind: "link", href: "https://example.com/", children: [text("https://example.com")] },
      text(" now"),
    ]);
    expect(inline("xhttps://example.com")).toEqual([text("xhttps://example.com")]);
  });

  it("drops trailing punctuation from an autolink", () => {
    const nodes = inline("see https://example.com/a.");
    expect(nodes[1]).toMatchObject({ kind: "link" });
    expect(flatten([nodes[1]])).toBe("https://example.com/a");
  });

  it("degrades an image to its link form", () => {
    expect(inline("![alt](https://example.com/a.png)")).toEqual([
      {
        kind: "link",
        href: "https://example.com/a.png",
        children: [text("alt")],
      },
    ]);
  });
});

describe("link safety", () => {
  function inline(source: string): MdInline[] {
    const block = only(source);
    return (block as { children: MdInline[] }).children;
  }

  it("an_html_payload_in_a_note_body_is_text_not_markup", () => {
    const source = '<img src=x onerror="alert(1)">';
    const nodes = inline(source);
    expect(nodes).toEqual([text(source)]);
    expect(JSON.stringify(nodes)).not.toContain('"link"');
  });

  it("a_javascript_url_is_not_a_link", () => {
    const nodes = inline("[x](javascript:alert(1))");
    expect(nodes.every((node) => node.kind === "text")).toBe(true);
    expect(flatten(nodes)).toContain("javascript:");
  });

  it.each([
    "[x](data:text/html,<script>alert(1)</script>)",
    "[x](vbscript:msgbox)",
    "[x](blob:https://example.com/abc)",
    "[x](file:///etc/passwd)",
    "[x](   javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
  ])("rejects %s", (source) => {
    expect(JSON.stringify(inline(source))).not.toContain('"link"');
  });

  it("allows http, https, mailto and a relative target", () => {
    for (const [source, href] of [
      ["[a](http://example.com)", "http://example.com/"],
      ["[a](https://example.com)", "https://example.com/"],
      ["[a](mailto:someone@example.com)", "mailto:someone@example.com"],
      ["[a](./notes)", "https://sealbook.invalid/notes"],
    ] as const) {
      expect(inline(source)).toEqual([{ kind: "link", href, children: [text("a")] }]);
    }
  });

  it("does not nest a link inside a link label", () => {
    const nodes = inline("[see https://example.com](https://other.example)");
    expect(nodes).toHaveLength(1);
    expect(JSON.stringify((nodes[0] as { children: MdInline[] }).children)).not.toContain('"link"');
  });

  it("rejects a target with whitespace or angle brackets", () => {
    expect(safeHref("https://example.com/a b")).toBeNull();
    expect(safeHref("<https://example.com>")).toBeNull();
    expect(safeHref("")).toBeNull();
  });

  it("stays linear on a megabyte of unmatched delimiters", () => {
    // The guard is the failure memo in the inline scanner. Without it this is
    // quadratic, and a note can be 4 MiB.
    for (const char of ["*", "`", "[", "~"]) {
      const started = Date.now();
      parseMarkdown(char.repeat(1_000_000));
      expect(Date.now() - started).toBeLessThan(2_000);
    }
  });

  it("a_pathological_body_does_not_hang", () => {
    // Unmatched delimiters are the classic backtracking blowup, and at this size
    // ceiling it would be a real hang of the reader's own tab.
    expect(() => parseMarkdown("*".repeat(50_000))).not.toThrow();
    expect(() => parseMarkdown("`".repeat(50_000))).not.toThrow();
    expect(() => parseMarkdown("[".repeat(50_000))).not.toThrow();
    expect(() => parseMarkdown("> ".repeat(50_000))).not.toThrow();
  });
});

describe("stripMarkdown", () => {
  it("drops markers and collapses whitespace", () => {
    expect(stripMarkdown("# Title\n\n- **one**\n- `two`\n")).toBe("Title one two");
  });

  it("keeps a link's label", () => {
    expect(stripMarkdown("see [the docs](https://example.com)")).toBe("see the docs");
  });
});

describe("tables", () => {
  const table = (source: string) => {
    const block = only(source);
    if (block.kind !== "table") throw new Error(`expected a table, got ${block.kind}`);
    return block;
  };
  const cells = (row: MdTableCell[]) => row.map((cell) => flatten(cell.children));

  it("reads a header, a delimiter and its rows", () => {
    const block = table("| Day | Plan |\n| --- | --- |\n| Sat | Land 12:15 |\n| Sun | Sintra |");
    expect(cells(block.header)).toEqual(["Day", "Plan"]);
    expect(block.rows.map(cells)).toEqual([
      ["Sat", "Land 12:15"],
      ["Sun", "Sintra"],
    ]);
  });

  it("accepts rows without the outer pipes", () => {
    const block = table("Day | Plan\n--- | ---\nSat | Land");
    expect(cells(block.header)).toEqual(["Day", "Plan"]);
    expect(block.rows.map(cells)).toEqual([["Sat", "Land"]]);
  });

  it("reads alignment from the delimiter row", () => {
    const block = table("| a | b | c | d |\n| --- | :-- | :-: | --: |\n| 1 | 2 | 3 | 4 |");
    expect(block.align).toEqual([null, "left", "center", "right"]);
  });

  it("parses inline markup inside cells", () => {
    const block = table("| Plan |\n| --- |\n| hold expires **8 August** |");
    expect(block.rows[0][0].children).toContainEqual({
      kind: "strong",
      children: [text("8 August")],
    });
  });

  it("keeps an escaped pipe inside a cell", () => {
    const block = table("| a | b |\n| --- | --- |\n| one \\| two | three |");
    expect(block.rows.map(cells)).toEqual([["one | two", "three"]]);
  });

  it("reads the layout sidecar that follows a table", () => {
    const block = table("| a | b |\n| --- | --- |\n| 1 | 2 |\n<!-- sealbook:table h=1:48 bg=0.0:amber rs=1.0:2 -->");
    expect(block.layout).toEqual({ heights: { 1: 48 }, fills: { "0.0": "amber" }, rowspans: { "1.0": 2 } });
  });

  it("leaves the layout empty when no sidecar follows", () => {
    const block = table("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(block.layout).toEqual({ heights: {}, fills: {}, rowspans: {} });
  });

  it("ignores a sidecar key it cannot read rather than failing the line", () => {
    const block = table("| a |\n| --- |\n| 1 |\n<!-- sealbook:table bg=0.0:neon future=yes h=0:24 -->");
    expect(block.layout).toEqual({ heights: { 0: 24 }, fills: {}, rowspans: {} });
  });

  it("does not consume a sidecar that is not the next line", () => {
    const blocks = parseMarkdown("| a |\n| --- |\n| 1 |\n\n<!-- sealbook:table h=0:24 -->");
    expect(blocks).toHaveLength(2);
    expect(blocks[1].kind).toBe("paragraph");
  });

  it("pads a short row and drops cells past the header", () => {
    const block = table("| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |");
    expect(block.rows.map(cells)).toEqual([
      ["1", "", ""],
      ["1", "2", "3"],
    ]);
  });

  it("ends at a blank line", () => {
    const blocks = parseMarkdown("| a |\n| --- |\n| 1 |\n\nAfter the table.");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe("table");
    expect(blocks[1].kind).toBe("paragraph");
  });

  it("ends at the next block", () => {
    const blocks = parseMarkdown("| a |\n| --- |\n| 1 |\n## Next");
    expect(blocks.map((block) => block.kind)).toEqual(["table", "heading"]);
  });

  it("needs a delimiter row that matches the header's columns", () => {
    expect(only("| a | b |\n| --- |\n| 1 | 2 |").kind).toBe("paragraph");
    expect(only("| a | b |\n| --- | --- | --- |").kind).toBe("paragraph");
  });

  it("is not a table without a delimiter row", () => {
    expect(only("| a | b |\n| 1 | 2 |").kind).toBe("paragraph");
  });

  it("does not interrupt a paragraph", () => {
    expect(only("Some prose\n| a | b |\n| --- | --- |\n| 1 | 2 |").kind).toBe("paragraph");
  });

  it("leaves a list item that contains a pipe as a list", () => {
    expect(only("- a | b\n- | -").kind).toBe("list");
  });

  it("works inside a quote", () => {
    const block = only("> | a |\n> | --- |\n> | 1 |");
    if (block.kind !== "quote") throw new Error("expected a quote");
    expect(block.blocks[0].kind).toBe("table");
  });

  it("does not read a thematic break as a one-column table", () => {
    expect(only("---").kind).toBe("rule");
  });
});

describe("stripMarkdown on tables", () => {
  it("drops the delimiter row and the cell separators", () => {
    expect(stripMarkdown("| Day | Plan |\n| --- | --- |\n| Sat | Land |")).toBe(
      "Day Plan Sat Land",
    );
  });
});

describe("triple emphasis", () => {
  it("reads ***x*** as strong around emphasis", () => {
    const block = only("***both***");
    expect(block).toEqual({
      kind: "paragraph",
      children: [{ kind: "strong", children: [{ kind: "em", children: [text("both")] }] }],
    });
  });

  it("reads the underscore spelling the same way", () => {
    expect(flatten((only("___both___") as { children: MdInline[] }).children)).toBe("both");
  });

  it("leaves an unclosed run literal", () => {
    expect(flatten((only("***loose") as { children: MdInline[] }).children)).toBe("***loose");
  });

  it("still reads a plain pair as strong", () => {
    const block = only("**bold**");
    expect(block).toEqual({ kind: "paragraph", children: [{ kind: "strong", children: [text("bold")] }] });
  });
});

describe("nested lists", () => {
  function items(source: string): MdListItem[] {
    const block = only(source);
    expect(block.kind).toBe("list");
    return (block as Extract<MdBlock, { kind: "list" }>).items;
  }

  it("puts an indented run under the item above it", () => {
    const top = items("- one\n  - inner\n- two");
    expect(top).toHaveLength(2);
    expect(flatten(top[0].children)).toBe("one");
    expect(top[0].blocks).toHaveLength(1);
    const nested = top[0].blocks[0] as Extract<MdBlock, { kind: "list" }>;
    expect(nested.kind).toBe("list");
    expect(nested.items.map((item) => flatten(item.children))).toEqual(["inner"]);
    expect(top[1].blocks).toEqual([]);
  });

  it("nests to a third level", () => {
    const top = items("- a\n  - b\n    - c");
    const second = top[0].blocks[0] as Extract<MdBlock, { kind: "list" }>;
    const third = second.items[0].blocks[0] as Extract<MdBlock, { kind: "list" }>;
    expect(flatten(third.items[0].children)).toBe("c");
  });

  it("lets a nested list change kind", () => {
    const top = items("- bullet\n  1. first\n  2. second");
    const nested = top[0].blocks[0] as Extract<MdBlock, { kind: "list" }>;
    expect(nested.ordered).toBe(true);
    expect(nested.items).toHaveLength(2);
  });

  it("treats a tab as four columns", () => {
    const top = items("- one\n\t- inner");
    expect(top).toHaveLength(1);
    expect(top[0].blocks).toHaveLength(1);
  });

  it("does not nest an item with nothing above it", () => {
    const top = items("  - only\n  - second");
    expect(top).toHaveLength(2);
    expect(top[0].blocks).toEqual([]);
  });

  it("strips a nested run's shared indent rather than a fixed amount", () => {
    const top = items("- one\n      - deep\n      - also deep");
    const nested = top[0].blocks[0] as Extract<MdBlock, { kind: "list" }>;
    expect(nested.items.map((item) => flatten(item.children))).toEqual(["deep", "also deep"]);
  });

  it("stops nesting at the depth limit instead of recursing on input", () => {
    const source = Array.from({ length: 40 }, (_, level) => `${" ".repeat(level * 2)}- level`).join(
      "\n",
    );
    let depth = 0;
    let list = only(source) as Extract<MdBlock, { kind: "list" }>;
    while (list.items[list.items.length - 1].blocks.length > 0) {
      depth += 1;
      list = list.items[list.items.length - 1].blocks[0] as Extract<MdBlock, { kind: "list" }>;
    }
    expect(depth).toBeLessThanOrEqual(6);
  });
});

describe("task item line mapping", () => {
  function items(source: string): MdListItem[] {
    const blocks = parseMarkdown(source);
    const list = blocks.find((block) => block.kind === "list");
    return (list as Extract<MdBlock, { kind: "list" }>).items;
  }

  it("reports the source line of each item", () => {
    const list = items("# Title\n\n- [ ] one\n- [x] two");
    expect(list.map((item) => item.line)).toEqual([2, 3]);
  });

  it("reports the source line of a nested item", () => {
    const top = items("- [ ] parent\n  - [ ] child");
    const nested = top[0].blocks[0] as Extract<MdBlock, { kind: "list" }>;
    expect(nested.items[0].line).toBe(1);
  });

  it("reports no line inside a quote, where the markers were stripped", () => {
    const blocks = parseMarkdown("> - [ ] quoted");
    const quote = blocks[0] as Extract<MdBlock, { kind: "quote" }>;
    const list = quote.blocks[0] as Extract<MdBlock, { kind: "list" }>;
    expect(list.items[0].line).toBeNull();
  });

  it("keeps a table's line range addressing the source", () => {
    const blocks = parseMarkdown("text\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
    const table = blocks.find((block) => block.kind === "table");
    expect((table as Extract<MdBlock, { kind: "table" }>).line).toEqual({ from: 2, to: 5 });
  });
});

describe("inlineText", () => {
  it("flattens a tree to its readable text", () => {
    const blocks = parseMarkdown("- **bold** and `code` and [link](https://example.com)");
    const list = blocks[0] as Extract<MdBlock, { kind: "list" }>;
    expect(inlineText(list.items[0].children)).toBe("bold and code and link");
  });

  it("returns an empty string for an empty tree", () => {
    expect(inlineText([])).toBe("");
  });
});

describe("repairPipeTables", () => {
  const kinds = (source: string): string =>
    parseMarkdown(source)
      .map((block) => block.kind)
      .join(",");

  it("leaves a table the parser already accepts alone", () => {
    const valid = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(repairPipeTables(valid)).toBe(valid);
    expect(repairPipeTables("| a | b |\n| :-- | --: |\n| 1 | 2 |")).toBe(
      "| a | b |\n| :-- | --: |\n| 1 | 2 |",
    );
  });

  it("leaves prose alone, pipes and all", () => {
    expect(repairPipeTables("Hello world.\n\nSecond.")).toBe("Hello world.\n\nSecond.");
    // No delimiter row, so these pipes are not a table waiting to be fixed.
    expect(repairPipeTables("a | b | c\nd | e | f")).toBe("a | b | c\nd | e | f");
    expect(repairPipeTables("| a | b |\n| no | no |\n| 1 | 2 |")).toBe(
      "| a | b |\n| no | no |\n| 1 | 2 |",
    );
  });

  it("fills the blank cells an exporter leaves in a delimiter row", () => {
    const repaired = repairPipeTables("| a | b | c |\n| --- |  |  |\n| 1 | 2 | 3 |");
    expect(repaired).toBe("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |");
    expect(kinds(repaired)).toBe("table");
  });

  it("widens to the longest row rather than dropping cells past the header", () => {
    const repaired = repairPipeTables("| a | b |\n| --- |  |\n| 1 | 2 | 3 | 4 |");
    expect(repaired).toBe("| a | b |  |  |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |");
    expect(kinds(repaired)).toBe("table");
  });

  it("keeps the alignment the loose delimiter asked for", () => {
    expect(repairPipeTables("| a | b |\n| :-: |  |\n| 1 | 2 |")).toBe(
      "| a | b |\n| :-: | --- |\n| 1 | 2 |",
    );
  });

  it("keeps an escaped pipe inside a cell", () => {
    expect(repairPipeTables("| a | b |\n| --- |  |\n| x \\| y | 2 |")).toBe(
      "| a | b |\n| --- | --- |\n| x \\| y | 2 |",
    );
  });

  it("stops at the end of the table", () => {
    expect(repairPipeTables("| a |  |\n| --- |  |\n| 1 |  |\n\nAfter.")).toBe(
      "| a |  |\n| --- | --- |\n| 1 |  |\n\nAfter.",
    );
  });
});
