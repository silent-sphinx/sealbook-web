import { describe, expect, it } from "vitest";

import {
  coreDefaultNotebookId,
  coreErrorOf,
  coreNoteKeys,
  coreNoteParse,
  coreNoteWrite,
  coreNotebookKeys,
  coreNotebookNameById,
  coreNotebookParse,
  coreNotebookWrite,
  coreResolveNotebookId,
} from "./wasm";
import type { CoreNote, CoreNoteDraft, CoreNotebook } from "./wasm";
import {
  DEFAULT_NOTEBOOK_ID,
  DEFAULT_NOTEBOOK_NAME,
  NOTEBOOK_CONTENT_TYPE,
  NOTE_CONTENT_TYPE,
  UNREADABLE_NOTE_TITLE,
  UNTITLED_NOTEBOOK_NAME,
  UNTITLED_NOTE_TITLE,
  noteDraftWritable,
  parseNote,
  serializeNote,
} from "./note";
import { readFixture } from "../test/fixtures";

/**
 * The shared note fixture, through the same core the CLI and Android run.
 *
 * Held to the same document as `sealbook-core/tests/notes.rs` and Android's
 * `NotePayloadTest`. The payloads are pinned byte for byte, which they can be
 * because core writes them for all three hosts: this is the only layer with no
 * server check behind it, so a key or a value that differs here differs in the
 * plaintext and nothing but this test would say so.
 */
type Fixture = {
  now: string;
  constants: {
    note_content_type: string;
    notebook_content_type: string;
    note_keys: string[];
    notebook_keys: string[];
    default_notebook_id: string;
    default_notebook_name: string;
    untitled_note_title: string;
    unreadable_note_title: string;
    untitled_notebook_name: string;
  };
  writes: { case: string; draft: CoreNoteDraft; payload: string }[];
  parses: { case: string; id: string; raw: string; note: CoreNote }[];
  notebook_writes: { case: string; name: string; previous?: string; payload: string }[];
  notebook_parses: { case: string; id: string; raw: string; notebook: CoreNotebook }[];
  refusals: { case: string; error: string }[];
};

const fixture = JSON.parse(readFixture("payloads/notes.json")) as Fixture;

describe("the constants this client mirrors", () => {
  /**
   * `note.ts` keeps these as literals because module scope runs before the wasm
   * module is instantiated. That is what makes drift possible, and this is what
   * catches it.
   */
  it("are core's", () => {
    expect(NOTE_CONTENT_TYPE).toBe(fixture.constants.note_content_type);
    expect(NOTEBOOK_CONTENT_TYPE).toBe(fixture.constants.notebook_content_type);
    expect(DEFAULT_NOTEBOOK_ID).toBe(fixture.constants.default_notebook_id);
    expect(DEFAULT_NOTEBOOK_ID).toBe(coreDefaultNotebookId());
    expect(DEFAULT_NOTEBOOK_NAME).toBe(fixture.constants.default_notebook_name);
    expect(UNTITLED_NOTE_TITLE).toBe(fixture.constants.untitled_note_title);
    expect(UNREADABLE_NOTE_TITLE).toBe(fixture.constants.unreadable_note_title);
    expect(UNTITLED_NOTEBOOK_NAME).toBe(fixture.constants.untitled_notebook_name);
  });

  it("include the owned key sets, which are the union across every client", () => {
    expect(coreNoteKeys()).toEqual(fixture.constants.note_keys);
    expect(coreNotebookKeys()).toEqual(fixture.constants.notebook_keys);
  });
});

describe("a payload from a newer schema major", () => {
  const future = '{"@type":"Note","version":"2.0","title":"future"}';

  it("is read, because a lenient read beats a blank row", () => {
    const note = coreNoteParse("n1", future);
    expect(note.title).toBe("future");
    expect(note.readable).toBe(false);
  });

  it("is never written over", () => {
    const draft: CoreNoteDraft = {
      title: "edited",
      body: "",
      notebook_id: DEFAULT_NOTEBOOK_ID,
      parent_id: undefined,
      attachments: [],
      created_at: undefined,
      pinned: undefined,
      raw: future,
    };
    let caught: unknown;
    try {
      coreNoteWrite(draft, fixture.now);
    } catch (err) {
      caught = err;
    }
    expect(coreErrorOf(caught)?.kind).toBe(fixture.refusals[0].error);
  });

  it("is refused for a notebook too", () => {
    let caught: unknown;
    try {
      coreNotebookWrite("edited", '{"@type":"Notebook","version":"3.1","name":"future"}');
    } catch (err) {
      caught = err;
    }
    expect(coreErrorOf(caught)?.kind).toBe(fixture.refusals[1].error);
  });
});

describe("this client's own note helpers", () => {
  /**
   * The web removed favouriting, so `serializeNote` passes `pinned` as
   * `undefined`: it must neither write the key nor strip a value Android wrote.
   * That is the one three-state field in the payload, and this is the case it
   * exists for.
   */
  it("leave a pinned value Android wrote alone", () => {
    const stored = '{"@type":"Note","version":"1.0","title":"old","pinned":true}';
    const note = parseNote("n1", stored);
    const written = JSON.parse(serializeNote({ ...note, title: "new" })) as Record<string, unknown>;
    expect(written.title).toBe("new");
    expect(written.pinned).toBe(true);
  });

  /**
   * The gotcha that bit twice while photos were being added: a draft assembled
   * field by field drops whatever the assembling code forgot. Going through the
   * parsed note is what stops it, so this asserts the round trip rather than the
   * fields.
   */
  it("carry a photo and an unknown key through a save", () => {
    const stored = fixture.parses[0].raw;
    const note = parseNote("n1", stored);
    expect(note.attachments).toHaveLength(1);

    const written = JSON.parse(serializeNote(note)) as Record<string, unknown>;
    expect(written.somethingNewer).toEqual({ from: "a later build" });
    const attachments = written.attachments as Record<string, unknown>[];
    expect(attachments[0].displayWidth).toBe(480);
    expect(attachments[0].caption).toBe("also from a later build");
  });

  /**
   * `noteFitsObjectLimit` and the save both serialise, so without this the
   * refusal would come out of the autosaver as an exception rather than as
   * something the view can say.
   */
  it("report a note a newer client wrote as one this build may not save", () => {
    const future = '{"@type":"Note","version":"2.0","title":"future"}';
    expect(noteDraftWritable(parseNote("n1", future))).toBe(false);
    expect(noteDraftWritable(parseNote("n1", '{"@type":"Note","version":"1.9"}'))).toBe(true);
    expect(noteDraftWritable({ title: "t", body: "", notebookId: DEFAULT_NOTEBOOK_ID })).toBe(true);
  });

  it("resolve a blank notebook to the one every account has", () => {
    expect(coreResolveNotebookId(undefined)).toBe(DEFAULT_NOTEBOOK_ID);
    expect(coreResolveNotebookId("   ")).toBe(DEFAULT_NOTEBOOK_ID);
    expect(coreResolveNotebookId("  n1  ")).toBe("n1");
  });

  it("name a notebook that is gone after the default one", () => {
    const notebooks = [coreNotebookParse(DEFAULT_NOTEBOOK_ID, '{"name":"Mine"}')];
    expect(coreNotebookNameById(notebooks, undefined)).toBe("Mine");
    expect(coreNotebookNameById(notebooks, "gone")).toBe(DEFAULT_NOTEBOOK_NAME);
  });
});
