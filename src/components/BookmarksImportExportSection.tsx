import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { putBookmark } from "../lib/bookmarkApi";
import type { Session } from "../lib/client";
import { friendlyError } from "../lib/errors";
import { triggerDownload } from "../lib/importExport";
import {
  ALL_COLLECTIONS,
  collectionNameById,
  DEFAULT_BOOKMARK_COLLECTION_ID,
  sortBookmarks,
} from "../lib/bookmark";
import {
  generateBookmarkExportData,
  parseBookmarkImport,
  type BookmarkImportResult,
} from "../lib/bookmarkExport";
import { btnPrimary, btnSecondary, field, focusRing, selectField } from "../lib/styles";
import type { Bookmark, BookmarkCollection, BookmarkDraft } from "../lib/types";

const MAX_IMPORT_FILE_BYTES = 32 * 1024 * 1024;

type Props = {
  session: Session;
  bookmarks: Bookmark[];
  bookmarkCollections: BookmarkCollection[];
  onRefresh: () => Promise<void>;
  onCreateCollection?: (name: string) => Promise<string | undefined>;
};

type Message = { type: "success" | "error"; text: string } | null;

export function BookmarksImportExportSection({
  session,
  bookmarks,
  bookmarkCollections,
  onRefresh,
  onCreateCollection,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importFile, setImportFile] = useState<{ name: string; size: number } | null>(null);
  const [parsed, setParsed] = useState<BookmarkImportResult | null>(null);
  const [targetCollectionId, setTargetCollectionId] = useState<string>(
    bookmarkCollections[0]?.id ?? DEFAULT_BOOKMARK_COLLECTION_ID,
  );
  const ids = useId();
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [importMsg, setImportMsg] = useState<Message>(null);

  const [exportCollectionFilter, setExportCollectionFilter] = useState<string>(ALL_COLLECTIONS);
  const [exportMsg, setExportMsg] = useState<Message>(null);

  const exportBookmarks = sortBookmarks(
    exportCollectionFilter === ALL_COLLECTIONS
      ? bookmarks
      : bookmarks.filter((b) => b.collectionId === exportCollectionFilter),
  );

  function handleFileRead(file: File) {
    setImportMsg(null);
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setImportMsg({ type: "error", text: "Import files must be 32 MB or smaller." });
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
        const result = parseBookmarkImport(content, targetCollectionId);
        if (result.bookmarks.length === 0) {
          setImportMsg({
            type: "error",
            text: result.skipped > 0
              ? `Every entry in "${file.name}" was missing a URL and title.`
              : `No bookmarks could be read from "${file.name}". Expected a Sealbook export or a JSON array of bookmarks.`,
          });
          return;
        }
        setImportFile({ name: file.name, size: file.size });
        setParsed(result);
      } catch (err) {
        setImportMsg({ type: "error", text: `Failed to read file: ${friendlyError(err)}` });
      }
    };
    reader.onerror = () => setImportMsg({ type: "error", text: "Failed to read file from disk." });
    reader.readAsText(file);
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) handleFileRead(file);
    event.target.value = "";
  }

  function handleDrag(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(event.type === "dragenter" || event.type === "dragover");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFileRead(file);
  }

  function resetImport() {
    setImportFile(null);
    setParsed(null);
    setProgress(null);
    setIsCreatingCollection(false);
    setNewCollectionName("");
  }

  async function runImport() {
    if (!parsed || parsed.bookmarks.length === 0) return;
    setImporting(true);
    setImportMsg(null);
    setProgress({ current: 0, total: parsed.bookmarks.length });
    try {
      let collectionId = targetCollectionId;
      if (isCreatingCollection && newCollectionName.trim() && onCreateCollection) {
        const created = await onCreateCollection(newCollectionName.trim());
        if (created) collectionId = created;
      }

      for (let index = 0; index < parsed.bookmarks.length; index += 1) {
        const draft: BookmarkDraft = { ...parsed.bookmarks[index], collectionId };
        await putBookmark(session, draft);
        setProgress({ current: index + 1, total: parsed.bookmarks.length });
      }
      await onRefresh();

      const count = parsed.bookmarks.length;
      const skipped = parsed.skipped;
      const name = collectionNameById(bookmarkCollections, collectionId);
      setImportMsg({
        type: "success",
        text: `Imported ${count} bookmark${count === 1 ? "" : "s"} into "${name}".${
          skipped ? ` ${skipped} entries were missing a URL and skipped.` : ""
        }`,
      });
      resetImport();
    } catch (err) {
      setImportMsg({
        type: "error",
        text: `Import stopped after ${progress?.current ?? 0} of ${parsed.bookmarks.length}: ${friendlyError(err)}`,
      });
      await onRefresh();
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  function runExport() {
    if (exportBookmarks.length === 0) {
      setExportMsg({ type: "error", text: "No bookmarks to export in the selected collection." });
      return;
    }
    setExportMsg(null);
    try {
      const { filename, mime, data } = generateBookmarkExportData(
        exportBookmarks,
        bookmarkCollections,
      );
      triggerDownload(filename, mime, data);
      setExportMsg({
        type: "success",
        text: `Exported ${exportBookmarks.length} bookmark${exportBookmarks.length === 1 ? "" : "s"} as "${filename}".`,
      });
    } catch (err) {
      setExportMsg({ type: "error", text: `Export failed: ${friendlyError(err)}` });
    }
  }

  const banner = (message: Message) =>
    message ? (
      <div
        className={`rounded-lg px-3 py-2 text-xs font-medium ${
          message.type === "success"
            ? "bg-accent/10 text-accent border border-accent/20"
            : "bg-danger/10 text-danger border border-danger/20"
        }`}
      >
        {message.text}
      </div>
    ) : null;

  return (
    <section className="rounded-2xl border border-line bg-panel/75 backdrop-blur-md p-6 shadow-sm space-y-8">
      <div>
        <h3 className="text-base font-semibold text-text">Import &amp; Export Bookmarks</h3>
        <p className="mt-1 text-xs text-mute leading-relaxed">
          Move bookmarks in and out of Sealbook as a JSON backup that keeps collections,
          tags and notes intact.
        </p>
      </div>

      <div className="rounded-xl border border-line/80 bg-bg/50 p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
              ↓
            </span>
            <h4 className="text-sm font-semibold text-text">Import Bookmarks</h4>
          </div>
          <span className="text-[11px] text-mute font-mono">.json</span>
        </div>

        {!importFile || !parsed ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a bookmarks file to import, or drop one here"
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              fileInputRef.current?.click();
            }}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-7 text-center transition-all cursor-pointer ${focusRing} ${
              dragActive
                ? "border-accent bg-accent/10 scale-[0.99]"
                : "border-line/80 hover:border-line-light hover:bg-surface/30"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={onFileInputChange}
              className="hidden"
            />
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface border border-line text-accent mb-2">
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.56l2.22 2.22a.75.75 0 1 0 1.06-1.06l-3.5-3.5a.75.75 0 0 0-1.06 0l-3.5 3.5a.75.75 0 0 0 1.06 1.06l2.22-2.22v8.69ZM3.5 14.25a.75.75 0 0 1 .75.75v1.5c0 .414.336.75.75.75h10a.75.75 0 0 0 .75-.75V15a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 15 18.75H5A2.25 2.25 0 0 1 2.75 16.5V15a.75.75 0 0 1 .75-.75Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-xs font-medium text-text">Click to select a file or drag it here</p>
            <p className="mt-1 text-[11px] text-mute">
              A Sealbook bookmark export (.json), or any JSON array of objects with a URL field
            </p>
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-accent/30 bg-surface/40 p-4 animate-fade-in">
            <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-3">
              <div>
                <p className="text-xs font-semibold text-text truncate max-w-xs sm:max-w-sm">
                  {importFile.name}
                </p>
                <p className="text-[11px] text-accent font-medium mt-0.5">
                  {parsed.bookmarks.length} bookmark{parsed.bookmarks.length === 1 ? "" : "s"} found
                  {parsed.skipped > 0 ? ` · ${parsed.skipped} entries skipped` : ""}
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

            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <label htmlFor={`${ids}-target-collection`} className="text-xs font-medium text-text">
                  Target collection
                </label>
                {onCreateCollection ? (
                  <button
                    type="button"
                    disabled={importing}
                    onClick={() => setIsCreatingCollection(!isCreatingCollection)}
                    className="text-[11px] text-accent hover:underline cursor-pointer"
                  >
                    {isCreatingCollection ? "Select existing collection" : "+ Create new collection"}
                  </button>
                ) : null}
              </div>
              {isCreatingCollection || bookmarkCollections.length === 0 ? (
                <input
                  id={`${ids}-target-collection`}
                  type="text"
                  value={newCollectionName}
                  onChange={(event) => setNewCollectionName(event.target.value)}
                  placeholder="e.g. Imported, Work, Reading list"
                  className={field}
                  disabled={importing}
                  autoFocus
                />
              ) : (
                <select
                  id={`${ids}-target-collection`}
                  value={targetCollectionId}
                  onChange={(event) => setTargetCollectionId(event.target.value)}
                  disabled={importing}
                  className={selectField}
                >
                  {bookmarkCollections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="rounded-lg border border-line/70 bg-bg/70 p-3">
              <p className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                Preview (first {Math.min(parsed.bookmarks.length, 3)} of {parsed.bookmarks.length})
              </p>
              <div className="space-y-1.5 text-xs">
                {parsed.bookmarks.slice(0, 3).map((draft, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between gap-3 py-1 border-b border-line/40 last:border-0"
                  >
                    <span className="font-medium text-text truncate max-w-[160px]">
                      {draft.title}
                    </span>
                    <span className="text-mute truncate max-w-[180px] text-[11px] font-mono">
                      {draft.url}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {importing && progress ? (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] text-mute">
                  <span>Encrypting &amp; uploading bookmarks…</span>
                  <span className="font-mono font-medium text-accent">
                    {progress.current} / {progress.total}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface border border-line">
                  <div
                    className="h-full bg-accent transition-all duration-150"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="flex justify-end gap-2.5 pt-2">
              <button type="button" disabled={importing} onClick={resetImport} className={btnSecondary}>
                Cancel
              </button>
              <button
                type="button"
                disabled={importing || (isCreatingCollection && !newCollectionName.trim())}
                onClick={() => void runImport()}
                className={btnPrimary}
              >
                {importing
                  ? `Importing (${progress?.current ?? 0}/${parsed.bookmarks.length})…`
                  : `Import ${parsed.bookmarks.length} bookmark${parsed.bookmarks.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}

        {banner(importMsg)}
      </div>

      <div className="rounded-xl border border-line/80 bg-bg/50 p-5 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent/15 text-accent text-xs font-bold">
              ↑
            </span>
            <h4 className="text-sm font-semibold text-text">Export Bookmarks</h4>
          </div>
          <span className="text-[11px] text-mute font-mono">
            {exportBookmarks.length} bookmark{exportBookmarks.length === 1 ? "" : "s"}
          </span>
        </div>

        <div>
          <label htmlFor={`${ids}-source-collection`} className="block text-xs font-medium text-text mb-1">
            Source collection
          </label>
          <select
            id={`${ids}-source-collection`}
            value={exportCollectionFilter}
            onChange={(event) => setExportCollectionFilter(event.target.value)}
            className={selectField}
          >
            <option value={ALL_COLLECTIONS}>All collections ({bookmarks.length})</option>
            {bookmarkCollections.map((collection) => {
              const count = bookmarks.filter((b) => b.collectionId === collection.id).length;
              return (
                <option key={collection.id} value={collection.id}>
                  {collection.name} ({count})
                </option>
              );
            })}
          </select>
        </div>

        {banner(exportMsg)}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            disabled={exportBookmarks.length === 0}
            onClick={runExport}
            className={btnPrimary}
          >
            Export {exportBookmarks.length} bookmark{exportBookmarks.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </section>
  );
}
