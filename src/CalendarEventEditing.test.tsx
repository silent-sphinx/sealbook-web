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
import { DEFAULT_CALENDAR_ID } from "./lib/calendar";
import { DEFAULT_CALENDAR_COLOR } from "./lib/types";
import type { Calendar, CalendarEvent } from "./lib/types";
import type { Session } from "./lib/client";

const writes: { id: string; payload: string }[] = [];

// Faked a layer below `lib/client`, because `putCalendarEvent` reaches
// `putSealed` through the client module rather than taking it as an argument.
vi.mock("./lib/clientVault", async () => {
  const actual = await vi.importActual<typeof import("./lib/clientVault")>("./lib/clientVault");
  return {
    ...actual,
    putSealed: async (_session: unknown, id: string, _contentType: string, _tombstone: boolean, payload: string) => {
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

function mount(events: CalendarEvent[]) {
  render(
    <CalendarView
      session={session}
      calendars={[calendar]}
      events={events}
      contacts={[]}
      busy={false}
      timezone={TIMEZONE}
      onRefresh={async () => undefined}
      sidebar={sidebar}
    />,
  );
}

beforeEach(() => {
  writes.length = 0;
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
});
