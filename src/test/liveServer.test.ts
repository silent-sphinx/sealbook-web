import { describe, expect, it } from "vitest";

import { putContact } from "../lib/addressBookApi";
import { listVault, loginAccount, putSealed, registerAccount } from "../lib/client";
import { putNote } from "../lib/noteApi";
import { localObjects } from "../lib/outbox";
import { emptyDraft } from "../lib/contact";
import { DEFAULT_NOTEBOOK_ID } from "../lib/note";
import { JSCONTACT_CONTENT_TYPE } from "../lib/addressBook";
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
});
