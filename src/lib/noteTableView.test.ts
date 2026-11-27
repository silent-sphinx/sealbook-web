import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";

import { docToMarkdown, markdownToDoc, type DocNode } from "./noteDoc";
import { noteExtensions } from "./noteEditorSchema";
import { columnShares, fitColumns, moveLine, setColumnShares, sharesOf } from "./noteTableView";

const rounded = (widths: number[]) => widths.map(Math.round);

describe("sizing columns", () => {
  it("gives each column its share", () => {
    expect(fitColumns([600, 200, 200], 700)).toEqual([420, 140, 140]);
  });

  it("makes them equal when none has a share", () => {
    expect(fitColumns([0, 0, 0, 0], 600)).toEqual([150, 150, 150, 150]);
  });

  it("treats a column without a share as an average one", () => {
    expect(fitColumns([300, 100, 0], 600)).toEqual([300, 100, 200]);
  });

  it("holds narrow columns at the minimum and takes the room from the wide ones", () => {
    expect(rounded(fitColumns([900, 50, 50], 330))).toEqual([202, 64, 64]);
    expect(rounded(fitColumns([500, 440, 30, 30], 400))).toEqual([145, 127, 64, 64]);
  });

  it("lets many columns run wider than the room", () => {
    expect(fitColumns([500, ...Array<number>(9).fill(10)], 330)).toEqual(Array(10).fill(48));
  });

  it("moves a line between its two neighbours only, within the minimum", () => {
    expect(moveLine([200, 200, 200], 1, 50)).toEqual([250, 150, 200]);
    expect(moveLine([200, 200, 200], 2, -500)).toEqual([200, 64, 336]);
    expect(moveLine([200, 200, 200], 1, 500)).toEqual([336, 64, 200]);
  });

  it("spells widths as thousandths", () => {
    expect(sharesOf([420, 140, 140])).toEqual([600, 200, 200]);
  });
});

describe("column shares in the editor", () => {
  const TABLE = "| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |";

  const open = (body: string) => new Editor({ extensions: noteExtensions(""), content: markdownToDoc(body) });
  const saved = (editor: Editor) => docToMarkdown(editor.getJSON() as DocNode);
  const resize = (editor: Editor, shares: number[] | null) =>
    setColumnShares(editor.view, editor.state.doc.child(0), 1, shares);
  /** Puts the caret in the cell holding `text`. */
  const into = (editor: Editor, text: string) => {
    let at = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === text) at = pos;
    });
    editor.commands.setTextSelection(at);
  };

  it("saves a resize and takes it away again", () => {
    const editor = open(TABLE);
    resize(editor, [600, 200, 200]);
    expect(saved(editor)).toBe(`${TABLE}\n<!-- sealbook:table w=0:600,1:200,2:200 -->`);
    resize(editor, null);
    expect(saved(editor)).toBe(TABLE);
    editor.destroy();
  });

  it("keeps each width with its column as columns come and go", () => {
    const editor = open(`${TABLE}\n<!-- sealbook:table w=0:600,1:300,2:100 -->`);
    into(editor, "1");
    editor.commands.addColumnAfter();
    expect(saved(editor)).toContain("w=0:600,2:300,3:100");
    into(editor, "2");
    editor.commands.deleteColumn();
    expect(saved(editor)).toContain("w=0:600,2:100");
    expect(columnShares(editor.state.doc.child(0))).toEqual([600, 0, 100]);
    editor.destroy();
  });

  it("scales pasted pixel widths into range", () => {
    const editor = open(TABLE);
    resize(editor, [2000, 1000, 1]);
    expect(saved(editor)).toContain("w=0:1000,1:500,2:1 -->");
    editor.destroy();
  });
});
