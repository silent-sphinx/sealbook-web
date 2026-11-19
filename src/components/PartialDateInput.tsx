import { useState } from "react";

const PARTS = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/;

/** Month values are the ISO `01`..`12`; labels follow the viewer's locale. */
const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1).padStart(2, "0"),
  label: new Date(2000, index, 1).toLocaleDateString(undefined, { month: "short" }),
}));

function daysIn(year: string, month: string): number {
  if (!month) return 31;
  return new Date(year.length === 4 ? Number(year) : 2000, Number(month), 0).getDate();
}

/** The global select chevron is unlayered CSS, so it is cleared inline. */
const NO_CHEVRON = { backgroundImage: "none" };

const part =
  "h-full min-w-0 cursor-pointer appearance-none bg-transparent px-1.5 text-sm outline-none transition-colors hover:bg-surface/60 disabled:cursor-not-allowed disabled:hover:bg-transparent";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

/**
 * A date at year, month or day precision, entered as day, month and year. A
 * blank day stores `YYYY-MM` and a blank month stores `YYYY`.
 *
 * The year is typed a digit at a time and nothing can be stored without a full
 * one, so the three parts keep drafts and only commit once the year is
 * complete. The stored value wins whenever it holds a date, so an edit from
 * elsewhere shows without a resync.
 */
export function PartialDateInput({ label, value, onChange }: Props) {
  const stored = PARTS.exec(value);
  const freeform = value.length > 0 && stored === null;
  const [draft, setDraft] = useState(() => ({
    year: stored?.[1] ?? "",
    month: stored?.[2] ?? "",
    day: stored?.[3] ?? "",
  }));
  const shown = stored ? { year: stored[1]!, month: stored[2] ?? "", day: stored[3] ?? "" } : draft;

  function commit(next: { year: string; month: string; day: string }) {
    const month = next.month;
    const day = month && next.day && Number(next.day) <= daysIn(next.year, month) ? next.day : "";
    const fixed = { year: next.year, month, day };
    setDraft(fixed);
    if (fixed.year.length !== 4) {
      onChange("");
      return;
    }
    onChange([fixed.year, month, day].filter(Boolean).join("-"));
  }

  const days = Array.from({ length: daysIn(shown.year, shown.month) }, (_, index) =>
    String(index + 1).padStart(2, "0"),
  );

  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-10 min-w-0 items-center rounded-lg border border-line bg-bg transition-colors focus-within:border-accent-dim focus-within:ring-1 focus-within:ring-accent-ring"
    >
      <span title={label} className="ml-1.5 min-w-0 truncate rounded-md bg-surface px-2 py-1 text-2xs font-semibold uppercase tracking-wider text-mute/80">
        {label}
      </span>
      {freeform ? (
        // A value from a hand-edited export that is not an ISO date, kept as
        // text so it stays visible and editable.
        <input
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm text-text outline-none"
        />
      ) : (
        <div className="ml-auto flex h-full shrink-0 items-center divide-x divide-line/60 pl-1">
          <select
            value={shown.day}
            aria-label={`${label} day`}
            disabled={!shown.month}
            title={shown.month ? undefined : "Choose a month first"}
            onChange={(e) => commit({ ...shown, day: e.target.value })}
            style={NO_CHEVRON}
            className={`${part} w-12 shrink-0 text-center ${shown.day ? "text-text" : "text-mute/70"}`}
          >
            <option value="">Day</option>
            {days.map((day) => (
              <option key={day} value={day}>
                {Number(day)}
              </option>
            ))}
          </select>
          <select
            value={shown.month}
            aria-label={`${label} month`}
            onChange={(e) => commit({ ...shown, month: e.target.value })}
            style={NO_CHEVRON}
            className={`${part} w-16 shrink-0 text-center ${shown.month ? "text-text" : "text-mute/70"}`}
          >
            <option value="">Month</option>
            {MONTHS.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
          <input
            inputMode="numeric"
            placeholder="Year"
            maxLength={4}
            value={shown.year}
            aria-label={`${label} year`}
            onChange={(e) => commit({ ...shown, year: e.target.value.replace(/\D/g, "").slice(0, 4) })}
            className="h-full w-14 shrink-0 bg-transparent px-1.5 text-center text-sm tabular-nums text-text outline-none placeholder:text-mute/70"
          />
        </div>
      )}
    </div>
  );
}
