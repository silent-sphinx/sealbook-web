// @vitest-environment jsdom
/** The bulk event editor on the Calendar settings page. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "./test/dom";
import { aDeviceState } from "./test/vault";
import { DEFAULT_ACCOUNT_SETTINGS } from "./lib/accountSettings";
import { DEFAULT_CALENDAR_COLOR } from "./lib/types";
import type { Calendar, CalendarEvent } from "./lib/types";
import type { Session } from "./lib/client";

const updateCalendarEvents = vi.hoisted(() =>
  vi.fn<(session: Session, events: CalendarEvent[]) => Promise<void>>(),
);
const deleteCalendarEvents = vi.hoisted(() => vi.fn<(session: Session, ids: string[]) => Promise<void>>());

vi.mock("./lib/client", async () => {
  const actual = await vi.importActual<typeof import("./lib/client")>("./lib/client");
  return { ...actual, listDevices: async () => [], updateCalendarEvents, deleteCalendarEvents };
});

import { SettingsHarness } from "./test/settings";

const session = {
  state: aDeviceState({ username: "ada" }),
  collectionKey: "k",
  token: "t",
  latestRevision: 1,
  keyEpoch: 0,
  manifestSeq: 1,
} as Session;

const calendars: Calendar[] = [
  { id: "work", name: "Work", color: DEFAULT_CALENDAR_COLOR, raw: "{}" },
  { id: "holidays", name: "Holidays", color: "#22c55e", raw: "{}" },
];

function anEvent(id: string, title: string, start: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, start, calendarId: "work", raw: `{"title":"${title}","x-keep":1}`, ...extra };
}

const events = [
  anEvent("a", "HOL - Paris", "2026-07-01"),
  anEvent("b", "HOL - Rome", "2026-08-01"),
  anEvent("c", "Standup", "2026-07-02"),
  anEvent("d", "HOL - Future", "2026-09-01", { readable: false }),
];

const onRefresh = vi.fn<() => Promise<void>>();

function mount() {
  render(
    <SettingsHarness
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
      weekStart={1}
      onWeekStartChange={() => undefined}
      autoLockMinutes={15}
      onAutoLockMinutesChange={() => undefined}
      accountSettings={DEFAULT_ACCOUNT_SETTINGS}
      onSaveAccountSettings={async () => undefined}
      initialSection="calendar"
    />,
  );
}

function search(text: string) {
  fireEvent.change(screen.getByLabelText("Text"), { target: { value: text } });
}

beforeEach(() => {
  updateCalendarEvents.mockReset().mockResolvedValue();
  deleteCalendarEvents.mockReset().mockResolvedValue();
  onRefresh.mockReset().mockResolvedValue();
});

describe("Bulk edit events", () => {
  it("lists only readable matches", () => {
    mount();
    search("hol -");
    const list = screen.getByRole("list", { name: "Matching events" });
    expect(within(list).getAllByRole("checkbox")).toHaveLength(2);
    expect(list.textContent).toContain("Paris");
    expect(list.textContent).not.toContain("Standup");
    expect(screen.getByText(/1 from a newer app version left out/)).toBeTruthy();
  });

  it("strips the prefix and moves the selection, keeping unknown keys", async () => {
    mount();
    search("HOL - ");
    fireEvent.change(screen.getByLabelText("Titles"), { target: { value: "strip" } });
    fireEvent.change(screen.getByLabelText("Calendar"), { target: { value: "holidays" } });
    fireEvent.click(screen.getByRole("button", { name: "Update 2 events" }));

    await waitFor(() => expect(updateCalendarEvents).toHaveBeenCalledTimes(1));
    const written = updateCalendarEvents.mock.calls[0][1];
    expect(written.map(({ id, title, calendarId }) => ({ id, title, calendarId }))).toEqual([
      { id: "a", title: "Paris", calendarId: "holidays" },
      { id: "b", title: "Rome", calendarId: "holidays" },
    ]);
    expect(written[0].raw).toContain("x-keep");
    await waitFor(() => expect(screen.getByText("Updated 2 events.")).toBeTruthy());
    expect(onRefresh).toHaveBeenCalled();
  });

  it("leaves out an unticked event", async () => {
    mount();
    search("HOL");
    fireEvent.change(screen.getByLabelText("Titles"), { target: { value: "strip" } });
    const list = screen.getByRole("list", { name: "Matching events" });
    fireEvent.click(within(list).getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Update 1 event" }));

    await waitFor(() => expect(updateCalendarEvents).toHaveBeenCalledTimes(1));
    expect(updateCalendarEvents.mock.calls[0][1].map((event) => event.id)).toEqual(["a"]);
  });

  it("deletes the selection after confirming", async () => {
    mount();
    search("HOL");
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 events" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete 2 events" }));

    await waitFor(() => expect(deleteCalendarEvents).toHaveBeenCalledWith(session, ["a", "b"]));
  });
});
