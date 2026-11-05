import { MAX_EVENT_ALERTS, alertLabel, alertPresets } from "../lib/calendar";
import type { EventAlert } from "../lib/types";

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
    <div className="block text-[11px] font-medium text-mute">
      Reminders
      <div className="mt-1 flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-line bg-bg px-2 py-1.5 focus-within:border-accent">
        {alerts.map((alert) => {
          const label = alertLabel(alert, allDay);
          return (
            <span key={alert.minutesBefore} className="flex items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-[11px] text-text">
              {label}
              <button
                type="button"
                onClick={() => onChange(alerts.filter((other) => other !== alert))}
                className="text-mute hover:text-text"
                aria-label={`Remove reminder ${label}`}
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="m4 4 8 8M12 4l-8 8" /></svg>
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
            className="h-6 min-w-24 flex-1 bg-transparent text-xs text-text outline-none"
          >
            <option value="">{alerts.length === 0 ? "No reminders - add one" : "Add another"}</option>
            {offered.map((minutes) => (
              <option key={minutes} value={minutes}>
                {alertLabel({ minutesBefore: minutes }, allDay)}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}
