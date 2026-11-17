import { useId, useState } from "react";

import type { Session } from "../lib/client";
import { deleteCalendar, deleteCalendarEvent, putCalendar, putCalendarEvents } from "../lib/client";
import { friendlyError } from "../lib/errors";
import { formatIcs, parseCalendarImport } from "../lib/ics";
import { triggerDownload } from "../lib/importExport";
import { btnPrimary, btnSecondary, fieldLabel, selectField } from "../lib/styles";
import { useExportPasswordConfirm } from "./ExportPasswordConfirm";
import type { Calendar, CalendarEvent } from "../lib/types";
import { DEFAULT_CALENDAR_COLOR } from "../lib/types";
import {
  FileDrop,
  ImportPreview,
  ImportProgress,
  ImportReview,
  NoticeLine,
  SettingsGroup,
  TargetPicker,
  actionRow,
  type Notice,
} from "./SettingsKit";

const MAX_CALENDAR_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CALENDAR_EVENTS = 1_000;

type Props = {
  session: Session;
  calendars: Calendar[];
  calendarEvents: CalendarEvent[];
  timezone: string;
  onRefresh: () => Promise<void>;
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function CalendarImportExportSection({
  session,
  calendars,
  calendarEvents,
  timezone,
  onRefresh,
}: Props) {
  const ids = useId();
  const [icsFile, setIcsFile] = useState<{ name: string; size: number } | null>(null);
  const [parsedFormat, setParsedFormat] = useState<string | null>(null);
  const [parsedEvents, setParsedEvents] = useState<Omit<CalendarEvent, "id">[]>([]);
  const [skippedEvents, setSkippedEvents] = useState(0);
  const [droppedRules, setDroppedRules] = useState(0);
  const [calendarId, setCalendarId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [importMsg, setImportMsg] = useState<Notice>(null);

  const [exportCalendarId, setExportCalendarId] = useState("all");
  const [exportFormat, setExportFormat] = useState<"ics" | "json">("ics");
  const [exportMsg, setExportMsg] = useState<Notice>(null);
  const passwordConfirm = useExportPasswordConfirm();

  const exportEvents = exportCalendarId === "all"
    ? calendarEvents
    : calendarEvents.filter((event) => event.calendarId === exportCalendarId);
  const creating = isCreating || calendars.length === 0;

  function readFile(file: File) {
    setImportMsg(null);
    if (file.size > MAX_CALENDAR_FILE_BYTES) {
      setImportMsg({ type: "error", text: "Calendar files must be 5 MB or smaller." });
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content !== "string" || !content.trim()) {
        setImportMsg({ type: "error", text: `File "${file.name}" is empty.` });
        return;
      }
      try {
        const trimmed = content.trimStart();
        const { events, skipped, droppedRules: dropped = 0 } = parseCalendarImport(content, timezone, calendarId);
        if (events.length === 0) {
          setImportMsg({
            type: "error",
            text: skipped.length
              ? `No calendar events in "${file.name}" could be used: ${skipped.length} could not be read.`
              : `No calendar events could be parsed from "${file.name}". Ensure it is a valid .ics or .json file.`,
          });
          return;
        }
        if (events.length > MAX_CALENDAR_EVENTS) {
          setImportMsg({ type: "error", text: "Calendar files may contain at most 1,000 events." });
          return;
        }
        setCalendarId((current) => current || calendars[0]?.id || "");
        setIcsFile({ name: file.name, size: file.size });
        setParsedFormat(trimmed.startsWith("[") || trimmed.startsWith("{") ? "JSON" : "ICS");
        setParsedEvents(events);
        setSkippedEvents(skipped.length);
        setDroppedRules(dropped);
      } catch (err) {
        setImportMsg({ type: "error", text: `Failed to parse file: ${friendlyError(err)}` });
      }
    };
    reader.onerror = () => {
      setImportMsg({ type: "error", text: "Failed to read file from disk." });
    };
    reader.readAsText(file);
  }

  function resetImport() {
    setIcsFile(null);
    setParsedFormat(null);
    setParsedEvents([]);
    setSkippedEvents(0);
    setDroppedRules(0);
    setProgress(null);
    setIsCreating(false);
    setNewCalendarName("");
  }

  async function runImport() {
    if (parsedEvents.length === 0) return;

    setImporting(true);
    setImportMsg(null);
    setProgress({ current: 0, total: parsedEvents.length });
    const importedEventIds: string[] = [];
    let createdCalendarId: string | undefined;

    try {
      let finalCalendarId = calendarId;
      const creatingName = newCalendarName.trim();

      if (isCreating && creatingName) {
        finalCalendarId = await putCalendar(session, { name: creatingName, color: DEFAULT_CALENDAR_COLOR });
        setCalendarId(finalCalendarId);
        createdCalendarId = finalCalendarId;
      }

      for (let offset = 0; offset < parsedEvents.length; offset += 256) {
        const batch = parsedEvents.slice(offset, offset + 256).map((event) => ({
          ...event,
          calendarId: finalCalendarId,
        }));
        importedEventIds.push(...await putCalendarEvents(session, batch));
        setProgress({ current: Math.min(offset + batch.length, parsedEvents.length), total: parsedEvents.length });
      }

      await onRefresh();

      const calendarName = isCreating && creatingName
        ? creatingName
        : calendars.find((calendar) => calendar.id === finalCalendarId)?.name ?? "your calendar";
      setImportMsg({
        type: "success",
        text: `Successfully imported ${plural(parsedEvents.length, "event")} into "${calendarName}".${
          skippedEvents ? ` ${skippedEvents} could not be read and were skipped.` : ""
        }${
          droppedRules
            ? ` ${droppedRules} repeat${droppedRules === 1 ? "s" : ""} by a rule that is not supported, so ${
                droppedRules === 1 ? "it was" : "they were"
              } imported once.`
            : ""
        }`,
      });

      resetImport();
    } catch (err) {
      await Promise.allSettled(importedEventIds.map((id) => deleteCalendarEvent(session, id)));
      if (createdCalendarId) await deleteCalendar(session, createdCalendarId);
      if (importedEventIds.length > 0 || createdCalendarId) await onRefresh();
      setImportMsg({ type: "error", text: `Import failed: ${friendlyError(err)}` });
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  async function runExport() {
    if (exportEvents.length === 0) {
      setExportMsg({ type: "error", text: "No events available to export in the selected calendar." });
      return;
    }
    const problem = await passwordConfirm.confirm();
    if (problem !== null) {
      setExportMsg({ type: "error", text: problem });
      return;
    }
    setExportMsg(null);
    try {
      const name = exportCalendarId === "all"
        ? "Sealbook"
        : calendars.find((calendar) => calendar.id === exportCalendarId)?.name ?? "Sealbook";
      const stamp = new Date().toISOString().slice(0, 10);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "calendar";
      const filename = `${slug}-${stamp}.${exportFormat}`;
      if (exportFormat === "json") {
        triggerDownload(filename, "application/json", JSON.stringify(exportEvents, null, 2));
      } else {
        triggerDownload(filename, "text/calendar;charset=utf-8", formatIcs(exportEvents, name));
      }
      setExportMsg({ type: "success", text: `Exported ${plural(exportEvents.length, "event")} as "${filename}".` });
    } catch (err) {
      setExportMsg({ type: "error", text: `Export failed: ${friendlyError(err)}` });
    }
  }

  return (
    <>
      <SettingsGroup
        title="Import events"
        meta=".ics, .ical, .json"
        description="Bring events in from Apple Calendar, Google Calendar or Outlook as an ICS file, or restore a Sealbook JSON backup."
      >
        {!icsFile ? (
          <FileDrop
            label="Choose a calendar file to import, or drop one here"
            accept=".ics,.ical,.json,text/calendar,application/json"
            formats=".ics .ical .json"
            hint="An export from Apple Calendar, Google Calendar or Outlook, or a Sealbook backup"
            onFile={readFile}
          />
        ) : (
          <ImportReview
            fileName={icsFile.name}
            summary={`Detected ${parsedFormat} · ${plural(parsedEvents.length, "event")} found${
              skippedEvents ? ` · ${skippedEvents} unreadable and skipped` : ""
            }${droppedRules ? ` · ${droppedRules} repeat rule${droppedRules === 1 ? "" : "s"} not supported` : ""}`}
            busy={importing}
            onChangeFile={resetImport}
          >
            <TargetPicker
              id={`${ids}-ics-calendar`}
              label="Target calendar"
              noun="calendar"
              creating={creating}
              canCreate
              onToggle={() => setIsCreating(!isCreating)}
              disabled={importing}
              name={newCalendarName}
              onName={setNewCalendarName}
              placeholder="e.g. Work, Personal, Travel"
              value={calendarId}
              onValue={setCalendarId}
              options={calendars}
            />
            <ImportPreview
              rows={parsedEvents.slice(0, 3).map((event) => ({
                primary: event.title,
                secondary: event.start.slice(0, 16).replace("T", " "),
              }))}
              total={parsedEvents.length}
            />
            {importing ? <ImportProgress label="Encrypting and uploading events…" progress={progress} /> : null}
            <div className={actionRow}>
              <button type="button" disabled={importing} onClick={resetImport} className={btnSecondary}>
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  importing ||
                  (creating && !newCalendarName.trim()) ||
                  (!creating && !calendarId)
                }
                onClick={() => void runImport()}
                className={btnPrimary}
              >
                {importing
                  ? `Importing (${progress?.current || 0}/${parsedEvents.length})…`
                  : `Import ${plural(parsedEvents.length, "event")}`}
              </button>
            </div>
          </ImportReview>
        )}
        <NoticeLine notice={importMsg} />
      </SettingsGroup>

      <SettingsGroup
        title="Export events"
        meta={plural(exportEvents.length, "event")}
        description="ICS opens in any calendar app. JSON keeps everything Sealbook stores, for a backup you can restore here."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${ids}-export-calendar`} className={fieldLabel}>
              Source calendar
            </label>
            <select
              id={`${ids}-export-calendar`}
              value={exportCalendarId}
              onChange={(event) => setExportCalendarId(event.target.value)}
              className={`${selectField} mt-1.5`}
            >
              <option value="all">All calendars ({calendarEvents.length})</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name} ({calendarEvents.filter((event) => event.calendarId === calendar.id).length})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${ids}-export-format`} className={fieldLabel}>
              Export format
            </label>
            <select
              id={`${ids}-export-format`}
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value as "ics" | "json")}
              className={`${selectField} mt-1.5`}
            >
              <option value="ics">iCalendar (.ics) · any calendar app</option>
              <option value="json">JSON (.json) · lossless full backup</option>
            </select>
          </div>
        </div>
        {passwordConfirm.field}
        <NoticeLine notice={exportMsg} />
        <div className={actionRow}>
          <button type="button" disabled={exportEvents.length === 0 || !passwordConfirm.hasPassword} onClick={() => void runExport()} className={btnPrimary}>
            Export {plural(exportEvents.length, "event")}
          </button>
        </div>
      </SettingsGroup>
    </>
  );
}
