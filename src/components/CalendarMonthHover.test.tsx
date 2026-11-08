// @vitest-environment jsdom
/**
 * The month grid's overflow line and the day card a hovered event opens.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "../test/dom";
import { DEFAULT_CALENDAR_ID, parseCalendar, serializeCalendar } from "../lib/calendar";
import { computeSpan, keyFor, monthDays } from "../lib/calendarModel";
import { MonthGrid } from "./CalendarViews";
import type { CalendarEvent } from "../lib/types";

const CALENDAR = parseCalendar(DEFAULT_CALENDAR_ID, serializeCalendar({ name: "Home", color: "#7aa2f7" }));
const MONTH = new Date(2026, 10, 1);
const DAY = "2026-11-08";

const EVENTS: CalendarEvent[] = Array.from({ length: 6 }, (_, index) => ({
  id: `e${index}`,
  title: `Event ${index}`,
  start: `${DAY}T${String(9 + index).padStart(2, "0")}:00:00.000Z`,
  end: `${DAY}T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
  calendarId: DEFAULT_CALENDAR_ID,
  timezone: "UTC",
})) as CalendarEvent[];

function mount(onEdit = vi.fn()) {
  const spans = new Map(EVENTS.map((event) => [event.id, computeSpan(event, "UTC")]));
  render(
    <MonthGrid
      month={MONTH}
      days={monthDays(MONTH, 0)}
      weekStart={0}
      selected=""
      todayKey={keyFor(new Date(2000, 0, 1))}
      events={EVENTS}
      spans={spans}
      calendars={[CALENDAR]}
      onSelect={() => undefined}
      onAdd={() => undefined}
      onEdit={onEdit}
    />,
  );
  return onEdit;
}

function hover(element: Element) {
  fireEvent.pointerEnter(element, { pointerType: "mouse" });
  act(() => { vi.advanceTimersByTime(400); });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("month grid day card", () => {
  it("keeps the cell to four lines, the last saying how many are hidden", () => {
    mount();
    expect(screen.getByText("Event 2")).toBeTruthy();
    expect(screen.queryByText("Event 3")).toBeNull();
    expect(screen.getByText("+3 more")).toBeTruthy();
  });

  it("lists every event of the day when one is hovered, and edits the one clicked", () => {
    vi.useFakeTimers();
    const onEdit = mount();
    hover(screen.getByText("Event 0"));
    const card = screen.getByRole("dialog", { name: /November 8/ });
    expect(within(card).getAllByRole("button").map((row) => row.textContent)).toEqual(EVENTS.map((event) => expect.stringContaining(event.title)));
    fireEvent.click(within(card).getByText("Event 5"));
    expect(onEdit).toHaveBeenCalledWith(EVENTS[5]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens from the overflow line and closes once the pointer leaves", () => {
    vi.useFakeTimers();
    mount();
    const more = screen.getByText("+3 more");
    hover(more);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.pointerLeave(more, { pointerType: "mouse" });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores touch, where a tap already opens the event", () => {
    vi.useFakeTimers();
    mount();
    fireEvent.pointerEnter(screen.getByText("Event 0"), { pointerType: "touch" });
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
