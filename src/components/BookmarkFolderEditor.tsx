import type { BookmarkCollection } from "../lib/types";
import { ALL_FOLDERS, NO_FOLDERS } from "../lib/bookmarkExport";
import { fieldBase, selectField, textAction } from "../lib/styles";
import {
  coreBookmarkImportWithFolder as withFolder,
  type CoreBookmarkImportOptions,
  type CoreFolderAction,
  type CoreImportFolder,
} from "../lib/wasm";

const PRESETS = [
  { label: "One collection", depth: NO_FOLDERS.depth },
  { label: "Top-level folders", depth: 1 },
  { label: "All folders", depth: ALL_FOLDERS },
] as const;

type ActionKind = CoreFolderAction["kind"];

const ACTION_LABELS: Record<ActionKind, string> = {
  collection: "Own collection",
  merge: "Merge into parent",
  skip: "Skip",
  existing: "Existing collection…",
};

type Props = {
  folders: CoreImportFolder[];
  options: CoreBookmarkImportOptions;
  onOptions: (options: CoreBookmarkImportOptions) => void;
  collections: BookmarkCollection[];
  disabled: boolean;
  /** Prefixes the ids of the controls. */
  id: string;
};

/**
 * Chooses what an import does with each folder of a browser's bookmarks file: a
 * preset for how deep folders become collections, then a rule per folder to
 * rename it, merge it into the folder above, skip it, or file it in a
 * collection that already exists.
 */
export function BookmarkFolderEditor({ folders, options, onOptions, collections, disabled, id }: Props) {
  const activePreset = options.rules.length === 0 ? PRESETS.find((p) => p.depth === options.depth) : undefined;

  return (
    <div className="space-y-3">
      <fieldset disabled={disabled} className="min-w-0">
        <legend className="text-xs font-medium text-mute">Folders in the file</legend>
        <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Folders in the file">
          {PRESETS.map((preset) => (
            <label
              key={preset.label}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-ring ${
                activePreset === preset ? "border-accent bg-accent/10 text-text" : "border-line text-mute hover:text-text"
              }`}
            >
              <input
                type="radio"
                name={`${id}-preset`}
                className="sr-only"
                checked={activePreset === preset}
                onChange={() => onOptions({ depth: preset.depth, rules: [] })}
              />
              {preset.label}
            </label>
          ))}
          {activePreset === undefined ? (
            <span className="flex items-center gap-2 px-1 text-xs text-mute">
              Custom
              <button type="button" className={textAction} onClick={() => onOptions({ depth: options.depth, rules: [] })}>
                Reset
              </button>
            </span>
          ) : null}
        </div>
      </fieldset>

      <ul className="divide-y divide-line rounded-lg border border-line bg-bg/60 text-xs" aria-label="Folders">
        {folders.map((folder) => {
          const key = folder.path.join("\u0000");
          const name = folder.path[folder.path.length - 1];
          const action = folder.action;
          const rowId = `${id}-${key.replace(/\W/g, "_")}`;
          return (
            <li
              key={key}
              className={`flex flex-wrap items-center gap-2 px-3 py-2 ${folder.excluded ? "opacity-50" : ""}`}
              style={{ paddingLeft: `${0.75 + (folder.path.length - 1) * 1.25}rem` }}
            >
              <span className="min-w-0 flex-1 basis-40">
                <span className="block truncate font-medium text-text" title={folder.path.join(" / ")}>
                  {name}
                </span>
                <span className="text-[11px] text-mute">
                  {folder.total} bookmark{folder.total === 1 ? "" : "s"}
                </span>
              </span>
              {action.kind === "collection" && !folder.excluded ? (
                <input
                  type="text"
                  aria-label={`Collection name for ${name}`}
                  placeholder={name}
                  value={action.name ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    onOptions(withFolder(options, folder.path, { kind: "collection", name: event.target.value }))
                  }
                  className={`${fieldBase} h-8 w-40 text-xs`}
                />
              ) : null}
              {action.kind === "existing" && !folder.excluded ? (
                <select
                  aria-label={`Collection for ${name}`}
                  value={action.collection_id}
                  disabled={disabled}
                  onChange={(event) =>
                    onOptions(withFolder(options, folder.path, { kind: "existing", collection_id: event.target.value }))
                  }
                  className={`${selectField} h-8 w-40 text-xs`}
                >
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <select
                id={rowId}
                aria-label={`What to do with ${name}`}
                value={action.kind}
                disabled={disabled || (folder.excluded && action.kind !== "skip")}
                onChange={(event) => {
                  const kind = event.target.value as ActionKind;
                  const next: CoreFolderAction =
                    kind === "existing"
                      ? { kind, collection_id: collections[0]?.id ?? "" }
                      : kind === "collection"
                        ? { kind, name: undefined }
                        : { kind };
                  onOptions(withFolder(options, folder.path, next));
                }}
                className={`${selectField} h-8 w-44 text-xs`}
              >
                {(Object.keys(ACTION_LABELS) as ActionKind[])
                  .filter((kind) => kind !== "existing" || collections.length > 0)
                  .map((kind) => (
                    <option key={kind} value={kind}>
                      {ACTION_LABELS[kind]}
                    </option>
                  ))}
              </select>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
