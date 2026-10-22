// @vitest-environment jsdom
/**
 * Managing the calendars themselves, mounted over a faked `lib/client`.
 *
 * `CalendarEventEditing.test.tsx` covers one event's payload through the real
 * seal; this covers the surrounding view, where the damage is structural rather
 * than a dropped field: a delete that leaves a calendar's events behind, an
 * archive that strands the account with nowhere to put a new event, a repeat
 * that silently runs forever, and an edit of a generated occurrence writing to
 * an id the vault does not hold.
 *
 * The writes are recorded in order, because for a delete the order is the
 * contract: the events go first, so a failure part way cannot leave rows
 * pointing at a calendar that is gone.
 */

import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "./test/dom";
import { aDeviceState } from "./test/vault";
import { DEFAULT_CALENDAR_ID } from "./lib/calendar";
import { HIDDEN_CALENDARS } from "./lib/calendarVisibility";
import { DEFAULT_CALENDAR_COLOR } from "./lib/types";
import type { Calendar, CalendarEvent } from "./lib/types";
import type { Session } from "./lib/client";

type Write = {
  kind: "putCalendar" | "putEvent" | "deleteCalendar" | "deleteEvent";
  id?: string;
  draft?: Record<string, unknown>;
};

const writes: Write[] = [];
let calendars: Calendar[] = [];
let events: CalendarEvent[] = [];

vi.mock("./lib/client", async () => {
  const actual = await vi.importActual<typeof import("./lib/client")>("./lib/client");
  return {
    ...actual,
    ensureDefaultCalendar: async (_session: unknown, existing: unknown) => existing,
    putCalendar: async (_session: unknown, draft: Record<string, unknown>, id?: string) => {
      writes.push({ kind: "putCalendar", id, draft });
      const at = calendars.findIndex((calendar) => calendar.id === id);
      if (at === -1) {
        const created = { id: `calendar-${calendars.length + 1}`, ...draft } as Calendar;
        calendars = [...calendars, created];
        return created.id;
      }
      calendars = calendars.map((calendar) =>
        calendar.id === id ? ({ ...calendar, ...draft } as Calendar) : calendar,
      );
      return id;
    },
    putCalendarEvent: async (_session: unknown, draft: Record<string, unknown>, id?: string) => {
      writes.push({ kind: "putEvent", id, draft });
      return id ?? "event-new";
    },
    deleteCalendar: async (_session: unknown, id: string) => {
      writes.push({ kind: "deleteCalendar", id });
      calendars = calendars.filter((calendar) => calendar.id !== id);
    },
    deleteCalendarEvent: async (_session: unknown, id: string) => {
      writes.push({ kind: "deleteEvent", id });
      events = events.filter((event) => event.id !== id);
    },
  };
});

import { CalendarView } from "./components/CalendarView";

const TIMEZONE = "Europe/London";
const COLLECTION = "collection-1";
const WORK_ID = "calendar-work";

const session = {
  state: aDeviceState({ collection_id: COLLECTION }),
  collectionKey: "k",
  token: "t",
  latestRevision: 1,
  keyEpoch: 0,
  manifestSeq: 1,
} as Session;

const sidebar = {
  isDesktop: true,
  collapsed: false,
  open: false,
  toggle: () => undefined,
  close: () => undefined,
  cols: {},
};

function aCalendar(id: string, name: string, overrides: Partial<Calendar> = {}): Calendar {
  return { id, name, color: DEFAULT_CALENDAR_COLOR, raw: "{}", ...overrides };
}

/** Today, so the event lands in the month the view opens on. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function anEvent(id: string, title: string, calendarId: string): CalendarEvent {
  const day = todayKey();
  return {
    id,
    title,
    start: new Date(`${day}T09:00:00Z`).toISOString(),
    end: new Date(`${day}T09:30:00Z`).toISOString(),
    timezone: TIMEZONE,
    calendarId,
    raw: JSON.stringify({ "@type": "CalendarEvent", version: "1.0", title, calendarId }),
  };
}

/**
 * Re-reads the module-level stores on refresh, so a write the view makes shows
 * up in the props the way `App`'s own `refresh` would feed them back.
 */
function Harness() {
  const [, bump] = useState(0);
  return (
    <CalendarView
      session={session}
      calendars={calendars}
      events={events}
      contacts={[]}
      busy={false}
      timezone={TIMEZONE}
      onRefresh={async () => bump((n) => n + 1)}
      sidebar={sidebar}
    />
  );
}

function mount() {
  render(<Harness />);
}

/** The confirm dialogs reuse their action's label, which the calendar dialog behind them also carries. */
function confirmIn(dialog: string, label: string) {
  fireEvent.click(within(screen.getByRole("dialog", { name: dialog })).getByRole("button", { name: label }));
}

beforeEach(() => {
  sessionStorage.clear();
  writes.length = 0;
  calendars = [aCalendar(DEFAULT_CALENDAR_ID, "Calendar")];
  events = [];
});

describe("creating and editing a calendar", () => {
  it("writes the name and colour the dialog was given", async () => {
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Add calendar" }));
    fireEvent.change(await screen.findByPlaceholderText("Personal"), { target: { value: "Work" } });
    fireEvent.click(screen.getByRole("button", { name: "Create calendar" }));

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]).toMatchObject({
      kind: "putCalendar",
      id: undefined,
      draft: { name: "Work", color: DEFAULT_CALENDAR_COLOR, favorite: false, archived: false },
    });
    expect(await screen.findByTitle("Hide Work")).toBeDefined();
  });

  it("carries the stored fields an edit does not touch", async () => {
    calendars = [
      aCalendar(DEFAULT_CALENDAR_ID, "Calendar"),
      aCalendar(WORK_ID, "Work", {
        favorite: true,
        raw: JSON.stringify({ "@type": "Calendar", name: "Work", syncToken: "abc" }),
      }),
    ];
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Edit Work calendar" }));
    fireEvent.change(await screen.findByPlaceholderText("Personal"), { target: { value: "Work, renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(writes.length).toBe(1));
    const write = writes[0]!;
    expect(write).toMatchObject({ kind: "putCalendar", id: WORK_ID });
    // The favourite flag and the carry are not on the dialog, so losing them
    // here would unfavourite the calendar and drop a newer client's fields.
    expect(write.draft!.name).toBe("Work, renamed");
    expect(write.draft!.favorite).toBe(true);
    expect(write.draft!.raw).toContain("syncToken");
  });
});

describe("deleting a calendar", () => {
  beforeEach(() => {
    calendars = [aCalendar(DEFAULT_CALENDAR_ID, "Calendar"), aCalendar(WORK_ID, "Work")];
    events = [
      anEvent("event-1", "Standup", WORK_ID),
      anEvent("event-2", "Retro", WORK_ID),
      anEvent("event-3", "Dentist", DEFAULT_CALENDAR_ID),
    ];
  });

  it("takes its events with it, and them first", async () => {
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Edit Work calendar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete calendar" }));
    confirmIn("Delete calendar", "Delete calendar");

    await waitFor(() => expect(writes.length).toBe(3));
    expect(writes).toEqual([
      { kind: "deleteEvent", id: "event-1" },
      { kind: "deleteEvent", id: "event-2" },
      { kind: "deleteCalendar", id: WORK_ID },
    ]);
    // The other calendar's event is untouched.
    expect(await screen.findByText("Dentist")).toBeDefined();
  });

  it("leaves the calendar in place when only its events are purged", async () => {
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Edit Work calendar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Purge Events" }));
    confirmIn("Purge Events", "Purge Events");

    await waitFor(() => expect(writes.length).toBe(2));
    expect(writes.every((write) => write.kind === "deleteEvent")).toBe(true);
    expect(calendars.some((calendar) => calendar.id === WORK_ID)).toBe(true);
  });

  it("offers no delete for the default calendar", async () => {
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Edit Calendar calendar" }));
    await screen.findByPlaceholderText("Personal");
    expect(screen.queryByRole("button", { name: "Delete calendar" })).toBeNull();
  });
});

describe("archiving a calendar", () => {
  it("is refused while it is the only one in use", () => {
    mount();

    // Disabled rather than left to fail on click, because an account with no
    // calendar in use has nowhere to put a new event.
    const archive = screen.getByRole("button", { name: "Archive Calendar calendar" });
    expect(archive.hasAttribute("disabled")).toBe(true);
    expect(archive.getAttribute("title")).toBe("Your only calendar in use cannot be archived");
  });

  it("writes the flag and takes its events off the grid", async () => {
    calendars = [aCalendar(DEFAULT_CALENDAR_ID, "Calendar"), aCalendar(WORK_ID, "Work")];
    events = [anEvent("event-1", "Standup", WORK_ID), anEvent("event-3", "Dentist", DEFAULT_CALENDAR_ID)];
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Archive Work calendar" }));

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]).toMatchObject({ kind: "putCalendar", id: WORK_ID, draft: { archived: true } });
    await waitFor(() => expect(screen.queryByText("Standup")).toBeNull());
    expect(screen.getByText("Dentist")).toBeDefined();
  });
});

describe("switching a calendar off", () => {
  beforeEach(() => {
    calendars = [aCalendar(DEFAULT_CALENDAR_ID, "Calendar"), aCalendar(WORK_ID, "Work")];
    events = [anEvent("event-1", "Standup", WORK_ID), anEvent("event-3", "Dentist", DEFAULT_CALENDAR_ID)];
  });

  it("hides its events without writing to the vault, and remembers it", async () => {
    mount();

    fireEvent.click(screen.getByTitle("Hide Work"));

    await waitFor(() => expect(screen.queryByText("Standup")).toBeNull());
    expect(screen.getByText("Dentist")).toBeDefined();
    // Visibility is this device's own, so nothing is sealed for it.
    expect(writes).toEqual([]);
    expect(sessionStorage.getItem(`sealbook.${HIDDEN_CALENDARS}.${COLLECTION}`)).toContain(WORK_ID);
  });

  it("brings them all back from Show all calendars", async () => {
    mount();

    fireEvent.click(screen.getByTitle("Hide Work"));
    await waitFor(() => expect(screen.queryByText("Standup")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Show all calendars" }));

    expect(await screen.findByText("Standup")).toBeDefined();
    expect(sessionStorage.getItem(`sealbook.${HIDDEN_CALENDARS}.${COLLECTION}`)).not.toContain(WORK_ID);
  });
});

describe("a repeat that ends on a date", () => {
  function openComposer() {
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
  }

  async function fillRepeatingEvent() {
    fireEvent.change(await screen.findByPlaceholderText("Event title"), { target: { value: "Standup" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Repeat event/u }), { target: { value: "daily" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Repeat until/u }), { target: { value: "date" } });
  }

  it("will not save with no date chosen", async () => {
    mount();
    openComposer();
    await fillRepeatingEvent();

    fireEvent.click(screen.getByRole("button", { name: "Save event" }));

    // Saving anyway would repeat forever, which is not what was asked for.
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Choose the last date the event should repeat on.",
    );
    expect(writes).toEqual([]);
  });

  it("will not save a date before the first occurrence", async () => {
    mount();
    openComposer();
    await fillRepeatingEvent();

    const start = (screen.getByLabelText("Starts") as HTMLInputElement).value.slice(0, 10);
    const before = new Date(`${start}T00:00:00Z`);
    before.setUTCDate(before.getUTCDate() - 1);
    fireEvent.change(screen.getByLabelText("Last date"), {
      target: { value: before.toISOString().slice(0, 10) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));

    // An until before the start hides the event entirely rather than repeating it.
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The repeat end date cannot be before the event start date.",
    );
    expect(writes).toEqual([]);
  });

  it("saves once the date is on or after the start", async () => {
    mount();
    openComposer();
    await fillRepeatingEvent();

    const start = (screen.getByLabelText("Starts") as HTMLInputElement).value.slice(0, 10);
    fireEvent.change(screen.getByLabelText("Last date"), { target: { value: start } });
    fireEvent.click(screen.getByRole("button", { name: "Save event" }));

    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]).toMatchObject({
      kind: "putEvent",
      id: undefined,
      draft: { title: "Standup", recurrence: { frequency: "daily", until: start } },
    });
  });
});

describe("editing one occurrence of a repeating event", () => {
  it("saves against the stored event rather than the generated id", async () => {
    const base = anEvent("event-1", "Standup", DEFAULT_CALENDAR_ID);
    events = [{ ...base, recurrence: { frequency: "daily" } }];
    mount();

    // Every day this month is drawn from the one stored row, so any of them but
    // the first carries a suffixed id.
    const occurrences = screen.getAllByText("Standup");
    expect(occurrences.length).toBeGreaterThan(1);
    fireEvent.click(occurrences[occurrences.length - 1]!);

    fireEvent.change(await screen.findByPlaceholderText("Event title"), { target: { value: "Standup, renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(writes.length).toBe(1));
    // `event-1:<date>` is not a row the vault holds, so a write to it would
    // create a duplicate and leave the series as it was.
    expect(writes[0]!.id).toBe("event-1");
    expect(writes[0]!.draft!.title).toBe("Standup, renamed");
  });
});
