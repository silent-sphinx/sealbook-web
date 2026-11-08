import { MAX_EVENT_ALERTS, alertLabel, alertPresets } from "../lib/calendar";
import type { EventAlert } from "../lib/types";
import { focusRing } from "../lib/styles";
import { Icon } from "./Icon";

export function ReminderField({
  alerts,
  allDay,
  onChange,
}: {
  alerts: EventAlert[];
  allDay: boolean;
  onChange: (value: EventAlert[]) => void;
}) {
  const offered = alertPresets(allDay).filter(
    (minutes) => !alerts.some((alert) => alert.minutesBefore === minutes),
  );
  const full = alerts.length >= MAX_EVENT_ALERTS;

  function add(minutesBefore: number) {
    const next = [...alerts, { minutesBefore }];
    next.sort((a, b) => b.minutesBefore - a.minutesBefore);
    onChange(next);
  }

  return (
    <div role="group" aria-label="Reminders" className="flex min-h-10 w-full flex-wrap items-center gap-1.5 py-2">
      {alerts.map((alert) => {
        const label = alertLabel(alert, allDay);
        return (
          <span key={alert.minutesBefore} className="flex items-center gap-1 rounded-full bg-surface py-1 pl-2.5 pr-1.5 text-xs text-text">
            {label}
            <button
              type="button"
              onClick={() => onChange(alerts.filter((other) => other !== alert))}
              className={`relative flex h-4 w-4 items-center justify-center rounded-full text-mute transition-colors hover:bg-elevated hover:text-text hit-area ${focusRing}`}
              aria-label={`Remove reminder ${label}`}
            >
              <Icon name="close" className="h-2.5 w-2.5" />
            </button>
          </span>
        );
      })}
      {!full && offered.length > 0 ? (
        <select
          aria-label="Add reminder"
          value=""
          onChange={(e) => {
            if (e.target.value !== "") add(Number(e.target.value));
          }}
          className="row-select h-7 min-w-24 flex-1 cursor-pointer bg-transparent text-sm text-mute outline-none transition-colors hover:text-text focus-visible:text-text"
        >
          <option value="">{alerts.length === 0 ? "Add reminder" : "Add another"}</option>
          {offered.map((minutes) => (
            <option key={minutes} value={minutes}>
              {alertLabel({ minutesBefore: minutes }, allDay)}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
