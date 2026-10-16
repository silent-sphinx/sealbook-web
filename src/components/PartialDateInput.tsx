import { useState } from "react";

import { atPrecision, precisionOf, type DatePrecision } from "../lib/contactProfile";
import { fieldBase, selectField } from "../lib/styles";

const PRECISION_LABELS: Record<DatePrecision, string> = {
  year: "Year",
  month: "Month",
  day: "Day",
};

const YEAR_MIN = 1900;
const YEAR_MAX = new Date().getFullYear() + 10;

/** Month values are the ISO `01`..`12`; labels follow the viewer's locale. */
const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1).padStart(2, "0"),
  label: new Date(2000, index, 1).toLocaleDateString(undefined, { month: "long" }),
}));

type Props = {
  label: string;
  value: string;
  /** Used while the field is empty, so a row opens at its natural precision. */
  defaultPrecision?: DatePrecision;
  /**
   * Shown beside the label. Native month and date inputs take no placeholder, so
   * a hint about leaving the field blank has nowhere else to go.
   */
  hint?: string;
  onChange: (value: string) => void;
};

/**
 * A date at year, month or day precision, each with its native picker.
 *
 * Precision is read off the stored value rather than held in state, so a value
 * written elsewhere (an import, another device) opens at the precision it was
 * written at. The local state only remembers the choice while the field is
 * empty, which is the one case the value cannot carry.
 */
export function PartialDateInput({
  label,
  value,
  defaultPrecision = "month",
  hint,
  onChange,
}: Props) {
  const [pending, setPending] = useState<DatePrecision>(defaultPrecision);
  const detected = precisionOf(value);
  const precision = detected ?? pending;
  // A value from a hand-edited export that is not an ISO date at all. Shown as
  // text so it is visible and editable rather than swallowed by a picker that
  // cannot render it.
  const freeform = value.length > 0 && detected === null;

  // The month picker drives one stored `YYYY-MM`, but the year is typed a digit
  // at a time and a month cannot be stored without a full year. So the two
  // controls keep their own drafts and only commit a value once the year is
  // complete: a partial year (`2`, `20`) leaves the stored value empty without
  // losing what has been typed. The stored value is read back when it holds a
  // year or month, and the draft fills in only while it does not, so an edit
  // from elsewhere still wins without a resync.
  const [yearDraft, setYearDraft] = useState(() => /^(\d{4})/.exec(value)?.[1] ?? "");
  const [monthDraft, setMonthDraft] = useState(() => /^\d{4}-(\d{2})/.exec(value)?.[1] ?? "01");
  const currentYear = /^(\d{4})/.exec(value)?.[1] ?? yearDraft;
  const currentMonth = /^\d{4}-(\d{2})/.exec(value)?.[1] ?? monthDraft;

  function changePrecision(next: DatePrecision) {
    setPending(next);
    const recut = atPrecision(value, next);
    if (recut !== value) onChange(recut);
  }

  function commitMonth(year: string, month: string) {
    onChange(year.length === 4 ? `${year}-${month}` : "");
  }

  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-mute/80">
        {label}
        {hint ? <span className="ml-1.5 normal-case tracking-normal text-mute/70">{hint}</span> : null}
      </span>
      <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
        <select
          value={precision}
          aria-label={`${label} precision`}
          onChange={(e) => changePrecision(e.target.value as DatePrecision)}
          className={selectField}
        >
          {(["year", "month", "day"] as DatePrecision[]).map((option) => (
            <option key={option} value={option}>
              {PRECISION_LABELS[option]}
            </option>
          ))}
        </select>
        {freeform ? (
          <input
            value={value}
            aria-label={label}
            onChange={(e) => onChange(e.target.value)}
            className={fieldBase}
          />
        ) : precision === "year" ? (
          <input
            type="number"
            inputMode="numeric"
            min={YEAR_MIN}
            max={YEAR_MAX}
            step={1}
            placeholder="YYYY"
            value={value}
            aria-label={label}
            onChange={(e) => onChange(e.target.value.slice(0, 4))}
            className={fieldBase}
          />
        ) : precision === "month" ? (
          // A month select plus a year, rather than `<input type="month">`:
          // browsers without native month support render that as a free-text box,
          // where a typed value sorts and round-trips as prose.
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem] gap-2">
            <select
              value={currentMonth}
              aria-label={`${label} month`}
              onChange={(e) => {
                setMonthDraft(e.target.value);
                commitMonth(currentYear, e.target.value);
              }}
              className={selectField}
            >
              {MONTHS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              inputMode="numeric"
              min={YEAR_MIN}
              max={YEAR_MAX}
              step={1}
              placeholder="YYYY"
              value={currentYear}
              aria-label={`${label} year`}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                setYearDraft(digits);
                commitMonth(digits, currentMonth);
              }}
              className={fieldBase}
            />
          </div>
        ) : (
          <input
            type="date"
            value={value}
            aria-label={label}
            onChange={(e) => onChange(e.target.value)}
            className={fieldBase}
          />
        )}
      </div>
    </div>
  );
}
