import type { CalendarEvent, RecurrenceRule } from "./types";
import { localInputToUtc } from "./timezone";

type IcsProperty = { value: string; params: Record<string, string> };

function unfold(input: string): string[] {
  return input.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function properties(lines: string[]): Map<string, IcsProperty[]> {
  const result = new Map<string, IcsProperty[]>();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const [namePart, value] = [line.slice(0, separator), line.slice(separator + 1)];
    const parts = namePart.split(";");
    const name = parts[0].toUpperCase();
    const params: Record<string, string> = {};
    for (const parameter of parts.slice(1)) {
      const equals = parameter.indexOf("=");
      if (equals > 0) params[parameter.slice(0, equals).toUpperCase()] = parameter.slice(equals + 1).replace(/^"|"$/g, "");
    }
    const list = result.get(name) ?? [];
    list.push({ value, params });
    result.set(name, list);
  }
  return result;
}

function unescape(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function decodeIcsText(value: string): string {
  let decoded = unescape(value);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the original text when a calendar contains a literal percent sign.
  }
  decoded = decoded.replace(/^text\/html\s*,/i, "");
  decoded = decoded
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return decoded.trim();
}

function cleanLocation(value: string): string | undefined {
  const location = decodeIcsText(value);
  if (!location) return undefined;
  return location.replace(/^location\s*:\s*/i, "").trim() || undefined;
}

function dateOnly(value: string, offset: number): string {
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function parseDate(property: IcsProperty, timezone: string): { value: string; allDay: boolean } {
  const raw = property.value.trim();
  if (property.params.VALUE?.toUpperCase() === "DATE" || raw.length === 8) return { value: dateOnly(raw, 0), allDay: true };
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(raw);
  if (!match) throw new Error(`Unsupported ICS date: ${raw}`);
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
  return { value: match[7] ? new Date(`${local}:00Z`).toISOString() : localInputToUtc(local, property.params.TZID || timezone), allDay: false };
}

function parseWeekday(value: string): number | undefined {
  return ({ SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 } as Record<string, number>)[value.slice(-2).toUpperCase()];
}

function recurrence(ruleValue: string | undefined, start: Date): RecurrenceRule | undefined {
  if (!ruleValue) return undefined;
  const values = Object.fromEntries(ruleValue.split(";").map((part) => part.split("=", 2))) as Record<string, string>;
  const frequency = values.FREQ?.toLowerCase();
  if (!(["daily", "weekly", "monthly", "yearly"] as string[]).includes(frequency)) return undefined;
  const rule: RecurrenceRule = { frequency: frequency as RecurrenceRule["frequency"], interval: Number(values.INTERVAL || 1) };
  if (values.UNTIL) {
    const until = values.UNTIL.replace(/Z$/, "");
    rule.until = until.length >= 8 ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` : undefined;
  }
  if (values.COUNT) rule.count = Number(values.COUNT);
  if (frequency === "weekly") {
    const weekdays = values.BYDAY?.split(",").map(parseWeekday).filter((day): day is number => day !== undefined);
    rule.weekdays = weekdays?.length ? weekdays : [start.getDay()];
  } else if (frequency === "monthly") {
    if (values.BYDAY) {
      const weekday = parseWeekday(values.BYDAY);
      const ordinal = Number.parseInt(values.BYDAY, 10);
      if (weekday !== undefined && ordinal >= 1 && ordinal <= 5) rule.nthWeekday = { weekday, ordinal: ordinal as 1 | 2 | 3 | 4 | 5 };
    }
    if (values.BYMONTHDAY) rule.dayOfMonth = Number(values.BYMONTHDAY);
    if (!rule.dayOfMonth && !rule.nthWeekday) rule.dayOfMonth = start.getDate();
  }
  if (rule.interval === 1) delete rule.interval;
  return rule;
}

export type CalendarImportResult = {
  events: Omit<CalendarEvent, "id">[];
  /**
   * Entries dropped for being unusable, so the UI can say so rather than lose
   * them quietly. One unreadable date in an export of hundreds must not cost
   * the rest.
   */
  skipped: { title: string; reason: string }[];
};

export function parseIcs(input: string, timezone: string, calendarId?: string): CalendarImportResult {
  const lines = unfold(input);
  const events: Omit<CalendarEvent, "id">[] = [];
  const skipped: CalendarImportResult["skipped"] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toUpperCase() !== "BEGIN:VEVENT") continue;
    const body: string[] = [];
    for (index += 1; index < lines.length && lines[index].toUpperCase() !== "END:VEVENT"; index += 1) body.push(lines[index]);
    const fields = properties(body);
    const title = decodeIcsText(fields.get("SUMMARY")?.[0]?.value || "Untitled event");
    const startProperty = fields.get("DTSTART")?.[0];
    if (!startProperty) {
      skipped.push({ title, reason: "it has no start date" });
      continue;
    }
    try {
      const start = parseDate(startProperty, timezone);
      const endProperty = fields.get("DTEND")?.[0];
      const end = endProperty ? parseDate(endProperty, timezone) : undefined;
      const participants = fields.get("ATTENDEE")?.map((attendee) => decodeIcsText(attendee.value.replace(/^mailto:/i, ""))).filter(Boolean);
      const eventEnd = end ? (start.allDay ? dateOnly(end.value.replaceAll("-", ""), -1) : end.value) : undefined;
      events.push({
        title,
        start: start.value,
        end: eventEnd,
        notes: decodeIcsText(fields.get("X-ALT-DESC")?.[0]?.value || fields.get("DESCRIPTION")?.[0]?.value || "") || undefined,
        location: cleanLocation(fields.get("LOCATION")?.[0]?.value || ""),
        participants: participants?.length ? participants : undefined,
        timezone: startProperty.params.TZID || timezone,
        calendarId,
        recurrence: recurrence(fields.get("RRULE")?.[0]?.value, start.allDay ? new Date(`${start.value}T00:00:00`) : new Date(start.value)),
      });
    } catch (err) {
      skipped.push({ title, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { events, skipped };
}

function titleOf(value: Record<string, unknown>): string {
  return typeof value.title === "string" && value.title.trim() ? value.title : "Untitled event";
}

export function parseCalendarImport(input: string, timezone: string, calendarId?: string): CalendarImportResult {
  if (!input.trimStart().startsWith("[") && !input.trimStart().startsWith("{")) {
    return parseIcs(input, timezone, calendarId);
  }

  const parsed: unknown = JSON.parse(input);
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const events: Omit<CalendarEvent, "id">[] = [];
  const skipped: CalendarImportResult["skipped"] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      skipped.push({ title: "Untitled event", reason: "it is not an event" });
      continue;
    }
    const record = entry as Record<string, unknown>;
    let payload: unknown = record;
    if (typeof record.payload === "string") {
      try {
        payload = JSON.parse(record.payload);
      } catch {
        skipped.push({ title: titleOf(record), reason: "its payload could not be read" });
        continue;
      }
    }
    if (!payload || typeof payload !== "object") {
      skipped.push({ title: titleOf(record), reason: "its payload is not an event" });
      continue;
    }
    const event = payload as Record<string, unknown>;
    if (typeof event.title !== "string" || typeof event.start !== "string") {
      skipped.push({ title: titleOf(event), reason: "it has no title or start date" });
      continue;
    }
    events.push({
      title: event.title,
      start: event.start,
      end: typeof event.end === "string" ? event.end : undefined,
      notes: typeof event.notes === "string" ? event.notes : undefined,
      location: typeof event.location === "string" ? event.location : undefined,
      participants: Array.isArray(event.participants)
        ? event.participants.filter((participant): participant is string => typeof participant === "string")
        : undefined,
      timezone: typeof event.timezone === "string" ? event.timezone : timezone,
      calendarId: calendarId || (typeof event.calendarId === "string" ? event.calendarId : undefined),
      recurrence: event.recurrence as CalendarEvent["recurrence"],
    });
  }
  return { events, skipped };
}

// --- Export -----------------------------------------------------------------

/** RFC 5545 escaping for TEXT values: backslash, semicolon, comma, newline. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Folds a content line to 75 octets as RFC 5545 requires, continuing with a
 * leading space. Measured in UTF-8 bytes, not characters, so a line of
 * non-ASCII text is not silently over-long.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // Continuation lines carry a leading space, so they get one octet less.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

/** `20260927T090000Z` for a timed value, `20260927` for an all-day date. */
function icsStamp(value: string): string {
  if (!value.includes("T")) return value.slice(0, 10).replace(/-/g, "");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace(/[-:]/g, "").slice(0, 15) + "Z";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

const ICS_WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function recurrenceToRrule(rule: RecurrenceRule): string | null {
  const frequency = rule.frequency.toUpperCase();
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(frequency)) return null;
  const parts = [`FREQ=${frequency}`];
  if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.weekdays?.length) {
    parts.push(`BYDAY=${rule.weekdays.map((day) => ICS_WEEKDAYS[day] ?? "").filter(Boolean).join(",")}`);
  }
  if (rule.nthWeekday) {
    parts.push(`BYDAY=${rule.nthWeekday.ordinal}${ICS_WEEKDAYS[rule.nthWeekday.weekday] ?? "MO"}`);
  }
  if (rule.dayOfMonth) parts.push(`BYMONTHDAY=${rule.dayOfMonth}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${icsStamp(rule.until)}`);
  return parts.join(";");
}

/**
 * Serializes events as an RFC 5545 calendar.
 *
 * All-day events use DATE values with the exclusive DTEND the spec requires,
 * which is one day after the inclusive end Sealbook stores.
 */
export function formatIcs(events: CalendarEvent[], calendarName = "Sealbook"): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sealbook//Sealbook Web//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  const stamp = icsStamp(new Date().toISOString());

  for (const event of events) {
    const allDay = !event.start.includes("T");
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id || crypto.randomUUID()}@sealbook`);
    lines.push(`DTSTAMP:${stamp}`);

    if (allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsStamp(event.start)}`);
      // Sealbook stores an inclusive end date; DTEND is exclusive.
      const inclusive = (event.end || event.start).slice(0, 10);
      const exclusive = new Date(`${inclusive}T00:00:00Z`);
      exclusive.setUTCDate(exclusive.getUTCDate() + 1);
      lines.push(`DTEND;VALUE=DATE:${exclusive.toISOString().slice(0, 10).replace(/-/g, "")}`);
    } else {
      lines.push(`DTSTART:${icsStamp(event.start)}`);
      if (event.end) lines.push(`DTEND:${icsStamp(event.end)}`);
    }

    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
    for (const participant of event.participants ?? []) {
      const trimmed = participant.trim();
      if (!trimmed) continue;
      lines.push(
        trimmed.includes("@")
          ? `ATTENDEE;CN=${escapeText(trimmed)}:mailto:${trimmed}`
          : `ATTENDEE;CN=${escapeText(trimmed)}:invalid:nomail`,
      );
    }
    if (event.recurrence) {
      const rrule = recurrenceToRrule(event.recurrence);
      if (rrule) lines.push(`RRULE:${rrule}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
