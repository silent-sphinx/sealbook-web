import { describe, expect, it } from "vitest";
import { applyMarkdown, headingLevelAt, type MarkdownAction, type Selection } from "./markdownEdit";

// Markers markdown itself never uses, so a spec can contain `[ ]` or `|` without
// the harness mistaking it for a selection.
const CARET = "‸";
const OPEN = "«";
const CLOSE = "»";

/** `‸` marks a collapsed caret, `«...»` a selection. */
function parse(spec: string): Selection {
  const caret = spec.indexOf(CARET);
  if (caret !== -1) {
    return { text: spec.slice(0, caret) + spec.slice(caret + 1), start: caret, end: caret };
  }
  const open = spec.indexOf(OPEN);
  const close = spec.indexOf(CLOSE);
  const text = spec.slice(0, open) + spec.slice(open + 1, close) + spec.slice(close + 1);
  return { text, start: open, end: close - 1 };
}

function render(selection: Selection): string {
  const { text, start, end } = selection;
  if (start === end) return `${text.slice(0, start)}${CARET}${text.slice(start)}`;
  return `${text.slice(0, start)}${OPEN}${text.slice(start, end)}${CLOSE}${text.slice(end)}`;
}

function run(action: MarkdownAction, spec: string): string {
  return render(applyMarkdown(action, parse(spec)));
}

describe("inline wrapping", () => {
  it("wraps a selection and keeps it selected", () => {
    expect(run("bold", "a «word» b")).toBe("a **«word»** b");
    expect(run("italic", "a «word» b")).toBe("a *«word»* b");
    expect(run("strike", "a «word» b")).toBe("a ~~«word»~~ b");
    expect(run("code", "a «word» b")).toBe("a `«word»` b");
  });

  it("unwraps when the markers are inside the selection", () => {
    expect(run("bold", "a «**word**» b")).toBe("a «word» b");
  });

  it("unwraps when the markers sit just outside it", () => {
    expect(run("bold", "a **«word»** b")).toBe("a «word» b");
  });

  it("leaves a caret between fresh markers", () => {
    expect(run("bold", "a ‸b")).toBe("a **‸**b");
  });

  it("does not read past the start of the body", () => {
    expect(run("bold", "«a»")).toBe("**«a»**");
  });
});

describe("list prefixes", () => {
  it("prefixes every touched line", () => {
    expect(run("bullet", "«one\ntwo»")).toBe("«- one\n- two»");
  });

  it("numbers an ordered list from one", () => {
    expect(run("ordered", "«one\ntwo\nthree»")).toBe("«1. one\n2. two\n3. three»");
  });

  it("removes the prefix when every line already has it", () => {
    expect(run("bullet", "«- one\n- two»")).toBe("«one\ntwo»");
  });

  it("replaces one list kind with another", () => {
    expect(run("ordered", "«- one\n- two»")).toBe("«1. one\n2. two»");
    expect(run("task", "«1. one»")).toBe("«- [ ] one»");
    expect(run("bullet", "«- [ ] one»")).toBe("«- one»");
  });

  it("treats a task item as distinct from a plain bullet", () => {
    expect(run("task", "«- one»")).toBe("«- [ ] one»");
  });

  it("prefixes an empty line", () => {
    expect(run("bullet", "‸")).toBe("- ‸");
  });

  it("keeps indentation ahead of the marker", () => {
    expect(run("bullet", "«  one»")).toBe("«  - one»");
  });

  it("toggles a quote independently of lists", () => {
    expect(run("quote", "«- one»")).toBe("«> - one»");
    expect(run("quote", "«> - one»")).toBe("«- one»");
  });

  it("acts on the caret's own line only", () => {
    expect(run("bullet", "one\ntw‸o\nthree")).toBe("one\n- tw‸o\nthree");
  });

  it("stops at a selection that ends on a line break", () => {
    // The trailing break falls outside the rewritten block, so the selection
    // comes back covering the one line that changed.
    expect(run("bullet", "«one\n»two")).toBe("«- one»\ntwo");
  });
});

describe("headings", () => {
  it("sets a level and replaces an existing one", () => {
    expect(run("h1", "‸title")).toBe("# ‸title");
    expect(run("h2", "# ‸title")).toBe("## ‸title");
  });

  it("clears a heading for paragraph", () => {
    expect(run("paragraph", "### ‸title")).toBe("‸title");
  });

  it("reports the level under the caret", () => {
    expect(headingLevelAt("# one\ntwo", 2)).toBe(1);
    expect(headingLevelAt("# one\ntwo", 7)).toBe(0);
    expect(headingLevelAt("### three", 0)).toBe(3);
  });
});

describe("inserts", () => {
  it("selects the target of a new link", () => {
    expect(run("link", "see «Lisbon» now")).toBe("see [Lisbon](«url») now");
  });

  it("supplies a label when nothing is selected", () => {
    expect(run("link", "see ‸")).toBe("see [text](«url»)");
  });

  it("fences the touched lines", () => {
    expect(run("codeblock", "«cargo test»")).toBe("```\n«cargo test»\n```");
  });

  it("puts a rule after the current line", () => {
    expect(run("rule", "on‸e\ntwo")).toBe("one\n---‸\ntwo");
  });

  it("drops a table onto an empty line, first heading selected", () => {
    expect(run("table", "‸")).toBe("| «Column» | Column |\n| --- | --- |\n|  |  |");
  });

  it("starts a table below a line of prose, never on it", () => {
    expect(run("table", "Rough shape of the week‸")).toBe(
      "Rough shape of the week\n\n| «Column» | Column |\n| --- | --- |\n|  |  |",
    );
  });
});
