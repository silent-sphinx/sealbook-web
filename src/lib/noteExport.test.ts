import { describe, expect, it } from "vitest";

import { parseMarkdown } from "./markdown";
import { DEFAULT_NOTEBOOK_ID } from "./note";
import { docToMarkdown, markdownToDoc } from "./noteDoc";
import {
  generateNoteExportData,
  parseNoteImport,
  serializeNoteBundle,
  serializeNoteJson,
} from "./noteExport";
import type { Note, Notebook } from "./types";

const notebooks: Notebook[] = [
  { id: DEFAULT_NOTEBOOK_ID, name: "Default Notebook", raw: "" },
  { id: "work", name: "Work", raw: "" },
];

const note = (over: Partial<Note>): Note => ({
  id: "n",
  raw: "",
  title: "Title",
  body: "body",
  notebookId: DEFAULT_NOTEBOOK_ID,
  ...over,
});

const notes: Note[] = [
  note({
    id: "a",
    title: "Weekly plan",
    body: "# Monday\n\n- ship notes\n\n---\n\nnot a separator\n",
    notebookId: "work",
    pinned: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  }),
  note({ id: "b", title: "Ideas", body: "Just a line.", updatedAt: "2026-01-15T00:00:00.000Z" }),
];

describe("markdown bundle", () => {
  it("round trips every note, including a body containing a bare rule", () => {
    const bundle = serializeNoteBundle(notes, notebooks);
    const result = parseNoteImport("sealbook-notes.md", bundle, DEFAULT_NOTEBOOK_ID);
    expect(result.format).toBe("Markdown");
    expect(result.notes).toHaveLength(2);

    const plan = result.notes.find((entry) => entry.title === "Weekly plan");
    expect(plan).toBeDefined();
    // The `---` inside the body must not have been read as a note boundary.
    expect(plan?.body).toBe("# Monday\n\n- ship notes\n\n---\n\nnot a separator");
    expect(plan?.pinned).toBe(true);
    expect(plan?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(plan?.updatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("records the notebook name for each note", () => {
    const bundle = serializeNoteBundle(notes, notebooks);
    expect(bundle).toContain('notebook: "Work"');
    expect(bundle).toContain('notebook: "Default Notebook"');
  });

  it("puts every imported note in the chosen notebook", () => {
    const result = parseNoteImport("x.md", serializeNoteBundle(notes, notebooks), "work");
    expect(result.notes.every((entry) => entry.notebookId === "work")).toBe(true);
  });

  it("survives a title containing quotes and newlines", () => {
    const awkward = note({ title: 'He said "hi"\tand left', body: "b" });
    const back = parseNoteImport("x.md", serializeNoteBundle([awkward], notebooks), DEFAULT_NOTEBOOK_ID);
    expect(back.notes[0].title).toBe('He said "hi"\tand left');
  });

  it("reads a plain markdown file as one note, titled from its heading", () => {
    const result = parseNoteImport("Shopping.md", "# Shopping\n\n- milk\n", DEFAULT_NOTEBOOK_ID);
    expect(result.notes).toEqual([
      expect.objectContaining({ title: "Shopping", body: "- milk" }),
    ]);
  });

  it("falls back to the filename when a plain file has no heading", () => {
    const result = parseNoteImport("Scratch.md", "just text\n", DEFAULT_NOTEBOOK_ID);
    expect(result.notes[0].title).toBe("Scratch");
    expect(result.notes[0].body).toBe("just text");
  });

  it("parses CRLF input identically", () => {
    const bundle = serializeNoteBundle(notes, notebooks);
    const crlf = parseNoteImport("x.md", bundle.replace(/\n/gu, "\r\n"), DEFAULT_NOTEBOOK_ID);
    expect(crlf.notes.map((entry) => entry.title)).toEqual(
      parseNoteImport("x.md", bundle, DEFAULT_NOTEBOOK_ID).notes.map((entry) => entry.title),
    );
  });

  it("returns nothing for an empty file rather than one blank note", () => {
    expect(parseNoteImport("x.md", "   \n\n", DEFAULT_NOTEBOOK_ID).notes).toEqual([]);
  });
});

describe("json backup", () => {
  it("round trips through the JSON format", () => {
    const json = serializeNoteJson(notes, notebooks);
    const result = parseNoteImport("sealbook-notes-backup.json", json, DEFAULT_NOTEBOOK_ID);
    expect(result.format).toBe("JSON");
    expect(result.notes).toHaveLength(2);
    expect(result.notes.find((entry) => entry.title === "Ideas")?.body).toBe("Just a line.");
  });

  it("accepts a bare array of notes", () => {
    const result = parseNoteImport("x.json", JSON.stringify([{ title: "A", body: "b" }]), "work");
    expect(result.format).toBe("JSON");
    expect(result.notes).toEqual([
      expect.objectContaining({ title: "A", body: "b", notebookId: "work" }),
    ]);
  });

  it("skips entries with neither a title nor a body", () => {
    const result = parseNoteImport(
      "x.json",
      JSON.stringify({ notes: [{ title: "", body: "" }, { title: "Kept", body: "" }] }),
      DEFAULT_NOTEBOOK_ID,
    );
    expect(result.notes.map((entry) => entry.title)).toEqual(["Kept"]);
  });

  it("reads a .json file that is not JSON as markdown instead of throwing", () => {
    const result = parseNoteImport("notes.json", "# Still markdown\n\nbody", DEFAULT_NOTEBOOK_ID);
    expect(result.format).toBe("Markdown");
    expect(result.notes[0].title).toBe("Still markdown");
  });
});

describe("limits", () => {
  it("reports a note too large to store instead of failing mid-upload", () => {
    const huge = note({ title: "Huge", body: "m".repeat(9 * 1024 * 1024) });
    const result = parseNoteImport("x.md", serializeNoteBundle([huge], notebooks), DEFAULT_NOTEBOOK_ID);
    expect(result.notes).toHaveLength(0);
    expect(result.skipped).toEqual([
      { title: "Huge", reason: "larger than the 8 MB limit for one note" },
    ]);
  });

  it("accepts a note that fits the raised ceiling", () => {
    const big = note({ title: "Big", body: "m".repeat(5 * 1024 * 1024) });
    const result = parseNoteImport("x.md", serializeNoteBundle([big], notebooks), DEFAULT_NOTEBOOK_ID);
    expect(result.notes).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  });

  it("refuses a file past the import ceiling", () => {
    expect(() => parseNoteImport("x.md", "m".repeat(129 * 1024 * 1024), DEFAULT_NOTEBOOK_ID)).toThrow(
      /too large/u,
    );
  });

  it("refuses a bundle with too many notes", () => {
    const many = Array.from({ length: 501 }, (_, i) => note({ id: `n${i}`, title: `N${i}` }));
    expect(() => parseNoteImport("x.md", serializeNoteBundle(many, notebooks), DEFAULT_NOTEBOOK_ID)).toThrow(
      /too many notes/u,
    );
  });
});

describe("generateNoteExportData", () => {
  it("names and types each format", () => {
    const md = generateNoteExportData("md", notes, notebooks);
    expect(md.filename).toMatch(/^sealbook-notes-\d{4}-\d{2}-\d{2}\.md$/u);
    expect(md.mime).toBe("text/markdown;charset=utf-8");

    const json = generateNoteExportData("json", notes, notebooks);
    expect(json.filename).toMatch(/^sealbook-notes-backup-\d{4}-\d{2}-\d{2}\.json$/u);
    expect(json.mime).toBe("application/json;charset=utf-8");
  });
});

describe("importing a table an exporter spelled loosely", () => {
  // The shape a Confluence or Word export produces: merged cells flattened, so
  // the delimiter row has blank cells and does not match the header's width.
  const source = [
    "| **Docker Services** |     |     |     |     |",
    "| --- |     |     |     |     | --- | --- | --- | --- |",
    "| Stack | Service Name | Domain | External Port | Internal Port |",
    "| compose_portainer | Portainer | portainer. | 9000 | 9000 (http) |",
    "| immich | immich_server | photos. | 1040 | 2283 (http) |",
    "| immich_machine_learning | \\-  | \\-  |     |",
  ].join("\n");

  const body = (): string => {
    const result = parseNoteImport("services.md", source);
    return result.notes[0].body;
  };

  it("arrives as a table rather than one flattened paragraph", () => {
    expect(parseMarkdown(body()).map((block) => block.kind)).toEqual(["table"]);
  });

  it("keeps the underscores in a service name", () => {
    const imported = body();
    expect(imported).toContain("compose_portainer");
    expect(imported).toContain("immich_server");
    expect(imported).toContain("immich_machine_learning");
  });

  it("survives being opened and edited without changing", () => {
    const imported = body();
    expect(docToMarkdown(markdownToDoc(imported))).toBe(imported);
  });

  it("keeps every cell of the widest row", () => {
    // The delimiter row claimed nine columns; the content never exceeds five.
    const rows = body().split("\n");
    expect(rows[1]).toBe("| --- | --- | --- | --- | --- |");
    expect(rows).toHaveLength(6);
  });
});
