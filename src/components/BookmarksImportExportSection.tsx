import { useId, useState } from "react";

import { putBookmark, putBookmarkCollection } from "../lib/bookmarkApi";
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
  importFolders,
  NO_FOLDERS,
  planBookmarkImport,
  type BookmarkImportResult,
} from "../lib/bookmarkExport";
import { btnPrimary, btnSecondary, fieldLabel, selectField } from "../lib/styles";
import { BookmarkFolderEditor } from "./BookmarkFolderEditor";
import { useExportPasswordConfirm } from "./ExportPasswordConfirm";
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
import type { Bookmark, BookmarkCollection } from "../lib/types";
import type { CoreBookmarkImportOptions } from "../lib/wasm";

const MAX_IMPORT_FILE_BYTES = 32 * 1024 * 1024;

type Props = {
  session: Session;
  bookmarks: Bookmark[];
  bookmarkCollections: BookmarkCollection[];
  onRefresh: () => Promise<void>;
  onCreateCollection?: (name: string) => Promise<string | undefined>;
};

export function BookmarksImportExportSection({
  session,
  bookmarks,
  bookmarkCollections,
  onRefresh,
  onCreateCollection,
}: Props) {
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
  const [importMsg, setImportMsg] = useState<Notice>(null);
  const [folderOptions, setFolderOptions] = useState<CoreBookmarkImportOptions>(NO_FOLDERS);

  const [exportCollectionFilter, setExportCollectionFilter] = useState<string>(ALL_COLLECTIONS);
  const [exportMsg, setExportMsg] = useState<Notice>(null);
  const passwordConfirm = useExportPasswordConfirm();

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
              ? `Nothing in "${file.name}" could be imported: every entry was missing a URL or was not a web page.`
              : `No bookmarks could be read from "${file.name}". Expected a browser bookmarks export, a Sealbook export or a JSON array of bookmarks.`,
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

  function resetImport() {
    setImportFile(null);
    setParsed(null);
    setProgress(null);
    setIsCreatingCollection(false);
    setNewCollectionName("");
    setFolderOptions(NO_FOLDERS);
  }

  async function runImport() {
    if (!parsed || !preview || preview.bookmarks.length === 0) return;
    setImporting(true);
    setImportMsg(null);
    setProgress({ current: 0, total: preview.bookmarks.length });
    try {
      let collectionId = targetCollectionId;
      if (isCreatingCollection && newCollectionName.trim() && onCreateCollection) {
        const created = await onCreateCollection(newCollectionName.trim());
        if (created) collectionId = created;
      }

      const plan = planBookmarkImport(parsed, bookmarkCollections, collectionId, folderOptions);
      for (const collection of plan.collections) {
        await putBookmarkCollection(session, collection.name, collection.parentId, collection.id);
      }
      for (let index = 0; index < plan.bookmarks.length; index += 1) {
        await putBookmark(session, plan.bookmarks[index]);
        setProgress({ current: index + 1, total: plan.bookmarks.length });
      }
      await onRefresh();

      const count = plan.bookmarks.length;
      const skipped = parsed.skipped;
      const made = plan.collections.length;
      const where = made > 0
        ? `${made} new collection${made === 1 ? "" : "s"}`
        : `"${collectionNameById(bookmarkCollections, collectionId) || newCollectionName.trim()}"`;
      setImportMsg({
        type: "success",
        text: `Imported ${count} bookmark${count === 1 ? "" : "s"} into ${where}.${
          skipped ? ` ${skipped} entries were missing a URL or not a web page, and skipped.` : ""
        }${plan.excluded ? ` ${plan.excluded} in skipped folders were left out.` : ""}`,
      });
      resetImport();
    } catch (err) {
      setImportMsg({
        type: "error",
        text: `Import stopped after ${progress?.current ?? 0} of ${preview?.bookmarks.length ?? parsed.bookmarks.length}: ${friendlyError(err)}`,
      });
      await onRefresh();
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  async function runExport() {
    if (exportBookmarks.length === 0) {
      setExportMsg({ type: "error", text: "No bookmarks to export in the selected collection." });
      return;
    }
    const problem = await passwordConfirm.confirm();
    if (problem !== null) {
      setExportMsg({ type: "error", text: problem });
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


  const folders = parsed?.hasFolders ? importFolders(parsed, folderOptions) : [];
  const preview = parsed
    ? planBookmarkImport(parsed, bookmarkCollections, targetCollectionId, folderOptions)
    : null;
  const summary = preview
    ? `${preview.bookmarks.length} bookmark${preview.bookmarks.length === 1 ? "" : "s"} will be imported` +
      (preview.collections.length > 0
        ? `, with ${preview.collections.length} new collection${preview.collections.length === 1 ? "" : "s"} made`
        : "") +
      (preview.excluded > 0 ? `. ${preview.excluded} in skipped folders will be left out` : "") +
      "."
    : "";

  const bookmarkCount = (count: number) => `${count} bookmark${count === 1 ? "" : "s"}`;
  const creating = isCreatingCollection || bookmarkCollections.length === 0;

  return (
    <>
      <SettingsGroup
        title="Import bookmarks"
        meta=".html, .json"
        description="Bring in the bookmarks file your browser exports, restore a Sealbook bookmark export, or use any JSON list of links."
      >
        {!importFile || !parsed ? (
          <FileDrop
            label="Choose a bookmarks file to import, or drop one here"
            accept=".html,.htm,.json,text/html,application/json"
            formats=".html, .json"
            hint="A bookmarks file exported from Firefox, Chrome, Safari or Edge, a Sealbook export, or a JSON array of objects with a URL field"
            onFile={handleFileRead}
          />
        ) : (
          <ImportReview
            fileName={importFile.name}
            summary={`${bookmarkCount(parsed.bookmarks.length)} found${
              parsed.skipped > 0 ? ` · ${parsed.skipped} entries skipped` : ""
            }`}
            busy={importing}
            onChangeFile={resetImport}
          >
            <TargetPicker
              id={`${ids}-target-collection`}
              label="Target collection"
              noun="collection"
              creating={creating}
              canCreate={Boolean(onCreateCollection)}
              onToggle={() => setIsCreatingCollection(!isCreatingCollection)}
              disabled={importing}
              name={newCollectionName}
              onName={setNewCollectionName}
              placeholder="e.g. Imported, Work, Reading list"
              value={targetCollectionId}
              onValue={setTargetCollectionId}
              options={bookmarkCollections}
            />
            {parsed.hasFolders ? (
              <>
                <BookmarkFolderEditor
                  id={`${ids}-folders`}
                  folders={folders}
                  options={folderOptions}
                  onOptions={setFolderOptions}
                  collections={bookmarkCollections}
                  disabled={importing}
                />
                <p className="text-xs text-mute" aria-live="polite">
                  {summary}
                </p>
              </>
            ) : null}
            <ImportPreview
              rows={parsed.bookmarks.slice(0, 3).map((draft) => ({ primary: draft.title, secondary: draft.url }))}
              total={parsed.bookmarks.length}
            />
            {importing ? <ImportProgress label="Encrypting and uploading bookmarks…" progress={progress} /> : null}
            <div className={actionRow}>
              <button type="button" disabled={importing} onClick={resetImport} className={btnSecondary}>
                Cancel
              </button>
              <button
                type="button"
                disabled={importing || !preview || preview.bookmarks.length === 0 || (isCreatingCollection && !newCollectionName.trim())}
                onClick={() => void runImport()}
                className={btnPrimary}
              >
                {importing
                  ? `Importing (${progress?.current ?? 0}/${preview?.bookmarks.length ?? 0})…`
                  : `Import ${bookmarkCount(preview?.bookmarks.length ?? 0)}`}
              </button>
            </div>
          </ImportReview>
        )}
        <NoticeLine notice={importMsg} />
      </SettingsGroup>

      <SettingsGroup
        title="Export bookmarks"
        meta={bookmarkCount(exportBookmarks.length)}
        description="A JSON backup that keeps collections, tags and notes, which you can restore here."
      >
        <div>
          <label htmlFor={`${ids}-source-collection`} className={fieldLabel}>
            Source collection
          </label>
          <select
            id={`${ids}-source-collection`}
            value={exportCollectionFilter}
            onChange={(event) => setExportCollectionFilter(event.target.value)}
            className={`${selectField} mt-1.5`}
          >
            <option value={ALL_COLLECTIONS}>All collections ({bookmarks.length})</option>
            {bookmarkCollections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name} ({bookmarks.filter((b) => b.collectionId === collection.id).length})
              </option>
            ))}
          </select>
        </div>
        {passwordConfirm.field}
        <NoticeLine notice={exportMsg} />
        <div className={actionRow}>
          <button type="button" disabled={exportBookmarks.length === 0 || !passwordConfirm.hasPassword} onClick={() => void runExport()} className={btnPrimary}>
            Export {bookmarkCount(exportBookmarks.length)}
          </button>
        </div>
      </SettingsGroup>
    </>
  );
}
