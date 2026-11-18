// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "../test/dom";
import type { Session } from "../lib/client";
import { splitTrash, type TrashableItems, type TrashListing } from "../lib/trash";
import type { Note, Notebook } from "../lib/types";

const restored: string[] = [];
const purged: string[][] = [];

vi.mock("../lib/trashApi", () => ({
  restoreItem: async (_session: unknown, _trash: TrashListing, id: string) => {
    restored.push(id);
  },
  purgeItems: async (_session: unknown, _trash: TrashListing, ids: string[]) => {
    purged.push(ids);
    return ids.length;
  },
}));

const { TrashPanel, TrashRow } = await import("./Trash");

const SESSION = { state: { collection_id: "col" } } as unknown as Session;
const RECENT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const OLDER = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

function trashOf(overrides: Partial<TrashableItems>): TrashListing {
  return splitTrash({
    addressBooks: [],
    contacts: [],
    calendars: [],
    calendarEvents: [],
    notes: [],
    notebooks: [],
    bookmarks: [],
    bookmarkCollections: [],
    tasks: [],
    taskLists: [],
    ...overrides,
  }).trash;
}

const notebook = (id: string, name: string, trashedAt?: string): Notebook => ({ id, name, raw: "{}", trashedAt });
const note = (id: string, title: string, extra: Partial<Note> = {}): Note => ({
  id,
  title,
  body: "",
  notebookId: "kept",
  raw: "{}",
  ...extra,
});

function seeded(): TrashListing {
  return trashOf({
    notebooks: [notebook("work", "Work", RECENT), notebook("kept", "Kept")],
    notes: [
      note("w1", "Inside work", { notebookId: "work" }),
      note("w2", "Also inside", { notebookId: "work" }),
      note("old", "Old idea", { trashedAt: OLDER }),
    ],
    bookmarks: [{ id: "b", title: "Not a note", url: "https://x", collectionId: "c", raw: "{}", trashedAt: RECENT }],
  });
}

beforeEach(() => {
  restored.length = 0;
  purged.length = 0;
});

afterEach(cleanup);

describe("TrashPanel", () => {
  it("lists only its own tab's items, newest first, with what each took", () => {
    render(<TrashPanel session={SESSION} trash={seeded()} tab="notes" onChanged={() => {}} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual(["Work", "Old idea"]);
    expect(rows[0]!.textContent).toContain("Notebook with 2 items");
    expect(rows[0]!.textContent).toContain("Deletes in 28 days");
    expect(screen.queryByText("Not a note")).toBeNull();
  });

  it("restores an item and re-lists", async () => {
    const onChanged = vi.fn();
    render(<TrashPanel session={SESSION} trash={seeded()} tab="notes" onChanged={onChanged} />);
    const row = screen.getAllByRole("listitem")[1]!;
    fireEvent.click(within(row).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restored).toEqual(["old"]));
    expect(onChanged).toHaveBeenCalled();
  });

  it("asks before deleting one item forever", async () => {
    render(<TrashPanel session={SESSION} trash={seeded()} tab="notes" onChanged={() => {}} />);
    fireEvent.click(within(screen.getAllByRole("listitem")[0]!).getByRole("button", { name: "Delete forever" }));
    expect(purged).toEqual([]);
    const dialog = screen.getByRole("dialog", { name: "Delete forever" });
    expect(dialog.textContent).toContain("the 2 items inside it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete forever" }));
    await waitFor(() => expect(purged).toEqual([["work"]]));
  });

  it("empties only this tab's trash", async () => {
    render(<TrashPanel session={SESSION} trash={seeded()} tab="notes" onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Empty trash" })).getByRole("button", { name: "Empty trash" }));
    await waitFor(() => expect(purged).toEqual([["work", "old"]]));
  });

  it("says when there is nothing in it", () => {
    render(<TrashPanel session={SESSION} trash={trashOf({})} tab="tasks" onChanged={() => {}} />);
    expect(screen.getByText("The trash is empty")).toBeDefined();
    expect(screen.getByRole("button", { name: "Empty trash" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("TrashRow", () => {
  it("shows the count and toggles", () => {
    const onToggle = vi.fn();
    render(<TrashRow count={3} active={false} onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: /Trash/ });
    expect(button.textContent).toContain("3");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalled();
  });
});
