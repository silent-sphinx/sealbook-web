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

  function changePrecision(next: DatePrecision) {
    setPending(next);
    const recut = atPrecision(value, next);
    if (recut !== value) onChange(recut);
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
        ) : (
          <input
            type={precision === "month" ? "month" : "date"}
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
