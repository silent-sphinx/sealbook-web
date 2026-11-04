import { describe, expect, it } from "vitest";

import {
  coreAddressBookParse,
  coreAddressBookWrite,
  coreBookmarkCollectionParse,
  coreBookmarkCollectionTone,
  coreBookmarkCollectionWrite,
  coreBookmarkParse,
  coreBookmarkWrite,
  coreCalendarParse,
  coreCalendarWrite,
  coreContactParse,
  coreContactWrite,
  coreEventParse,
  coreEventWrite,
  coreFlushPlan,
  coreLocalView,
  coreMergePayload,
  coreNormalizeDueDate,
  coreNoteParse,
  coreNoteWrite,
  coreNotebookParse,
  coreNotebookTone,
  coreNotebookWrite,
  coreOpenRow,
  coreOutboxPush,
  coreSettingsParse,
  coreSettingsWrite,
  coreTaskListParse,
  coreTaskListTone,
  coreTaskListWrite,
  coreTaskParse,
  coreTaskWrite,
} from "../lib/wasm";
import { EMPTY_OUTBOX } from "../lib/localStore";
import { readFixture } from "./fixtures";

/** An absent option as core serializes it, where the field is not skipped. */
function withNulls(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, field: unknown) => field ?? null));
}

type Arg = string | { value: unknown };
type Table = { table: string; op: string; args: Arg[]; expect: string };
type Corpus = { fixtures: { file: string; tables: Table[] }[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const operations: Record<string, (args: any[]) => unknown> = {
  "sealed.open_row": ([key, collectionId, row]) => coreOpenRow(key, collectionId, row),
  "task.write": ([draft, now]) => coreTaskWrite(draft, now),
  "task.parse": ([id, raw]) => coreTaskParse(id, raw),
  "task.normalize_due": ([value]) => coreNormalizeDueDate(value),
  "task_list.write": ([draft]) => coreTaskListWrite(draft),
  "task_list.parse": ([id, raw]) => coreTaskListParse(id, raw),
  "task_list.tone": ([lists, id]) => coreTaskListTone(lists, id),
  "bookmark.write": ([draft, now]) => coreBookmarkWrite(draft, now),
  "bookmark.parse": ([id, raw]) => coreBookmarkParse(id, raw),
  "bookmark_collection.write": ([draft]) => coreBookmarkCollectionWrite(draft),
  "bookmark_collection.parse": ([id, raw]) => coreBookmarkCollectionParse(id, raw),
  "bookmark_collection.tone": ([collections, id]) => coreBookmarkCollectionTone(collections, id),
  "note.write": ([draft, now]) => coreNoteWrite(draft, now),
  "note.parse": ([id, raw]) => coreNoteParse(id, raw),
  "notebook.tone": ([id, color]) => coreNotebookTone(id, color ?? undefined),
  "notebook.write": ([name, color, previous]) =>
    coreNotebookWrite(name, color ?? undefined, previous ?? undefined),
  "notebook.parse": ([id, raw]) => coreNotebookParse(id, raw),
  "calendar.write": ([draft]) => coreCalendarWrite(draft),
  "calendar.parse": ([id, raw]) => coreCalendarParse(id, raw),
  "event.write": ([draft]) => coreEventWrite(draft),
  "event.parse": ([id, raw]) => coreEventParse(id, raw),
  "contact.write": ([draft, now]) => coreContactWrite(draft, now),
  "contact.parse": ([id, raw]) => coreContactParse(id, raw),
  "address_book.write": ([draft]) => coreAddressBookWrite(draft),
  "address_book.parse": ([id, raw]) => coreAddressBookParse(id, raw),
  "settings.write": ([draft]) => coreSettingsWrite(draft),
  "settings.parse": ([raw]) => coreSettingsParse(raw),
  "offline.outbox_push": ([pushes]) => pushes.reduce(coreOutboxPush, EMPTY_OUTBOX),
  "offline.local_view": ([vault, outbox]) => coreLocalView(vault, outbox),
  "offline.merge": ([contentType, base, local, remote, date]) =>
    withNulls(coreMergePayload(contentType, base, local, remote, date)),
  "offline.flush_plan": ([outbox, vault, date]) => coreFlushPlan(outbox, vault, date),
};

const corpus = JSON.parse(readFixture("corpus.json")) as Corpus;

for (const { file, tables } of corpus.fixtures) {
  const fixture = JSON.parse(readFixture(file)) as Record<string, unknown>;
  for (const { table, op, args, expect: field } of tables) {
    const run = operations[op];
    describe(`${file} ${table}`, () => {
      it("names an operation this host has", () => {
        expect(Object.keys(operations)).toContain(op);
      });

      const rows = fixture[table] as Record<string, unknown>[];
      it.each(rows.map((row) => [row.case as string, row] as const))("%s", (_case, row) => {
        const given = args.map((key) =>
          typeof key === "object" ? key.value : key === "$now" ? fixture.now : row[key],
        );
        const got = run(given);
        expect(got === undefined ? null : got).toEqual(row[field] ?? null);
      });
    });
  }
}
