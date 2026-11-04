import { describe, expect, it } from "vitest";

import { attachmentIdsIn, docToMarkdown, markdownToDoc, type Doc } from "./noteDoc";

/** What a note looks like after one trip through the editor. */
function round(markdown: string): string {
  return docToMarkdown(markdownToDoc(markdown));
}

/** A round trip that must not change the text at all. */
function stable(markdown: string): void {
  expect(round(markdown)).toBe(markdown);
}

describe("markdownToDoc", () => {
  it("gives an empty note a paragraph to put the caret in", () => {
    expect(markdownToDoc("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("maps a heading to its level", () => {
    const doc = markdownToDoc("### Three");
    expect(doc.content[0]).toEqual({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Three" }],
    });
  });

  it("round-trips an attachment image through the editor unchanged", () => {
    stable("Here is a ![photo](attachment:abc-123) inline.");
    const doc = markdownToDoc("![photo](attachment:abc-123)");
    const paragraph = doc.content[0] as { content?: { type: string; attrs?: Record<string, unknown> }[] };
    expect(paragraph.content?.[0]).toEqual({
      type: "attachmentImage",
      attrs: { attachmentId: "abc-123", alt: "photo" },
    });
  });

  it("carries marks as a set on the text node", () => {
    const doc = markdownToDoc("**bold _both_**");
    const text = doc.content[0].content ?? [];
    expect(text[0]).toEqual({ type: "text", text: "bold ", marks: [{ type: "bold" }] });
    expect(text[1]).toEqual({
      type: "text",
      text: "both",
      marks: [{ type: "bold" }, { type: "italic" }],
    });
  });

  it("splits a mixed list into a task list and a bullet list", () => {
    const doc = markdownToDoc("- [ ] task\n- plain");
    expect(doc.content.map((node) => node.type)).toEqual(["taskList", "bulletList"]);
  });

  it("nests a sub-list inside its parent item", () => {
    const doc = markdownToDoc("- outer\n  - inner");
    const item = doc.content[0].content?.[0];
    expect(item?.content?.map((node) => node.type)).toEqual(["paragraph", "bulletList"]);
  });

  it("keeps a task item's checked state", () => {
    const doc = markdownToDoc("- [x] done");
    expect(doc.content[0].content?.[0].attrs).toEqual({ checked: true });
  });

  it("writes no content key for an empty code block", () => {
    const doc = markdownToDoc("```\n```");
    expect(doc.content[0]).toEqual({ type: "codeBlock", attrs: { language: null } });
  });

  it("carries a table's column alignment onto its cells", () => {
    const doc = markdownToDoc("| a | b |\n| :-- | --: |\n| 1 | 2 |");
    const header = doc.content[0].content?.[0].content ?? [];
    expect(header[0].attrs?.align).toBe("left");
    expect(header[1].attrs?.align).toBe("right");
  });

  it("builds no zero-length text node", () => {
    const doc = markdownToDoc("a ** ** b\n\n- \n- x");
    const texts: string[] = [];
    const walk = (node: { text?: string; content?: unknown[] }) => {
      if (typeof node.text === "string") texts.push(node.text);
      for (const child of (node.content ?? []) as { text?: string; content?: unknown[] }[]) {
        walk(child);
      }
    };
    walk(doc as unknown as { content?: unknown[] });
    expect(texts.every((text) => text.length > 0)).toBe(true);
  });
});

describe("attachmentIdsIn", () => {
  it("lists the photos a body shows, nested or not", () => {
    const body = "![a](attachment:one)\n\n- item ![b](attachment:two)";
    expect([...attachmentIdsIn(body)].sort()).toEqual(["one", "two"]);
  });

  it("ignores a spelling quoted in code", () => {
    const body = "```\n![a](attachment:one)\n```\n\nuse `![a](attachment:two)` here";
    expect(attachmentIdsIn(body).size).toBe(0);
  });
});

describe("round trip", () => {
  it("keeps headings", () => stable("# One\n\n## Two\n\n###### Six"));
  it("keeps paragraphs", () => stable("First line.\n\nSecond line."));
  it("keeps emphasis", () => stable("**bold** and *italic* and ~~struck~~"));
  it("keeps inline code", () => stable("call `fn(x)` now"));
  it("keeps a link", () => stable("see [the docs](https://example.com/a)"));
  it("keeps a bullet list", () => stable("- one\n- two\n- three"));
  it("keeps an ordered list", () => stable("1. one\n2. two"));
  it("keeps an ordered list that does not start at one", () => stable("5. five\n6. six"));
  it("keeps a task list", () => stable("- [ ] todo\n- [x] done"));
  it("keeps a nested list", () => stable("- outer\n  - inner\n  - also"));
  it("keeps a quote", () => stable("> quoted line"));
  it("keeps a rule", () => stable("before\n\n---\n\nafter"));
  it("keeps a code block", () => stable("```js\nconst x = 1;\n```"));
  it("keeps a code block with no language", () => stable("```\nplain\n```"));
  it("keeps a table", () => stable("| a | b |\n| --- | --- |\n| 1 | 2 |"));
  it("keeps a table's alignment", () => stable("| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |"));
  it("keeps a merged column", () => stable("| spans ||\n| --- | --- |\n| 1 | 2 |"));
  it("keeps a merged row", () => stable("| a | b |\n| --- | --- |\n| up | 2 |\n|  | 4 |\n<!-- sealbook:table rs=1.0:2 -->"));
  it("keeps a row height", () => stable("| a |\n| --- |\n| 1 |\n<!-- sealbook:table h=1:64 -->"));
  it("keeps a cell fill", () => stable("| a | b |\n| --- | --- |\n| 1 | 2 |\n<!-- sealbook:table bg=0.0:amber,1.1:green -->"));
  it("keeps a merge, a fill and a height together", () =>
    stable(
      "| a | b | c |\n| --- | --- | --- |\n| wide || 3 |\n|  |  | 6 |\n<!-- sealbook:table h=0:40 bg=1.0:blue rs=1.0:2 -->",
    ));

  it("keeps a nested list inside a task item", () => {
    stable("- [ ] parent\n      - child");
  });

  it("keeps an underscore inside a word literal", () => {
    stable("a_b_c");
    stable("compose_portainer and immich_server");
    stable("snake_case_name");
  });

  it("normalises an underscore pair to the asterisk form it already meant", () => {
    expect(round("an _emphasis_ here")).toBe("an *emphasis* here");
    expect(round(round("an _emphasis_ here"))).toBe(round("an _emphasis_ here"));
    // A pair at a word boundary still opens, as it does in GFM.
    expect(round("__init__ and __main__")).toBe("**init** and **main**");
  });

  it("escapes markup characters that were never a pair", () => {
    const source = "_leading and [not a link";
    expect(round(source)).toBe("\\_leading and \\[not a link");
    expect(round(round(source))).toBe(round(source));
  });

  it("keeps a hard break", () => {
    stable("line one\\\nline two\\\nline three");
    // A literal backslash stays distinguishable from the break's own.
    stable("a \\\\ b");
    stable(`ends in a backslash: a${"\\".repeat(3)}\nb`);
  });

  it("escapes a block start on the line after a hard break", () => {
    // The editor can put any line after a break, and an unescaped one would be
    // read back as a list, heading or quote instead of part of the paragraph.
    const para = (second: string): Doc => ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "hardBreak" },
            { type: "text", text: second },
          ],
        },
      ],
    });
    for (const second of ["- b", "# h", "> q", "1. i"]) {
      const markdown = docToMarkdown(para(second));
      expect(docToMarkdown(markdownToDoc(markdown))).toBe(markdown);
      expect(markdownToDoc(markdown)).toEqual(para(second));
    }
  });

  it("normalises the trailing-space break, which the writer cannot spell", () => {
    expect(round("line one  \nline two")).toBe("line one\\\nline two");
  });

  it("keeps a soft break a space", () => {
    expect(round("soft\nwrap")).toBe("soft wrap");
  });

  it("does not grow a backslash on an escaped pipe", () => {
    expect(round("a \\| b")).toBe("a | b");
    stable("a | b");
  });

  it("does not let prose open a block it did not mean to", () => {
    for (const text of ["# not a heading", "- not a list", "> not a quote", "1. not ordered"]) {
      const doc = markdownToDoc(text.replace(/^(.)/u, "\\$1"));
      expect(doc.content[0].type).toBe("paragraph");
    }
  });

  it("keeps a fence that contains a fence", () => {
    const source = "````\n```\ninner\n```\n````";
    expect(round(source)).toBe(source);
  });

  it("normalises a bare origin the way the parser validated it", () => {
    // `safeHref` resolves through `URL`, which is what rejects a hostile scheme;
    // the trailing slash is that validation showing through.
    expect(round("[a](https://example.com)")).toBe("[a](https://example.com/)");
    expect(round(round("[a](https://example.com)"))).toBe(round("[a](https://example.com)"));
  });

  it("drops a fill the palette does not name", () => {
    expect(round("| a |\n| --- |\n| 1 |\n<!-- sealbook:table bg=0.0:chartreuse -->")).toBe("| a |\n| --- |\n| 1 |");
  });

  it("drops a row height that is not a positive integer", () => {
    expect(round("| a |\n| --- |\n| 1 |\n<!-- sealbook:table h=1:-4 -->")).toBe("| a |\n| --- |\n| 1 |");
  });

  it("keeps a pipe inside a table cell", () => {
    const doc = markdownToDoc("| a |\n| --- |\n| x \\| y |");
    expect(docToMarkdown(doc)).toBe("| a |\n| --- |\n| x \\| y |");
  });

  it("keeps a backtick inside inline code", () => {
    const source = "a ``b ` c`` d";
    expect(round(round(source))).toBe(round(source));
    expect(markdownToDoc(round(source)).content[0].content?.[1].text).toBe("b ` c");
  });

  it("keeps emphasis markers off the run's own spaces", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a" },
            { type: "text", text: " padded ", marks: [{ type: "bold" }] },
            { type: "text", text: "b" },
          ],
        },
      ],
    };
    // `** padded **` is not emphasis, so the spaces stay outside the markers.
    expect(docToMarkdown(doc)).toBe("a **padded** b");
  });

  it("settles after one pass on a mixed document", () => {
    const source = [
      "# Title",
      "",
      "Some **bold** prose with a [link](https://example.com/).",
      "",
      "- [ ] a task",
      "- [x] a done task",
      "",
      "1. first",
      "2. second",
      "",
      "> a quote",
      "",
      "```rust",
      "fn main() {}",
      "```",
      "",
      "| col | col |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    expect(round(source)).toBe(source);
  });
});
