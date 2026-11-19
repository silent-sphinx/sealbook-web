// @vitest-environment jsdom
/**
 * The phone month: days carry only colour dots and the selected day's entries
 * are listed underneath.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "../test/dom";
import { DEFAULT_CALENDAR_ID, parseCalendar, serializeCalendar } from "../lib/calendar";
import { computeSpan, keyFor, monthDays } from "../lib/calendarModel";
import { PhoneMonth } from "./CalendarViews";
import type { CalendarEvent } from "../lib/types";

const CALENDAR = parseCalendar(DEFAULT_CALENDAR_ID, serializeCalendar({ name: "Home", color: "#7aa2f7" }));
const MONTH = new Date(2026, 10, 1);

const EVENT = {
  id: "standup",
  title: "Standup",
  start: "2026-11-08T09:00:00.000Z",
  end: "2026-11-08T09:30:00.000Z",
  calendarId: DEFAULT_CALENDAR_ID,
  timezone: "UTC",
} as CalendarEvent;

function mount(selected: string, onEdit = vi.fn(), onSelect = vi.fn()) {
  render(
    <PhoneMonth
      month={MONTH}
      days={monthDays(MONTH, 0)}
      weekStart={0}
      selected={selected}
      todayKey={keyFor(new Date(2000, 0, 1))}
      events={[EVENT]}
      spans={new Map([[EVENT.id, computeSpan(EVENT, "UTC")]])}
      calendars={[CALENDAR]}
      onSelect={onSelect}
      onEdit={onEdit}
    />,
  );
  return { onEdit, onSelect };
}

afterEach(cleanup);

describe("PhoneMonth", () => {
  it("lists the selected day's events in the agenda and opens one on tap", () => {
    const { onEdit } = mount("2026-11-08");
    const agenda = screen.getByRole("list", { name: "Agenda" });
    fireEvent.click(within(agenda).getByRole("button", { name: /Standup/ }));
    expect(onEdit).toHaveBeenCalledWith(EVENT);
  });

  it("says so when the selected day is empty", () => {
    mount("2026-11-09");
    expect(screen.getByText("Nothing planned")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Standup/ })).toBeNull();
  });

  it("selects a day from the grid and marks the current one", () => {
    const { onSelect } = mount("2026-11-08");
    const days = screen.getAllByRole("button", { pressed: true });
    expect(days).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^Monday.*\b9\b/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
