// @vitest-environment jsdom
/**
 * `NoteTreeList`'s drag and drop, mounted on its own: which rows accept a drop,
 * and that the drop rule is read once per drag rather than per row per frame.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/dom";
import { buildNoteTree, noteSubtree } from "../lib/noteTree";
import { NoteTreeList } from "./NoteTreeList";
import type { Note } from "../lib/types";

const NOTEBOOK = "notebook-1";

function aNote(id: string, parentId?: string): Note {
  return { id, title: id, body: "", notebookId: NOTEBOOK, parentId, raw: "{}" };
}

/** A fake `DataTransfer`: jsdom has no native one for a real drag event to carry. */
class FakeDataTransfer {
  private store = new Map<string, string>();
  effectAllowed = "none";
  dropEffect = "none";
  setData(type: string, value: string) {
    this.store.set(type, value);
  }
  getData(type: string) {
    return this.store.get(type) ?? "";
  }
}

/**
 * Builds a native drag event carrying a fake `dataTransfer`, bypassing
 * `fireEvent`'s init dict (which cannot set a read-only `DragEvent` property)
 * by defining it directly on the plain `Event` React's plugin reads it from.
 */
function dragEvent(type: string, transfer: FakeDataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  return event;
}

function row(title: string): HTMLElement {
  const target = screen.getByRole("button", { name: title }).closest('[draggable="true"]');
  if (!target) throw new Error(`no draggable row for ${title}`);
  return target as HTMLElement;
}

function mount(notes: Note[]) {
  const onMove = vi.fn<(id: string, parentId: string | null) => void>();
  const blockedDropIds = vi.fn<(id: string) => Set<string>>(
    (id) => new Set(noteSubtree(notes, id)),
  );
  render(
    <NoteTreeList
      tree={buildNoteTree(notes, NOTEBOOK)}
      selectedId={null}
      expanded={new Set(notes.map((note) => note.id))}
      onToggle={() => {}}
      onSelect={() => {}}
      onAddChild={() => {}}
      onDelete={() => {}}
      blockedDropIds={blockedDropIds}
      onMove={onMove}
    />,
  );
  return { onMove, blockedDropIds };
}

describe("NoteTreeList drag and drop", () => {
  it("drops a note under an unrelated note", () => {
    const { onMove } = mount([aNote("a"), aNote("b")]);
    const transfer = new FakeDataTransfer();

    fireEvent(row("a"), dragEvent("dragstart", transfer));
    fireEvent(row("b"), dragEvent("dragover", transfer));
    fireEvent(row("b"), dragEvent("drop", transfer));

    expect(onMove.mock.calls).toEqual([["a", "b"]]);
  });

  it("refuses a drop on the dragged note's own descendant", () => {
    const { onMove } = mount([aNote("a"), aNote("child", "a")]);
    const transfer = new FakeDataTransfer();

    fireEvent(row("a"), dragEvent("dragstart", transfer));
    fireEvent(row("child"), dragEvent("dragover", transfer));
    fireEvent(row("child"), dragEvent("drop", transfer));

    expect(onMove).not.toHaveBeenCalled();
  });

  it("refuses a drop on the dragged note itself", () => {
    const { onMove } = mount([aNote("a"), aNote("b")]);
    const transfer = new FakeDataTransfer();

    fireEvent(row("a"), dragEvent("dragstart", transfer));
    fireEvent(row("a"), dragEvent("drop", transfer));

    expect(onMove).not.toHaveBeenCalled();
  });

  it("drops a nested note back to the top level", () => {
    const { onMove } = mount([aNote("a"), aNote("child", "a")]);
    const transfer = new FakeDataTransfer();

    fireEvent(row("child"), dragEvent("dragstart", transfer));
    const zone = screen.getByText("Move to top level");
    fireEvent(zone, dragEvent("dragover", transfer));
    fireEvent(zone, dragEvent("drop", transfer));

    expect(onMove.mock.calls).toEqual([["child", null]]);
  });

  it("asks for the blocked ids once per drag, not per row per frame", () => {
    const notes = [aNote("a"), aNote("b"), aNote("c"), aNote("child", "a")];
    const { blockedDropIds } = mount(notes);
    const transfer = new FakeDataTransfer();

    fireEvent(row("a"), dragEvent("dragstart", transfer));
    for (let frame = 0; frame < 20; frame += 1) {
      fireEvent(row("b"), dragEvent("dragover", transfer));
      fireEvent(row("c"), dragEvent("dragover", transfer));
    }

    expect(blockedDropIds.mock.calls).toEqual([["a"]]);
  });

  it("stops offering the root zone once the drag ends", () => {
    mount([aNote("a"), aNote("b")]);
    const transfer = new FakeDataTransfer();

    fireEvent(row("a"), dragEvent("dragstart", transfer));
    expect(screen.queryByText("Move to top level")).not.toBeNull();

    fireEvent(row("a"), dragEvent("dragend", transfer));
    expect(screen.queryByText("Move to top level")).toBeNull();
  });
});
