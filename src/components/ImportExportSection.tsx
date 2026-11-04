import { useId, useState } from "react";
import type { AddressBook, Contact, ContactDraft } from "../lib/types";
import type { Session } from "../lib/client";
import { deleteAddressBook, deleteContact, putContact } from "../lib/client";
import { DEFAULT_ADDRESS_BOOK_ID, bookNameById, resolveAddressBookId } from "../lib/addressBook";
import { sortContacts } from "../lib/contact";
import { optimizeAvatar } from "../lib/image";
import { describeError, log } from "../lib/log";
import {
  parseImportContent,
  generateExportData,
  triggerDownload,
  type ExportFormat,
} from "../lib/importExport";
import { btnPrimary, btnSecondary, fieldLabel, selectField } from "../lib/styles";
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

const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;

type Props = {
  session: Session;
  contacts: Contact[];
  addressBooks: AddressBook[];
  onRefresh: () => Promise<void>;
  onCreateBook?: (name: string) => Promise<string | undefined>;
};

export function ImportExportSection({
  session,
  contacts,
  addressBooks,
  onRefresh,
  onCreateBook,
}: Props) {
  const [importFile, setImportFile] = useState<{ name: string; size: number } | null>(null);
  const [parsedFormat, setParsedFormat] = useState<string | null>(null);
  const [parsedContacts, setParsedContacts] = useState<ContactDraft[]>([]);
  const [skippedContacts, setSkippedContacts] = useState(0);
  const [targetBookId, setTargetBookId] = useState<string>(
    addressBooks[0]?.id ?? DEFAULT_ADDRESS_BOOK_ID,
  );
  // Prefix for the ids that tie this section's labels to their controls.
  const ids = useId();
  const [isCreatingBook, setIsCreatingBook] = useState(false);
  const [newBookName, setNewBookName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [importMsg, setImportMsg] = useState<Notice>(null);

  const [exportBookFilter, setExportBookFilter] = useState<string>("ALL");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("vcf");
  const [exportMsg, setExportMsg] = useState<Notice>(null);

  const exportContacts = sortContacts(
    exportBookFilter === "ALL"
      ? contacts
      : contacts.filter(
          (c) => resolveAddressBookId(c.addressBookId) === exportBookFilter,
        ),
  );

  function handleFileRead(file: File) {
    setImportMsg(null);
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setImportMsg({ type: "error", text: "Import files must be 5 MB or smaller." });
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
        const result = parseImportContent(file.name, content, targetBookId);
        if (result.contacts.length === 0) {
          setImportMsg({
            type: "error",
            text: `No valid contacts could be parsed from "${file.name}". Ensure it is a valid .vcf, .csv, or .json file.`,
          });
          return;
        }
        setImportFile({ name: file.name, size: file.size });
        setParsedFormat(result.format);
        setParsedContacts(result.contacts);
        setSkippedContacts(result.skipped.length);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setImportMsg({ type: "error", text: `Failed to parse file: ${msg}` });
      }
    };
    reader.onerror = () => {
      setImportMsg({ type: "error", text: "Failed to read file from disk." });
    };
    reader.readAsText(file);
  }

  function resetImport() {
    setImportFile(null);
    setParsedFormat(null);
    setParsedContacts([]);
    setSkippedContacts(0);
    setImportProgress(null);
    setIsCreatingBook(false);
    setNewBookName("");
  }

  async function handleExecuteImport() {
    if (parsedContacts.length === 0) return;

    setImporting(true);
    setImportMsg(null);
    setImportProgress({ current: 0, total: parsedContacts.length });
    const importedContactIds: string[] = [];
    let createdBookId: string | undefined;

    try {
      let finalBookId = targetBookId;

      if (isCreatingBook && newBookName.trim() && onCreateBook) {
        const createdId = await onCreateBook(newBookName.trim());
        if (createdId) {
          finalBookId = createdId;
          createdBookId = createdId;
        }
      }

      for (let i = 0; i < parsedContacts.length; i++) {
        // Copied rather than assigned into: `parsedContacts` is state, and
        // leaving the originals as parsed means a re-run after a partial
        // failure starts from the same drafts rather than from edited ones.
        const draft = { ...parsedContacts[i], addressBookId: finalBookId };
        if (draft.avatar && (draft.avatar.startsWith("data:") || draft.avatar.startsWith("blob:"))) {
          try {
            draft.avatar = await optimizeAvatar(draft.avatar);
          } catch (e) {
            log.warn("could not optimize an imported avatar", { reason: describeError(e) });
          }
        }
        importedContactIds.push(await putContact(session, draft));
        setImportProgress({ current: i + 1, total: parsedContacts.length });
      }

      await onRefresh();

      const bookName = bookNameById(addressBooks, finalBookId);
      setImportMsg({
        type: "success",
        text: `Successfully imported ${parsedContacts.length} contact${
          parsedContacts.length === 1 ? "" : "s"
        } into "${bookName}".${
          skippedContacts ? ` ${skippedContacts} had no name, email or phone number and were skipped.` : ""
        }`,
      });

      resetImport();
    } catch (err) {
      await Promise.allSettled(importedContactIds.map((id) => deleteContact(session, id)));
      if (createdBookId) await deleteAddressBook(session, createdBookId);
      if (importedContactIds.length > 0 || createdBookId) await onRefresh();
      const msg = err instanceof Error ? err.message : String(err);
      setImportMsg({ type: "error", text: `Import failed: ${msg}` });
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  function handleExecuteExport() {
    if (exportContacts.length === 0) {
      setExportMsg({
        type: "error",
        text: "No contacts available to export in the selected address book.",
      });
      return;
    }
    setExportMsg(null);
    try {
      const { filename, mime, data } = generateExportData(
        exportFormat,
        exportContacts,
        addressBooks,
      );
      triggerDownload(filename, mime, data);
      setExportMsg({
        type: "success",
        text: `Exported ${exportContacts.length} contact${
          exportContacts.length === 1 ? "" : "s"
        } as "${filename}".`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportMsg({ type: "error", text: `Export failed: ${msg}` });
    }
  }

  const contactCount = (count: number) => `${count} contact${count === 1 ? "" : "s"}`;
  const books = addressBooks
    .filter((book) => book.archived !== true)
    .map((book) => ({
      id: book.id,
      name: book.id === DEFAULT_ADDRESS_BOOK_ID ? `${book.name} (default)` : book.name,
    }));

  return (
    <>
      <SettingsGroup
        title="Import contacts"
        meta=".vcf, .csv, .json"
        description="Bring contacts in from iOS, Android, Google or Outlook as vCard or CSV, or restore a Sealbook JSON backup."
      >
        {!importFile ? (
          <FileDrop
            label="Choose a contacts file to import, or drop one here"
            accept=".vcf,.vcard,.csv,.json,text/vcard,text/csv,application/json"
            formats=".vcf .csv .json"
            hint="Apple Contacts or Google vCard, a spreadsheet as CSV, or a Sealbook backup"
            onFile={handleFileRead}
          />
        ) : (
          <ImportReview
            fileName={importFile.name}
            summary={`Detected ${parsedFormat} · ${contactCount(parsedContacts.length)} found${
              skippedContacts ? ` · ${skippedContacts} unreadable and skipped` : ""
            }`}
            busy={importing}
            onChangeFile={resetImport}
          >
            <TargetPicker
              id={`${ids}-target-book`}
              label="Target address book"
              noun="address book"
              creating={isCreatingBook}
              canCreate={Boolean(onCreateBook)}
              onToggle={() => setIsCreatingBook(!isCreatingBook)}
              disabled={importing}
              name={newBookName}
              onName={setNewBookName}
              placeholder="e.g. Work, Family, Archive"
              value={targetBookId}
              onValue={setTargetBookId}
              options={books}
            />
            <ImportPreview
              rows={parsedContacts.slice(0, 3).map((contact) => ({
                primary: contact.name,
                secondary:
                  contact.emails.find((e) => e.value)?.value ||
                  contact.phones.find((p) => p.value)?.value ||
                  "No direct channels",
              }))}
              total={parsedContacts.length}
            />
            {importing ? <ImportProgress label="Encrypting and uploading contacts…" progress={importProgress} /> : null}
            <div className={actionRow}>
              <button type="button" disabled={importing} onClick={resetImport} className={btnSecondary}>
                Cancel
              </button>
              <button
                type="button"
                disabled={importing || (isCreatingBook && !newBookName.trim()) || parsedContacts.length === 0}
                onClick={() => void handleExecuteImport()}
                className={btnPrimary}
              >
                {importing
                  ? `Importing (${importProgress?.current || 0}/${parsedContacts.length})…`
                  : `Import ${contactCount(parsedContacts.length)}`}
              </button>
            </div>
          </ImportReview>
        )}
        <NoticeLine notice={importMsg} />
      </SettingsGroup>

      <SettingsGroup
        title="Export contacts"
        meta={contactCount(exportContacts.length)}
        description="vCard opens in any contacts app, CSV in a spreadsheet. JSON keeps everything Sealbook stores, for a backup you can restore here."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${ids}-source-book`} className={fieldLabel}>
              Source address book
            </label>
            <select
              id={`${ids}-source-book`}
              value={exportBookFilter}
              onChange={(e) => setExportBookFilter(e.target.value)}
              className={`${selectField} mt-1.5`}
            >
              <option value="ALL">All address books ({contacts.length})</option>
              {addressBooks.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name} ({contacts.filter((c) => resolveAddressBookId(c.addressBookId) === book.id).length})
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
              onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
              className={`${selectField} mt-1.5`}
            >
              <option value="vcf">vCard (.vcf) · Apple, Google, Android, Outlook</option>
              <option value="csv">CSV (.csv) · Excel, spreadsheets</option>
              <option value="json">JSON (.json) · lossless full backup</option>
            </select>
          </div>
        </div>
        <NoticeLine notice={exportMsg} />
        <div className={actionRow}>
          <button
            type="button"
            disabled={exportContacts.length === 0}
            onClick={handleExecuteExport}
            className={btnPrimary}
          >
            Export {contactCount(exportContacts.length)}
          </button>
        </div>
      </SettingsGroup>
    </>
  );
}
