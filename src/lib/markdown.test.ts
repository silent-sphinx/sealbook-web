import { describe, expect, it } from "vitest";

import { parseMarkdown, safeHref, stripMarkdown } from "./markdown";
import type { MdBlock, MdInline } from "./markdown";

const text = (value: string): MdInline => ({ kind: "text", text: value });

/** Flattens a tree to the text a reader would see, for assertions about content. */
function flatten(nodes: MdInline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
        case "code":
          return node.text;
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
      { children: [text("todo")], task: true, checked: false },
      { children: [text("done")], task: true, checked: true },
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
