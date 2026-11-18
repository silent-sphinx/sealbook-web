// @vitest-environment jsdom
/**
 * Hiding a calendar used to be a set kept in this browser. It is now a flag on
 * the calendar, so a vault opened here for the first time since moves the old
 * set onto the calendars, and only ever adds a flag.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import { enrolDevice, setConnectionDomain } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_CALENDAR_ID } from "./lib/calendar";
import { DEFAULT_ADDRESS_BOOK_ID } from "./lib/addressBook";
import { DEFAULT_CALENDAR_COLOR } from "./lib/types";
import type { Calendar } from "./lib/types";

const PASSWORD = "correct horse battery";
const WORK_ID = "calendar-work";
const HIDDEN_KEY = "sealbook.hidden-calendars.collection-1";

let calendars: Calendar[] = [];
let writes: { id?: string; hideFromAll?: boolean }[] = [];

vi.mock("./lib/client", async () => {
  const actual = await vi.importActual<typeof import("./lib/client")>("./lib/client");
  return {
    ...actual,
    loginAccount: async (state: unknown) => ({
      state,
      collectionKey: "k",
      token: "t",
      latestRevision: 1,
      keyEpoch: 0,
      manifestSeq: 1,
    }),
    listVault: async () => ({
      addressBooks: [{ id: DEFAULT_ADDRESS_BOOK_ID, name: "Contacts", raw: "{}" }],
      contacts: [],
      calendars: calendars.map((calendar) => ({ ...calendar })),
      calendarEvents: [],
      notes: [],
      notebooks: [],
      accountSettings: DEFAULT_ACCOUNT_SETTINGS,
      unopened: 0,
    }),
    ensureDefaultAddressBook: async (_session: unknown, books: unknown) => books,
    ensureDefaultCalendar: async (_session: unknown, existing: unknown) => existing,
    putCalendar: async (_session: unknown, draft: Partial<Calendar>, id?: string) => {
      writes.push({ id, hideFromAll: draft.hideFromAll });
      calendars = calendars.map((calendar) => (calendar.id === id ? { ...calendar, ...draft } : calendar));
      return id;
    },
  };
});

import App from "./App";

function aCalendar(id: string, name: string, overrides: Partial<Calendar> = {}): Calendar {
  return { id, name, color: DEFAULT_CALENDAR_COLOR, raw: "{}", ...overrides };
}

async function unlock() {
  setConnectionDomain();
  await enrolDevice(PASSWORD);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByRole("button", { name: "Calendar" });
}

const localIds = () => JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[];

beforeEach(() => {
  writes = [];
  calendars = [aCalendar(DEFAULT_CALENDAR_ID, "Calendar"), aCalendar(WORK_ID, "Work")];
});

describe("moving a browser's hidden calendars onto the calendars", () => {
  it("marks the calendars the old set names, then drops the set", async () => {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([WORK_ID, "calendar-gone"]));
    await unlock();

    await waitFor(() => expect(writes).toEqual([{ id: WORK_ID, hideFromAll: true }]));
    await waitFor(() => expect(localIds()).toEqual([]));
  });

  it("writes nothing for a calendar that is already hidden, and never shows one", async () => {
    calendars = calendars.map((calendar) => (calendar.id === WORK_ID ? { ...calendar, hideFromAll: true } : calendar));
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([WORK_ID]));
    await unlock();

    await waitFor(() => expect(localIds()).toEqual([]));
    expect(writes).toEqual([]);
  });
});
