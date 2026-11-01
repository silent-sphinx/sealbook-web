/**
 * Writes what this tree's readers make of every payload core's write tables produce.
 *
 * Run by `scripts/check-older-reader.sh`, once here and once in a worktree of the
 * last release, so the two views can be compared. Only functions both trees export
 * are named, and they are reached through dynamic imports, because the file is
 * copied unchanged into the older tree.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";

const out = process.env.READER_DUMP;
const fixtures = process.env.SEALBOOK_FIXTURES;

type Reader = (id: string, raw: string) => unknown;

// v1.4.4 read events inline in its vault listing; this is that read.
function inlineEvent(id: string, raw: string): unknown {
  const value = JSON.parse(raw);
  return {
    id,
    title: value.title?.trim() || "Untitled event",
    start: value.start ?? "",
    end: value.end,
    notes: value.notes,
    location: value.location,
    participants: value.participants,
    timezone: value.timezone,
    calendarId: value.calendarId,
    recurrence: value.recurrence,
    raw,
  };
}

async function readers(): Promise<Record<string, Reader>> {
  const task = await import("../lib/task");
  const bookmark = await import("../lib/bookmark");
  const note = await import("../lib/note");
  const calendar: Record<string, unknown> = await import("../lib/calendar");
  const contact = await import("../lib/contact");
  const addressBook = await import("../lib/addressBook");
  const settings = await import("../lib/accountSettings");
  return {
    "task.write": task.parseTask,
    "task_list.write": task.parseTaskList,
    "bookmark.write": bookmark.parseBookmark,
    "bookmark_collection.write": bookmark.parseBookmarkCollection,
    "note.write": note.parseNote,
    "notebook.write": note.parseNotebook,
    "calendar.write": calendar.parseCalendar as Reader,
    "event.write": (calendar.parseEvent as Reader | undefined) ?? inlineEvent,
    "contact.write": (id, raw) => contact.parseContact(id, raw, "", 0),
    "address_book.write": addressBook.parseAddressBook,
    "settings.write": (_id, raw) => settings.parseAccountSettings(raw),
  };
}

function view(read: Reader, id: string, raw: string): unknown {
  try {
    return JSON.parse(JSON.stringify(read(id, raw)));
  } catch (error) {
    return { threw: String(error) };
  }
}

describe.skipIf(!out || !fixtures)("reader dump", () => {
  it("reads every payload core writes", async () => {
    const read = await readers();
    const manifest = JSON.parse(readFileSync(join(fixtures!, "corpus.json"), "utf8"));
    const views: Record<string, unknown> = {};
    for (const { file, tables } of manifest.fixtures) {
      const doc = JSON.parse(readFileSync(join(fixtures!, file), "utf8"));
      for (const { table, op, expect } of tables) {
        if (!(op in read)) continue;
        doc[table].forEach((row: Record<string, unknown>, index: number) => {
          const raw = row[expect];
          if (typeof raw !== "string") return;
          const key = `${file}#${table}[${index}] ${row.case ?? ""}`.trim();
          views[key] = { op, raw, view: view(read[op], "00000000-0000-4000-8000-000000000001", raw) };
        });
      }
    }
    writeFileSync(out!, JSON.stringify(views));
  });
});
