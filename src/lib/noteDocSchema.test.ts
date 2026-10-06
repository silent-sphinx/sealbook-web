import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/react";
import { Node } from "@tiptap/pm/model";

import { docToMarkdown, markdownToDoc } from "./noteDoc";
import { noteExtensions } from "./noteEditorSchema";

/**
 * The contract between the converter and the editor. `markdownToDoc` builds a
 * document by hand, so nothing but the real schema can say whether the editor
 * would accept it; a document it rejects is a note that will not open.
 */
const schema = getSchema(noteExtensions("placeholder"));

/** Loads through ProseMirror and serialises what the editor would hold. */
function throughEditor(markdown: string): string {
  const node = Node.fromJSON(schema, markdownToDoc(markdown));
  node.check();
  return docToMarkdown(node.toJSON());
}

const SAMPLES: [name: string, markdown: string][] = [
  ["an empty note", ""],
  ["a heading and prose", "# Title\n\nSome **bold** prose."],
  ["every heading level", "# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f"],
  ["a bullet list", "- one\n- two"],
  ["an ordered list", "1. one\n2. two"],
  ["a task list", "- [ ] todo\n- [x] done"],
  ["a nested list", "- outer\n  - inner"],
  ["a nested list under a task", "- [ ] parent\n      - child"],
  ["a quote", "> quoted"],
  ["a list inside a quote", "> - one\n> - two"],
  ["a code block", "```js\nconst x = 1;\n```"],
  ["an empty code block", "```\n```"],
  ["a code block with no language", "```\nplain text\n```"],
  ["a table", "| a | b |\n| --- | --- |\n| 1 | 2 |"],
  ["an aligned table", "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |"],
  ["a rule", "above\n\n---\n\nbelow"],
  ["inline code", "call `fn()` now"],
  ["a link", "see [docs](https://example.com/a)"],
  ["mixed marks", "***both*** and ~~struck~~ and `code`"],
];

describe("documents the editor can load", () => {
  for (const [name, markdown] of SAMPLES) {
    it(`accepts ${name}`, () => {
      expect(() => Node.fromJSON(schema, markdownToDoc(markdown)).check()).not.toThrow();
    });

    it(`round-trips ${name} through the editor`, () => {
      expect(throughEditor(markdown)).toBe(markdown);
    });
  }

  it("keeps the schema free of nodes markdown cannot spell", () => {
    // Underline and hard break have no markdown form, so the editor must not be
    // able to produce them; see `noteEditorSchema`.
    expect(schema.marks.underline).toBeUndefined();
    expect(schema.nodes.hardBreak).toBeUndefined();
  });

  it("settles after a second trip", () => {
    for (const [, markdown] of SAMPLES) {
      expect(throughEditor(throughEditor(markdown))).toBe(throughEditor(markdown));
    }
  });
});
