// @vitest-environment jsdom
/**
 * The calendar's event form, mounted on its own with `lib/client` faked, as
 * in the other view suites. Assertions are made against what the fake was
 * asked to write.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../test/dom";
import { DEFAULT_CALENDAR_ID, parseCalendar, parseEvent, serializeCalendar } from "../lib/calendar";
import { keyFor } from "../lib/calendarModel";
import { useSidebar } from "./SidebarDrawer";
import type { Session } from "../lib/client";
import type { CalendarEvent } from "../lib/types";

let writes: Omit<CalendarEvent, "id">[] = [];

vi.mock("../lib/client", async () => {
  const actual = await vi.importActual<typeof import("../lib/client")>("../lib/client");
  return {
    ...actual,
    putCalendarEvent: async (_session: unknown, event: Omit<CalendarEvent, "id">) => {
      writes.push(event);
    },
  };
});

const { CalendarView } = await import("./CalendarView");

const SESSION = { state: { username: "ada" } } as unknown as Session;
const CALENDAR = parseCalendar(DEFAULT_CALENDAR_ID, serializeCalendar({ name: "Home", color: "#7aa2f7" }));
const today = keyFor(new Date());
const weekday = new Date(`${today}T00:00`).getDay();

/** A rule the form's shortcuts cannot show: two weekdays, a count, and a key from a newer build. */
const stored = parseEvent(
  "e1",
  JSON.stringify({
    "@type": "Event",
    title: "Swim",
    start: today,
    end: today,
    calendarId: DEFAULT_CALENDAR_ID,
    recurrence: { frequency: "weekly", weekdays: [weekday, (weekday + 2) % 7].sort(), count: 5, futureRule: 1 },
  }),
);

function Harness() {
  const sidebar = useSidebar();
  return (
    <CalendarView
      session={SESSION}
      calendars={[CALENDAR]}
      events={[stored]}
      contacts={[]}
      busy={false}
      timezone="UTC"
      onRefresh={async () => undefined}
      sidebar={sidebar}
    />
  );
}

afterEach(() => {
  writes = [];
});

describe("editing an event", () => {
  it("writes back a repeat rule the user did not touch, as it was stored", async () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByText("Swim")[0]!);
    fireEvent.change(await screen.findByPlaceholderText("Event title"), { target: { value: "Swim, pool" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.title).toBe("Swim, pool");
    expect(writes[0]!.recurrence).toEqual(stored.recurrence);
    expect(writes[0]!.recurrence?.extra).toBe('{"futureRule":1}');
  });

  it("rebuilds the rule once the repeat choice changes", async () => {
    render(<Harness />);
    fireEvent.click(screen.getAllByText("Swim")[0]!);
    const repeat = (await screen.findAllByRole("combobox")).find((select) =>
      Array.from((select as HTMLSelectElement).options).some((option) => option.value === "daily"),
    )!;
    fireEvent.change(repeat, { target: { value: "daily" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.recurrence).toEqual({ frequency: "daily", count: 5 });
  });
});

describe("the sidebar title", () => {
  it("goes back to this month, with nothing filtered and out of the trash", () => {
    render(<Harness />);
    const heading = () => screen.getByRole("heading", { level: 1 }).textContent;
    const search = () => screen.getByPlaceholderText("Search events") as HTMLInputElement;
    const thisMonth = heading();

    fireEvent.click(screen.getByRole("radio", { name: "year" }));
    fireEvent.click(screen.getByRole("button", { name: "Next year" }));
    expect(heading()).not.toBe(thisMonth);
    fireEvent.change(search(), { target: { value: "zebra" } });
    fireEvent.click(screen.getByRole("button", { name: /^Trash/ }));
    expect(screen.getByRole("region", { name: "Trash" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));

    expect(screen.queryByRole("region", { name: "Trash" })).toBeNull();
    expect(screen.getByRole("radio", { name: "month" }).getAttribute("aria-checked")).toBe("true");
    expect(heading()).toBe(thisMonth);
    expect(search().value).toBe("");
  });
});
