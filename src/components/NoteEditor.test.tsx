// @vitest-environment jsdom
/**
 * The note editor, mounted on its own.
 *
 * The document belongs to ProseMirror once the editor is built, so what is
 * under test is the boundary either side of it: markdown in, markdown back out,
 * which note replaces the document and which does not, and the slash menu,
 * whose keyboard the suggestion plugin owns rather than React.
 *
 * jsdom has no editing of its own for a `contenteditable`, so a change is made
 * by pasting into it, which is a real ProseMirror input path rather than a
 * command run behind the component's back.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../test/dom";
import { NoteEditor, slashMenuPlacement } from "./NoteEditor";

/** A fake `DataTransfer`: jsdom has none for a real paste event to carry. */
class FakeClipboard {
  private store = new Map<string, string>();
  constructor(text: string) {
    this.store.set("text/plain", text);
  }
  get types(): string[] {
    return [...this.store.keys()];
  }
  getData(type: string): string {
    return this.store.get(type) ?? "";
  }
  files: File[] = [];
  items: DataTransferItem[] = [];
}

function pasteEvent(text: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: new FakeClipboard(text) });
  return event;
}

function body(): Promise<HTMLElement> {
  return screen.findByLabelText("Note body");
}

/**
 * Puts the caret at the end of the document, by clicking the margin the editor
 * treats as "focus the end". A fresh editor has its selection at the document
 * start, so a paste without this lands in front of the text rather than after
 * it.
 */
function clickMargin(): void {
  const margin = document.querySelector(".note-editor");
  if (!margin) throw new Error("no editor margin");
  fireEvent.click(margin);
}

type Props = Parameters<typeof NoteEditor>[0];

function mount(overrides: Partial<Props> = {}) {
  const onChange = vi.fn<(markdown: string) => void>();
  const props: Props = {
    noteId: "note-1",
    value: "",
    onChange,
    ...overrides,
  };
  const view = render(<NoteEditor {...props} />);
  /** The markdown as of the last change, which is what the draft would hold. */
  const written = (): string =>
    onChange.mock.calls.length === 0
      ? ""
      : onChange.mock.calls[onChange.mock.calls.length - 1]![0];
  return {
    onChange,
    written,
    rerender: (next: Partial<Props>) => view.rerender(<NoteEditor {...props} {...next} />),
  };
}

describe("NoteEditor, the document", () => {
  it("renders the markdown it was given as a document", async () => {
    mount({ value: "# Shopping\n\nBread and **butter**" });

    const doc = await body();
    expect(doc.querySelector("h1")?.textContent).toBe("Shopping");
    expect(doc.querySelector("strong")?.textContent).toBe("butter");
  });

  it("reports an edit back as markdown", async () => {
    const { written } = mount({ value: "Bread" });

    const doc = await body();
    clickMargin();
    fireEvent(doc, pasteEvent(" and butter"));

    await waitFor(() => expect(written()).toBe("Bread and butter"));
  });

  it("drops the caret at the end when the margin is clicked", async () => {
    const { written } = mount({ value: "Bread" });

    const doc = await body();
    clickMargin();
    fireEvent(doc, pasteEvent("!"));

    await waitFor(() => expect(written()).toBe("Bread!"));
  });

  it("round-trips a list through the editor", async () => {
    const { written } = mount({ value: "- one\n- two" });

    const doc = await body();
    expect(doc.querySelectorAll("li")).toHaveLength(2);

    clickMargin();
    fireEvent(doc, pasteEvent("x"));
    await waitFor(() => expect(written()).toBe("- one\n- twox"));
  });

  it("leaves the document alone when only the markdown prop changes", async () => {
    // `value` is read when the note is loaded, not on every change: an autosave
    // sending the markdown back in must not undo the keystroke that made it.
    const { rerender } = mount({ value: "Bread" });
    await body();

    rerender({ value: "Something else entirely" });

    expect((await body()).textContent).toBe("Bread");
  });

  it("replaces the document when a different note is opened", async () => {
    const { rerender } = mount({ value: "Bread" });
    await body();

    rerender({ noteId: "note-2", value: "Milk" });

    await waitFor(async () => expect((await body()).textContent).toBe("Milk"));
  });
});

describe("NoteEditor, opening a note", () => {
  it("reports no change for a note that was only mounted", async () => {
    const { onChange } = mount({ value: "Bread" });

    await body();

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("NoteEditor, the slash menu", () => {
  async function openMenu(overrides: Partial<Props> = {}) {
    const mounted = mount(overrides);
    const doc = await body();
    fireEvent(doc, pasteEvent("/"));
    const menu = await screen.findByRole("listbox", { name: "Insert block" });
    return { ...mounted, doc, menu };
  }

  it("lists the blocks that can be inserted", async () => {
    const { menu } = await openMenu();

    const labels = Array.from(menu.querySelectorAll(".note-slash-label")).map(
      (node) => node.textContent,
    );
    expect(labels).toContain("Heading 1");
    expect(labels).toContain("Table");
    expect(labels).toContain("Code block");
  });

  it("highlights the first entry, and moves with the arrow keys", async () => {
    const { doc } = await openMenu();

    const selected = () =>
      screen
        .getAllByRole("option")
        .findIndex((option) => option.getAttribute("aria-selected") === "true");
    expect(selected()).toBe(0);

    fireEvent.keyDown(doc, { key: "ArrowDown" });
    await waitFor(() => expect(selected()).toBe(1));

    fireEvent.keyDown(doc, { key: "ArrowUp" });
    await waitFor(() => expect(selected()).toBe(0));
  });

  it("wraps the highlight round the ends of the list", async () => {
    const { doc } = await openMenu();
    const count = screen.getAllByRole("option").length;

    fireEvent.keyDown(doc, { key: "ArrowUp" });

    await waitFor(() =>
      expect(
        screen.getAllByRole("option")[count - 1]!.getAttribute("aria-selected"),
      ).toBe("true"),
    );
  });

  it("inserts the highlighted block on Enter", async () => {
    const { doc, written } = await openMenu();

    fireEvent.keyDown(doc, { key: "ArrowDown" });
    await waitFor(() =>
      expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true"),
    );
    fireEvent.keyDown(doc, { key: "Enter" });

    // An empty heading, which is all a block insert leaves behind.
    await waitFor(() => expect(written()).toBe("#"));
  });

  it("inserts a block from a click, taking the query out with it", async () => {
    const { written } = await openMenu();

    fireEvent.mouseDown(screen.getByRole("option", { name: /Quote/ }));

    await waitFor(() => expect(written()).toBe(">"));
  });

  it("narrows the list as the query is typed", async () => {
    const { doc } = await openMenu();

    fireEvent(doc, pasteEvent("quo"));

    await waitFor(() => {
      const labels = screen.getAllByRole("option").map((option) =>
        option.querySelector(".note-slash-label")?.textContent,
      );
      expect(labels).toEqual(["Quote"]);
    });
  });

  it("closes on Escape", async () => {
    const { doc } = await openMenu();

    fireEvent.keyDown(doc, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "Insert block" })).toBeNull(),
    );
  });

  it("leaves the photo out with no uploader to call", async () => {
    const { menu } = await openMenu();

    expect(
      Array.from(menu.querySelectorAll(".note-slash-label")).map((node) => node.textContent),
    ).not.toContain("Photo");
  });

  it("offers a photo once an uploader is given", async () => {
    const { menu } = await openMenu({ onUploadImage: async () => null });

    expect(
      Array.from(menu.querySelectorAll(".note-slash-label")).map((node) => node.textContent),
    ).toContain("Photo");
  });
});

describe("NoteEditor, the title above it", () => {
  function withTitle(overrides: Partial<Props> = {}) {
    return mount({
      header: <input aria-label="Note title" defaultValue="Shopping" />,
      ...overrides,
    });
  }

  it("carries Enter from the title into the body", async () => {
    withTitle();
    const doc = await body();

    const title = screen.getByLabelText("Note title");
    const event = fireEvent.keyDown(title, { key: "Enter" });

    expect(event).toBe(false);
    await waitFor(() => expect(doc.contains(document.activeElement)).toBe(true));
  });

  it("carries the down arrow from the title into the body", async () => {
    withTitle();
    const doc = await body();

    fireEvent.keyDown(screen.getByLabelText("Note title"), { key: "ArrowDown" });

    await waitFor(() => expect(doc.contains(document.activeElement)).toBe(true));
  });

  it("leaves any other key to the title", async () => {
    withTitle();
    await body();

    const event = fireEvent.keyDown(screen.getByLabelText("Note title"), { key: "ArrowUp" });

    expect(event).toBe(true);
  });
});

describe("NoteEditor, the photo it uploads", () => {
  /** The hidden file input the photo command opens. */
  function filePicker(): HTMLInputElement {
    const input = document.querySelector('input[type="file"]');
    if (!input) throw new Error("no file input");
    return input as HTMLInputElement;
  }

  it("inserts the uploaded reference into the body", async () => {
    const onUploadImage = vi.fn<
      (file: File) => Promise<{ attachmentId: string; alt: string } | null>
    >(async () => ({ attachmentId: "att-1", alt: "cat.png" }));
    const { written } = mount({ onUploadImage });
    const doc = await body();

    fireEvent(doc, pasteEvent("/"));
    await screen.findByRole("listbox", { name: "Insert block" });
    fireEvent.mouseDown(screen.getByRole("option", { name: /Photo/ }));

    fireEvent.change(filePicker(), {
      target: { files: [new File([new Uint8Array([1])], "cat.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(written()).toContain("![cat.png](attachment:att-1)"));
    expect(onUploadImage).toHaveBeenCalledTimes(1);
  });

  it("ignores a file chosen without the command having run", async () => {
    const onUploadImage = vi.fn<
      (file: File) => Promise<{ attachmentId: string; alt: string } | null>
    >(async () => ({ attachmentId: "att-1", alt: "cat.png" }));
    mount({ onUploadImage });
    await body();

    fireEvent.change(filePicker(), {
      target: { files: [new File([new Uint8Array([1])], "cat.png", { type: "image/png" })] },
    });

    expect(onUploadImage).not.toHaveBeenCalled();
  });

  it("leaves the body alone when the upload is refused", async () => {
    const { written, onChange } = mount({ onUploadImage: async () => null });
    const doc = await body();

    fireEvent(doc, pasteEvent("/"));
    await screen.findByRole("listbox", { name: "Insert block" });
    fireEvent.mouseDown(screen.getByRole("option", { name: /Photo/ }));
    const afterCommand = onChange.mock.calls.length;

    fireEvent.change(filePicker(), {
      target: { files: [new File([new Uint8Array([1])], "cat.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(onChange.mock.calls.length).toBe(afterCommand));
    expect(written()).not.toContain("attachment:");
  });
});

describe("slashMenuPlacement", () => {
  const viewport = { width: 1000, height: 800 };
  const caret = (top: number, left = 100) => ({ top, bottom: top + 20, left }) as DOMRect;

  it("opens below the caret when there is room", () => {
    expect(slashMenuPlacement(caret(100), viewport)).toMatchObject({ top: 126, left: 100 });
  });

  it("opens above the caret near the bottom of the screen", () => {
    const placed = slashMenuPlacement(caret(750), viewport);
    expect(placed).toMatchObject({ bottom: 56 });
    expect(placed).not.toHaveProperty("top");
  });

  it("keeps the menu inside the right edge", () => {
    expect(slashMenuPlacement(caret(100, 950), viewport).left).toBe(752);
  });
});
