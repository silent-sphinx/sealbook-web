import { btnSecondarySm } from "../lib/styles";
import type { TagEntry } from "../lib/tags";
import { Icon } from "./Icon";
import { PickerMenu } from "./PickerMenu";

/**
 * A header button that opens a scrollable, searchable list of the tags in view.
 * `active` is the filtered tag's lowercase key.
 */
export function TagFilterMenu({
  tags,
  active,
  onChange,
}: {
  tags: TagEntry[];
  active: string | null;
  onChange: (key: string | null) => void;
}) {
  const activeName = tags.find((tag) => tag.key === active)?.name;
  return (
    <PickerMenu
      title="Filter by tag"
      searchLabel="Find a tag"
      emptyNoun="tags"
      options={tags.map((tag) => ({ id: tag.key, name: tag.name, count: tag.count, glyph: "#" }))}
      value={active}
      // Picking the filtered tag again turns the filter off.
      onPick={(key) => onChange(key === active ? null : key)}
      onClear={() => onChange(null)}
      triggerClassName={`${btnSecondarySm} ${active ? "border-accent-dim bg-accent-soft text-text" : ""}`}
      trigger={
        <>
          <span className="max-w-32 truncate">{activeName ? `Tag: ${activeName}` : "Tags"}</span>
          {activeName ? null : <span className="text-2xs tabular-nums text-faint">{tags.length}</span>}
          <Icon name="chevron" className="h-3 w-3 rotate-90" />
        </>
      }
    />
  );
}
