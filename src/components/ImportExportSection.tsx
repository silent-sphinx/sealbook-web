import { useState, useRef, type ChangeEvent, type DragEvent } from "react";
import type { AddressBook, Contact, ContactDraft } from "../lib/types";
import type { Session } from "../lib/client";
import { putContact } from "../lib/client";
import { DEFAULT_ADDRESS_BOOK_ID, bookNameById, resolveAddressBookId } from "../lib/addressBook";
import {
  parseImportContent,
  generateExportData,
  triggerDownload,
  type ExportFormat,
} from "../lib/importExport";
import {
  btnPrimary,
  btnSecondary,
  field,
  selectField,
} from "../lib/styles";

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
  // Import State
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importFile, setImportFile] = useState<{ name: string; size: number } | null>(null);
  const [parsedFormat, setParsedFormat] = useState<string | null>(null);
  const [parsedContacts, setParsedContacts] = useState<ContactDraft[]>([]);
  const [targetBookId, setTargetBookId] = useState<string>(
    addressBooks[0]?.id ?? DEFAULT_ADDRESS_BOOK_ID,
  );
  const [isCreatingBook, setIsCreatingBook] = useState(false);
  const [newBookName, setNewBookName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [importMsg, setImportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Export State
  const [exportBookFilter, setExportBookFilter] = useState<string>("ALL");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("vcf");
  const [exportMsg, setExportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Filtered contacts for export
  const exportContacts =
    exportBookFilter === "ALL"
      ? contacts
      : contacts.filter(
          (c) => resolveAddressBookId(c.addressBookId) === exportBookFilter,
        );

  // File loading and parsing
  function handleFileRead(file: File) {
    setImportMsg(null);
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

  function onFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      handleFileRead(file);
    }
    e.target.value = "";
  }

  function handleDrag(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileRead(file);
    }
  }

  function resetImport() {
    setImportFile(null);
    setParsedFormat(null);
    setParsedContacts([]);
    setImportProgress(null);
    setIsCreatingBook(false);
    setNewBookName("");
  }

  async function handleExecuteImport() {
    if (parsedContacts.length === 0) return;

    setImporting(true);
    setImportMsg(null);
    setImportProgress({ current: 0, total: parsedContacts.length });

    try {
      let finalBookId = targetBookId;

      if (isCreatingBook && newBookName.trim() && onCreateBook) {
        const createdId = await onCreateBook(newBookName.trim());
        if (createdId) {
          finalBookId = createdId;
        }
      }

      for (let i = 0; i < parsedContacts.length; i++) {
        const draft = parsedContacts[i];
        draft.addressBookId = finalBookId;
        await putContact(session, draft);
        setImportProgress({ current: i + 1, total: parsedContacts.length });
      }

      await onRefresh();

      const bookName = bookNameById(addressBooks, finalBookId);
      setImportMsg({
        type: "success",
        text: `Successfully imported ${parsedContacts.length} contact${
          parsedContacts.length === 1 ? "" : "s"
        } into "${bookName}".`,
      });

      resetImport();
    } catch (err) {
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

  return (
    <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm space-y-8">
      <div>
        <h3 className="text-base font-semibold text-text">
          Import & Export Contacts
        </h3>
        <p className="mt-1 text-xs text-mute leading-relaxed">
          Migrate contacts from iOS, Android, Google, or Outlook using standard
          vCard (.vcf) or CSV formats, or export encrypted backups.
        </p>
      </div>

      {/* SUB-SECTION 1: IMPORT */}
      <div className="rounded-xl border border-line/80 bg-bg/50 p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
              ↓
            </span>
            <h4 className="text-sm font-semibold text-text">Import Contacts</h4>
          </div>
          <span className="text-[11px] text-mute font-mono">
            .vcf, .csv, .json
          </span>
        </div>

        {/* Dropzone / File Picker */}
        {!importFile ? (
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-7 text-center transition-all cursor-pointer ${
              dragActive
                ? "border-accent bg-accent/10 scale-[0.99]"
                : "border-line/80 hover:border-line-light hover:bg-surface/30"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".vcf,.vcard,.csv,.json,text/vcard,text/csv,application/json"
              onChange={onFileInputChange}
              className="hidden"
            />
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface border border-line text-accent mb-2">
              <svg
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.56l2.22 2.22a.75.75 0 1 0 1.06-1.06l-3.5-3.5a.75.75 0 0 0-1.06 0l-3.5 3.5a.75.75 0 0 0 1.06 1.06l2.22-2.22v8.69ZM3.5 14.25a.75.75 0 0 1 .75.75v1.5c0 .414.336.75.75.75h10a.75.75 0 0 0 .75-.75V15a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 15 18.75H5A2.25 2.25 0 0 1 2.75 16.5V15a.75.75 0 0 1 .75-.75Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-xs font-medium text-text">
              Click to select file or drag & drop here
            </p>
            <p className="mt-1 text-[11px] text-mute">
              Supports Apple Contacts / Google vCard (.vcf), Spreadsheets (.csv), or Sealbook (.json)
            </p>
          </div>
        ) : (
          /* File Preview & Address Book Selection */
          <div className="space-y-4 rounded-xl border border-accent/30 bg-surface/40 p-4 animate-fade-in">
            <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3">
              <div>
                <p className="text-xs font-semibold text-text truncate max-w-xs sm:max-w-sm">
                  {importFile.name}
                </p>
                <p className="text-[11px] text-accent font-medium mt-0.5">
                  Detected {parsedFormat} · {parsedContacts.length} contact
                  {parsedContacts.length === 1 ? "" : "s"} found
                </p>
              </div>
              <button
                type="button"
                disabled={importing}
                onClick={resetImport}
                className="text-xs text-mute hover:text-text cursor-pointer"
              >
                Change file
              </button>
            </div>

            {/* Address Book Selection Prompt */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-text">
                  Target Address Book
                </label>
                {onCreateBook && (
                  <button
                    type="button"
                    disabled={importing}
                    onClick={() => setIsCreatingBook(!isCreatingBook)}
                    className="text-[11px] text-accent hover:underline cursor-pointer"
                  >
                    {isCreatingBook ? "Select existing book" : "+ Create new address book"}
                  </button>
                )}
              </div>

              {isCreatingBook ? (
                <input
                  type="text"
                  value={newBookName}
                  onChange={(e) => setNewBookName(e.target.value)}
                  placeholder="e.g. Work Contacts, Family, Archive"
                  className={field}
                  disabled={importing}
                  autoFocus
                />
              ) : (
                <select
                  value={targetBookId}
                  onChange={(e) => setTargetBookId(e.target.value)}
                  disabled={importing}
                  className={selectField}
                >
                  {addressBooks.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.name} {book.id === DEFAULT_ADDRESS_BOOK_ID ? "(Default)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Sample Contact Preview */}
            <div className="rounded-lg border border-line/70 bg-bg/70 p-3">
              <p className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                Preview (First {Math.min(parsedContacts.length, 3)} of{" "}
                {parsedContacts.length})
              </p>
              <div className="space-y-1.5 text-xs">
                {parsedContacts.slice(0, 3).map((contact, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-1 border-b border-line/40 last:border-0"
                  >
                    <span className="font-medium text-text truncate max-w-[160px]">
                      {contact.name}
                    </span>
                    <span className="text-mute truncate max-w-[180px] text-[11px] font-mono">
                      {contact.emails.find((e) => e.value)?.value ||
                        contact.phones.find((p) => p.value)?.value ||
                        "No direct channels"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Progress Bar */}
            {importing && importProgress && (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] text-mute">
                  <span>Encrypting & uploading contacts…</span>
                  <span className="font-mono font-medium text-accent">
                    {importProgress.current} / {importProgress.total}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface border border-line">
                  <div
                    className="h-full bg-accent transition-all duration-150"
                    style={{
                      width: `${(importProgress.current / importProgress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={importing}
                onClick={resetImport}
                className={btnSecondary}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  importing ||
                  (isCreatingBook && !newBookName.trim()) ||
                  parsedContacts.length === 0
                }
                onClick={handleExecuteImport}
                className={btnPrimary}
              >
                {importing
                  ? `Importing (${importProgress?.current || 0}/${parsedContacts.length})…`
                  : `Import ${parsedContacts.length} Contact${
                      parsedContacts.length === 1 ? "" : "s"
                    }`}
              </button>
            </div>
          </div>
        )}

        {importMsg && (
          <div
            className={`rounded-lg px-3 py-2 text-xs font-medium ${
              importMsg.type === "success"
                ? "bg-accent/10 text-accent border border-accent/20"
                : "bg-danger/10 text-danger border border-danger/20"
            }`}
          >
            {importMsg.text}
          </div>
        )}
      </div>

      {/* SUB-SECTION 2: EXPORT */}
      <div className="rounded-xl border border-line/80 bg-bg/50 p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
              ↑
            </span>
            <h4 className="text-sm font-semibold text-text">Export Contacts</h4>
          </div>
          <span className="text-[11px] text-mute font-mono">
            {exportContacts.length} contact{exportContacts.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Source Address Book */}
          <div>
            <label className="block text-xs font-medium text-text mb-1">
              Source Address Book
            </label>
            <select
              value={exportBookFilter}
              onChange={(e) => setExportBookFilter(e.target.value)}
              className={selectField}
            >
              <option value="ALL">
                All Address Books ({contacts.length})
              </option>
              {addressBooks.map((book) => {
                const count = contacts.filter(
                  (c) => resolveAddressBookId(c.addressBookId) === book.id,
                ).length;
                return (
                  <option key={book.id} value={book.id}>
                    {book.name} ({count})
                  </option>
                );
              })}
            </select>
          </div>

          {/* Export Format */}
          <div>
            <label className="block text-xs font-medium text-text mb-1">
              Export Format
            </label>
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
              className={selectField}
            >
              <option value="vcf">
                vCard (.vcf) · Apple, Google, Android, Outlook
              </option>
              <option value="csv">
                CSV (.csv) · Excel, Spreadsheets
              </option>
              <option value="json">
                JSON (.json) · Lossless Full Backup
              </option>
            </select>
          </div>
        </div>

        {exportMsg && (
          <div
            className={`rounded-lg px-3 py-2 text-xs font-medium ${
              exportMsg.type === "success"
                ? "bg-accent/10 text-accent border border-accent/20"
                : "bg-danger/10 text-danger border border-danger/20"
            }`}
          >
            {exportMsg.text}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            disabled={exportContacts.length === 0}
            onClick={handleExecuteExport}
            className={btnPrimary}
          >
            Export {exportContacts.length} Contact
            {exportContacts.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </section>
  );
}
