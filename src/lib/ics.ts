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

export function parseIcs(input: string, timezone: string, calendarId?: string): Omit<CalendarEvent, "id">[] {
  const lines = unfold(input);
  const events: Omit<CalendarEvent, "id">[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toUpperCase() !== "BEGIN:VEVENT") continue;
    const body: string[] = [];
    for (index += 1; index < lines.length && lines[index].toUpperCase() !== "END:VEVENT"; index += 1) body.push(lines[index]);
    const fields = properties(body);
    const startProperty = fields.get("DTSTART")?.[0];
    if (!startProperty) continue;
    const start = parseDate(startProperty, timezone);
    const endProperty = fields.get("DTEND")?.[0];
    const end = endProperty ? parseDate(endProperty, timezone) : undefined;
    const title = decodeIcsText(fields.get("SUMMARY")?.[0]?.value || "Untitled event");
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
  }
  return events;
}