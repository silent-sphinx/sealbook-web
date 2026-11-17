import { searchClear, searchField, searchIcon } from "../lib/styles";
import { Icon } from "./Icon";

/** The search box in a notes pane's header, as the other tabs have it. */
export function NoteSearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="relative min-w-0 flex-1 sm:flex-none">
      <Icon name="search" className={searchIcon} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search notes"
        aria-label="Search notes"
        className={`${searchField} sm:w-52 sm:focus:w-72`}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className={searchClear}
          aria-label="Clear search"
          title="Clear search"
        >
          <Icon name="close" className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
