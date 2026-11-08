// @vitest-environment jsdom
/**
 * Editing a stored calendar event, mounted over a faked `putSealed`.
 *
 * The regression is silent and permanent: `saveEvent` built its payload
 * without `raw`, so `mergePayload` carried nothing and every field a newer
 * client had written was dropped the first time this build saved the event.
 * `putSealed` is the recorder rather than `putCalendarEvent`, so the real
 * merge runs and the assertion is on the plaintext that would be sealed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "./test/dom";
import { aDeviceState } from "./test/vault";
import { DEFAULT_CALENDAR_ID, parseEvent } from "./lib/calendar";
import { DEFAULT_CALENDAR_COLOR } from "./lib/types";
import type { Calendar, CalendarEvent } from "./lib/types";
import type { Session } from "./lib/client";

const writes: { id: string; payload: string }[] = [];

// Held open by a test that needs the write still in flight while it asserts.
let gate: Promise<void> | null = null;

// Faked a layer below `lib/client`, because `putCalendarEvent` reaches
// `putSealed` through the client module rather than taking it as an argument.
vi.mock("./lib/clientFlush", async () => {
  const actual = await vi.importActual<typeof import("./lib/clientFlush")>("./lib/clientFlush");
  return {
    ...actual,
    putSealed: async (_session: unknown, id: string, _contentType: string, _tombstone: boolean, payload: string) => {
      if (gate) await gate;
      writes.push({ id, payload });
      return 1;
    },
  };
});

import { CalendarView } from "./components/CalendarView";

const TIMEZONE = "Europe/London";

const session = {
  state: aDeviceState(),
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

const calendar: Calendar = {
  id: DEFAULT_CALENDAR_ID,
  name: "Calendar",
  color: DEFAULT_CALENDAR_COLOR,
  raw: "{}",
};

/**
 * `attendeeStatus` stands in for the newer client's field: unknown to
 * `CALENDAR_EVENT_KEYS`, so only the carry keeps it.
 */
function anEvent(): CalendarEvent {
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const start = new Date(`${day}T09:00:00Z`).toISOString();
  return {
    id: "event-1",
    title: "Standup",
    start,
    end: new Date(`${day}T09:30:00Z`).toISOString(),
    timezone: TIMEZONE,
    calendarId: DEFAULT_CALENDAR_ID,
    raw: JSON.stringify({
      "@type": "CalendarEvent",
      version: "1.0",
      title: "Standup",
      start,
      timezone: TIMEZONE,
      calendarId: DEFAULT_CALENDAR_ID,
      attendeeStatus: { ada: "accepted" },
    }),
  };
}

function mount(events: CalendarEvent[], onRefresh: () => Promise<void> = async () => undefined) {
  render(
    <CalendarView
      session={session}
      calendars={[calendar]}
      events={events}
      contacts={[]}
      busy={false}
      timezone={TIMEZONE}
      onRefresh={onRefresh}
      sidebar={sidebar}
    />,
  );
}

/** A promise with its resolve, for holding one step of a save open. */
function held() {
  let release = () => undefined as void;
  const promise = new Promise<void>((resolve) => { release = () => resolve(); });
  return { promise, release: () => release() };
}

beforeEach(() => {
  writes.length = 0;
  gate = null;
});

describe("saving an event that was opened for editing", () => {
  it("carries the fields this build does not own", async () => {
    mount([anEvent()]);

    fireEvent.click(screen.getByText("Standup"));
    fireEvent.change(await screen.findByPlaceholderText("Event title"), { target: { value: "Standup, moved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(writes.length).toBe(1));
    const write = writes[0]!;
    expect(write.id).toBe("event-1");
    const payload = JSON.parse(write.payload) as Record<string, unknown>;
    expect(payload.title).toBe("Standup, moved");
    expect(payload.attendeeStatus).toEqual({ ada: "accepted" });
  });

  /**
   * A rule naming a frequency core cannot expand reads as no rule, so the
   * composer opens on "Does not repeat" and rebuilds the event without one.
   * Only the carry keeps it, and without it one edit here turned a series
   * written by a newer client into a single event on every device.
   */
  it("carries a repeat rule core cannot name", async () => {
    const event = anEvent();
    const raw = JSON.stringify({
      ...(JSON.parse(event.raw!) as Record<string, unknown>),
      recurrence: { frequency: "hourly", interval: 3 },
    });
    mount([{ ...parseEvent("event-1", raw), id: "event-1" }]);

    fireEvent.click(screen.getByText("Standup"));
    fireEvent.change(await screen.findByPlaceholderText("Event title"), { target: { value: "Standup, moved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(writes.length).toBe(1));
    const payload = JSON.parse(writes[0]!.payload) as Record<string, unknown>;
    expect(payload.title).toBe("Standup, moved");
    expect(payload.recurrence).toEqual({ frequency: "hourly", interval: 3 });
  });
});

describe("reminders", () => {
  it("are added and removed in the dialog and written with the event", async () => {
    const event = anEvent();
    const raw = JSON.stringify({
      ...(JSON.parse(event.raw!) as Record<string, unknown>),
      alerts: [{ minutesBefore: 10 }, { at: "from a later build" }],
    });
    mount([{ ...parseEvent("event-1", raw), id: "event-1" }]);

    fireEvent.click(screen.getByText("Standup"));
    await screen.findByPlaceholderText("Event title");
    fireEvent.click(screen.getByRole("button", { name: "Remove reminder 10 minutes before" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Add reminder" }), { target: { value: "1440" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Add reminder" }), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(writes.length).toBe(1));
    const payload = JSON.parse(writes[0]!.payload) as Record<string, unknown>;
    expect(payload.alerts).toEqual([{ minutesBefore: 1440 }, { minutesBefore: 15 }, { at: "from a later build" }]);
  });

  it("keep their days before, at 09:00, when the event becomes all-day", async () => {
    const event = anEvent();
    const raw = JSON.stringify({
      ...(JSON.parse(event.raw!) as Record<string, unknown>),
      alerts: [{ minutesBefore: 1440 }],
    });
    mount([{ ...parseEvent("event-1", raw), id: "event-1" }]);

    fireEvent.click(screen.getByText("Standup"));
    await screen.findByPlaceholderText("Event title");
    fireEvent.click(screen.getByRole("switch", { name: "All day" }));
    expect(screen.getByRole("button", { name: "Remove reminder 1 day before at 09:00" })).toBeTruthy();
  });
});

describe("while the save is in flight", () => {
  it("reports the save on the button and takes no second submit", async () => {
    const write = held();
    gate = write.promise;
    mount([anEvent()]);

    fireEvent.click(screen.getByText("Standup"));
    fireEvent.change(await screen.findByPlaceholderText("Event title"), { target: { value: "Standup, moved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const saving = await screen.findByRole("button", { name: "Saving\u2026" });
    expect(saving.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Delete" }).hasAttribute("disabled")).toBe(true);

    // The second click is what would otherwise write the event twice.
    fireEvent.click(saving);
    write.release();

    await waitFor(() => expect(screen.queryByPlaceholderText("Event title")).toBeNull());
    expect(writes.length).toBe(1);
  });

  /**
   * The write is the cheap half: the refresh behind it walks the vault. Closing
   * on the write took the dialog down before the button had been painted, so
   * the save looked instant and the wait came after it with nothing on screen.
   */
  it("holds the dialog open until the refresh behind the write is done", async () => {
    const refresh = held();
    mount([anEvent()], () => refresh.promise);

    fireEvent.click(screen.getByText("Standup"));
    fireEvent.change(await screen.findByPlaceholderText("Event title"), { target: { value: "Standup, moved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(writes.length).toBe(1));
    expect(screen.getByRole("button", { name: "Saving\u2026" })).toBeTruthy();

    refresh.release();
    await waitFor(() => expect(screen.queryByPlaceholderText("Event title")).toBeNull());
  });
});
