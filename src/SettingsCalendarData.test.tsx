// @vitest-environment jsdom
/**
 * The calendar import and export in `SettingsView`.
 *
 * The import is all-or-nothing by hand rather than by a server transaction:
 * the events go up in batches of 256 and a failure part way has to take the
 * rows already written, and a calendar created for them, back out. That
 * rollback is what is covered here, alongside the guards that refuse a file
 * before anything is written at all.
 *
 * `parseCalendarImport` and `formatIcs` run for real, so what reaches
 * `putCalendarEvents` is what the ICS actually said.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import { aDeviceState } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_CALENDAR_ID } from "./lib/calendar";
import { DEFAULT_CALENDAR_COLOR } from "./lib/types";
import type { Calendar, CalendarEvent } from "./lib/types";
import type { Session } from "./lib/client";

type Draft = Omit<CalendarEvent, "id">;

const putCalendar = vi.hoisted(() =>
  vi.fn<(session: Session, draft: { name: string; color: string }) => Promise<string>>(),
);
const putCalendarEvents = vi.hoisted(() =>
  vi.fn<(session: Session, batch: Draft[]) => Promise<string[]>>(),
);
const deleteCalendar = vi.hoisted(() => vi.fn<(session: Session, id: string) => Promise<void>>());
const deleteCalendarEvent = vi.hoisted(() => vi.fn<(session: Session, id: string) => Promise<void>>());
const triggerDownload = vi.hoisted(() => vi.fn<(filename: string, mime: string, data: string) => void>());

vi.mock("./lib/client", async () => {
  const actual = await vi.importActual<typeof import("./lib/client")>("./lib/client");
  return {
    ...actual,
    listDevices: async () => [],
    putCalendar,
    putCalendarEvents,
    deleteCalendar,
    deleteCalendarEvent,
  };
});

vi.mock("./lib/importExport", async () => {
  const actual = await vi.importActual<typeof import("./lib/importExport")>("./lib/importExport");
  return { ...actual, triggerDownload };
});

import { SettingsView } from "./components/SettingsView";

const WORK_ID = "calendar-work";

const session = {
  state: aDeviceState({ username: "ada" }),
  collectionKey: "k",
  token: "t",
  latestRevision: 1,
  keyEpoch: 0,
  manifestSeq: 1,
} as Session;

const calendars: Calendar[] = [
  { id: DEFAULT_CALENDAR_ID, name: "Calendar", color: DEFAULT_CALENDAR_COLOR, raw: "{}" },
  { id: WORK_ID, name: "Work", color: DEFAULT_CALENDAR_COLOR, raw: "{}" },
];

function anEvent(id: string, title: string, calendarId: string): CalendarEvent {
  return {
    id,
    title,
    start: "2026-03-04T09:00:00.000Z",
    end: "2026-03-04T09:30:00.000Z",
    timezone: "Europe/London",
    calendarId,
    raw: JSON.stringify({ "@type": "CalendarEvent", version: "1.0", title }),
  };
}

const onRefresh = vi.fn<() => Promise<void>>();

function mount(events: CalendarEvent[] = []) {
  const view = render(
    <SettingsView
      session={session}
      contacts={[]}
      addressBooks={[]}
      calendars={calendars}
      calendarEvents={events}
      notes={[]}
      notebooks={[]}
      bookmarks={[]}
      bookmarkCollections={[]}
      tasks={[]}
      taskLists={[]}
      onSessionUpdate={() => undefined}
      onPersistSession={async () => undefined}
      onAccountDeleted={() => undefined}
      onSignOut={() => undefined}
      onRefresh={onRefresh}
      timezone="Europe/London"
      onTimezoneChange={() => undefined}
      accountSettings={DEFAULT_ACCOUNT_SETTINGS}
      onSaveAccountSettings={async () => undefined}
      initialSection="calendar"
    />,
  );
  return view.container.querySelector('input[type="file"]') as HTMLInputElement;
}

function ics(...events: { uid: string; summary: string }[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    ...events.flatMap((event) => [
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `SUMMARY:${event.summary}`,
      "DTSTART:20260304T090000Z",
      "DTEND:20260304T093000Z",
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
}

/** jsdom reads a real `File` through `FileReader`, which is how the view takes one. */
async function pick(input: HTMLInputElement, name: string, body: string) {
  Object.defineProperty(input, "files", {
    value: [new File([body], name, { type: "text/calendar" })],
    configurable: true,
  });
  fireEvent.change(input);
}

beforeEach(() => {
  vi.clearAllMocks();
  onRefresh.mockResolvedValue(undefined);
});

describe("reading the file before anything is written", () => {
  // jsdom does not enforce `accept`, so only the attribute itself can be checked.
  it("offers the iCalendar extensions the file dialog would otherwise hide", () => {
    const accept = mount().accept.split(",");

    expect(accept).toContain(".ics");
    expect(accept).toContain(".ical");
  });

  it("takes an .ical file", async () => {
    const input = mount();
    await pick(input, "moons.ical", ics({ uid: "a", summary: "Full Moon" }));

    expect(await screen.findByText(/Detected ICS · 1 event found/u)).toBeDefined();
    expect(screen.getByText("Full Moon")).toBeDefined();
  });

  it("reports what it holds and writes nothing yet", async () => {
    const input = mount();
    await pick(input, "work.ics", ics({ uid: "a", summary: "Standup" }, { uid: "b", summary: "Retro" }));

    expect(await screen.findByText(/Detected ICS · 2 events found/u)).toBeDefined();
    expect(screen.getByText("Standup")).toBeDefined();
    expect(putCalendarEvents).not.toHaveBeenCalled();
  });

  it("refuses a file with no events in it", async () => {
    const input = mount();
    await pick(input, "notes.txt", "this is not a calendar");

    expect(
      await screen.findByText(/No calendar events could be parsed from "notes\.txt"/u),
    ).toBeDefined();
    // Still on the dropzone, so the only way on is another file.
    expect(screen.getByRole("button", { name: /calendar file to import/iu })).toBeDefined();
  });

  it("refuses an empty file by name", async () => {
    const input = mount();
    await pick(input, "empty.ics", "   ");

    expect(await screen.findByText('File "empty.ics" is empty.')).toBeDefined();
  });

  it("refuses one over the size ceiling without reading it", async () => {
    const input = mount();
    const big = new File(["x"], "huge.ics", { type: "text/calendar" });
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 + 1 });
    Object.defineProperty(input, "files", { value: [big], configurable: true });
    fireEvent.change(input);

    expect(await screen.findByText("Calendar files must be 5 MB or smaller.")).toBeDefined();
  });
});

describe("importing into an existing calendar", () => {
  it("writes every event against the calendar that was chosen", async () => {
    putCalendarEvents.mockResolvedValue(["event-1", "event-2"]);
    const input = mount();
    await pick(input, "work.ics", ics({ uid: "a", summary: "Standup" }, { uid: "b", summary: "Retro" }));
    await screen.findByText(/2 events found/u);

    fireEvent.change(screen.getByLabelText("Target Calendar"), { target: { value: WORK_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Import 2 Events" }));

    await waitFor(() => expect(putCalendarEvents).toHaveBeenCalledTimes(1));
    const batch = putCalendarEvents.mock.calls[0]![1];
    expect(batch.map((event) => event.title)).toEqual(["Standup", "Retro"]);
    expect(batch.every((event) => event.calendarId === WORK_ID)).toBe(true);
    expect(await screen.findByText(/Successfully imported 2 events into "Work"\./u)).toBeDefined();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // The picker is back, so the same file cannot be imported twice by accident.
    expect(screen.getByRole("button", { name: /calendar file to import/iu })).toBeDefined();
  });

  it("deletes the rows it had written when the import fails", async () => {
    putCalendarEvents.mockRejectedValue(new Error("rate limited"));
    const input = mount();
    await pick(input, "work.ics", ics({ uid: "a", summary: "Standup" }));
    await screen.findByText(/1 event found/u);

    fireEvent.click(screen.getByRole("button", { name: "Import 1 Event" }));

    expect(await screen.findByText(/Import failed: Too many tries\. Wait a moment\./u)).toBeDefined();
    // Nothing was written, so there is nothing to take back out.
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
    expect(deleteCalendar).not.toHaveBeenCalled();
    // The file stays picked, so a retry does not need choosing again.
    expect(screen.getByRole("button", { name: "Import 1 Event" })).toBeDefined();
  });
});

describe("importing into a calendar created for the file", () => {
  it("creates it first and writes the events into it", async () => {
    putCalendar.mockResolvedValue("calendar-new");
    putCalendarEvents.mockResolvedValue(["event-1"]);
    const input = mount();
    await pick(input, "trips.ics", ics({ uid: "a", summary: "Flight" }));
    await screen.findByText(/1 event found/u);

    fireEvent.click(screen.getByRole("button", { name: "+ Create new calendar" }));
    fireEvent.change(screen.getByLabelText("Target Calendar"), { target: { value: "Travel" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 1 Event" }));

    await waitFor(() => expect(putCalendarEvents).toHaveBeenCalledTimes(1));
    expect(putCalendar).toHaveBeenCalledWith(session, { name: "Travel", color: DEFAULT_CALENDAR_COLOR });
    const batch = putCalendarEvents.mock.calls[0]![1];
    expect(batch[0]!.calendarId).toBe("calendar-new");
    expect(await screen.findByText(/Successfully imported 1 event into "Travel"\./u)).toBeDefined();
  });

  it("takes the calendar and the events back out when a batch fails", async () => {
    putCalendar.mockResolvedValue("calendar-new");
    putCalendarEvents
      .mockResolvedValueOnce(Array.from({ length: 256 }, (_, index) => `event-${index}`))
      .mockRejectedValueOnce(new Error("rate limited"));
    const input = mount();
    const many = Array.from({ length: 300 }, (_, index) => ({ uid: `u${index}`, summary: `Event ${index}` }));
    await pick(input, "many.ics", ics(...many));
    await screen.findByText(/300 events found/u);

    fireEvent.click(screen.getByRole("button", { name: "+ Create new calendar" }));
    fireEvent.change(screen.getByLabelText("Target Calendar"), { target: { value: "Travel" } });
    fireEvent.click(screen.getByRole("button", { name: "Import 300 Events" }));

    await waitFor(() => expect(screen.getByText(/Import failed/u)).toBeDefined());
    // The first batch did land, so a half-imported calendar is what the
    // rollback exists to prevent.
    expect(deleteCalendarEvent).toHaveBeenCalledTimes(256);
    expect(deleteCalendar).toHaveBeenCalledWith(session, "calendar-new");
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("exporting", () => {
  it("writes the chosen calendar's events as ICS", async () => {
    mount([anEvent("event-1", "Standup", WORK_ID), anEvent("event-2", "Dentist", DEFAULT_CALENDAR_ID)]);

    fireEvent.change(screen.getByLabelText("Source Calendar"), { target: { value: WORK_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Export 1 Event" }));

    await waitFor(() => expect(triggerDownload).toHaveBeenCalledTimes(1));
    const [filename, mime, body] = triggerDownload.mock.calls[0]!;
    expect(filename).toMatch(/^work-\d{4}-\d{2}-\d{2}\.ics$/u);
    expect(mime).toContain("text/calendar");
    expect(body).toContain("SUMMARY:Standup");
    expect(body).not.toContain("SUMMARY:Dentist");
  });

  it("writes every calendar's events as JSON when asked for one", async () => {
    mount([anEvent("event-1", "Standup", WORK_ID), anEvent("event-2", "Dentist", DEFAULT_CALENDAR_ID)]);

    fireEvent.change(screen.getByLabelText("Export Format"), { target: { value: "json" } });
    fireEvent.click(screen.getByRole("button", { name: "Export 2 Events" }));

    await waitFor(() => expect(triggerDownload).toHaveBeenCalledTimes(1));
    const [filename, mime, body] = triggerDownload.mock.calls[0]!;
    expect(filename).toMatch(/^sealbook-\d{4}-\d{2}-\d{2}\.json$/u);
    expect(mime).toBe("application/json");
    // Lossless, so the stored ids and the carry are in the file.
    expect(JSON.parse(body).map((event: CalendarEvent) => event.id)).toEqual(["event-1", "event-2"]);
  });

  it("offers no export when the calendar chosen is empty", () => {
    mount([anEvent("event-1", "Standup", WORK_ID)]);

    fireEvent.change(screen.getByLabelText("Source Calendar"), { target: { value: DEFAULT_CALENDAR_ID } });

    expect(screen.getByRole("button", { name: "Export 0 Events" }).hasAttribute("disabled")).toBe(true);
    expect(triggerDownload).not.toHaveBeenCalled();
  });
});
