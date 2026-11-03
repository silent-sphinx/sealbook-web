import { describe, expect, it } from "vitest";

import { putContact } from "../lib/addressBookApi";
import {
  flushOutbox,
  importVault,
  listVault,
  loginAccount,
  putSealed,
  registerAccount,
} from "../lib/client";
import { putNote } from "../lib/noteApi";
import { localObjects } from "../lib/outbox";
import { emptyDraft } from "../lib/contact";
import { DEFAULT_NOTEBOOK_ID, NOTE_CONTENT_TYPE, serializeNote } from "../lib/note";
import { JSCONTACT_CONTENT_TYPE } from "../lib/addressBook";
import type { Note } from "../lib/types";
import { readFixture } from "./fixtures";

const server = process.env.SEALBOOK_E2E_SERVER;

const scenario = JSON.parse(readFixture("live/scenario.json")) as {
  password: string;
  wrong_password: string;
  phrase_words: number;
  contacts: string[];
  deleted_contact: string;
  note: { title: string; body: string };
  expect: { live_objects: number };
  offline: {
    base: { title: string; body: string };
    local_title: string;
    remote_body: string;
    conflict_local_title: string;
    conflict_remote_title: string;
    copy_title_prefix: string;
  };
};

describe.skipIf(!server)("live server scenario", () => {
  it("registers, writes, reads back and signs in again", async () => {
    const username = `web${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const registered = await registerAccount(server!, username, scenario.password);
    expect(registered.phrase.trim().split(/\s+/)).toHaveLength(scenario.phrase_words);

    const session = registered.session;
    const ids = new Map<string, string>();
    for (const name of scenario.contacts) {
      ids.set(name, await putContact(session, { ...emptyDraft(), name }));
    }
    await putNote(session, {
      title: scenario.note.title,
      body: scenario.note.body,
      notebookId: DEFAULT_NOTEBOOK_ID,
    });
    await putSealed(
      session,
      ids.get(scenario.deleted_contact)!,
      JSCONTACT_CONTENT_TYPE,
      true,
      "",
    );

    const check = async (s: typeof session) => {
      const listing = await listVault(s);
      const live = listing.contacts.map((c) => c.name).sort();
      expect(live).toEqual(
        scenario.contacts.filter((n) => n !== scenario.deleted_contact).sort(),
      );
      expect(listing.notes.map((n) => [n.title, n.body])).toEqual([
        [scenario.note.title, scenario.note.body],
      ]);
      expect(localObjects().length).toBe(scenario.expect.live_objects);
    };
    await check(session);

    const again = await loginAccount(session.state, scenario.password);
    await check(again);
    await expect(loginAccount(session.state, scenario.wrong_password)).rejects.toThrow();
  }, 60_000);

  it("merges an offline edit with another session's, and copies a conflicting one", async () => {
    const offline = scenario.offline;
    const username = `web${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const session = (await registerAccount(server!, username, scenario.password)).session;
    const id = await putNote(session, { ...offline.base, notebookId: DEFAULT_NOTEBOOK_ID });
    const noteOf = async () => (await listVault(session)).notes.find((note) => note.id === id)!;

    // This session edits one field while it cannot reach the server, and a
    // second session for the account writes another field in the meantime.
    const other = await loginAccount(session.state, scenario.password);
    const elsewhere = async (from: Note, change: { title?: string; body?: string }) => {
      const payload = serializeNote({ ...from, ...change });
      await importVault(other, [{ id, contentType: NOTE_CONTENT_TYPE, payload }], { overwrite: true });
    };
    const disconnected = { ...session, offline: true };

    let base = await noteOf();
    await putNote(disconnected, { ...base, title: offline.local_title }, id);
    await elsewhere(base, { body: offline.remote_body });
    expect((await flushOutbox(session)).stopped).toBeUndefined();
    const merged = await noteOf();
    expect([merged.title, merged.body]).toEqual([offline.local_title, offline.remote_body]);

    base = await noteOf();
    await putNote(disconnected, { ...base, title: offline.conflict_local_title }, id);
    await elsewhere(base, { title: offline.conflict_remote_title });
    expect((await flushOutbox(session)).stopped).toBeUndefined();
    const notes = (await listVault(session)).notes;
    expect(notes.find((note) => note.id === id)?.title).toBe(offline.conflict_remote_title);
    const copies = notes.filter((note) => note.title.startsWith(offline.copy_title_prefix));
    expect(copies).toHaveLength(1);
    expect(copies[0].body).toBe(offline.remote_body);
  }, 60_000);
});
