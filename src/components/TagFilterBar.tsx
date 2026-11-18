import { focusRing } from "../lib/styles";
import type { TagEntry } from "../lib/tags";

/** The tags in view as toggle chips with counts; `active` is the filtered tag's lowercase key. */
export function TagFilterBar({
  tags,
  active,
  onChange,
}: {
  tags: TagEntry[];
  active: string | null;
  onChange: (key: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const on = active === tag.key;
        return (
          <button
            key={tag.key}
            type="button"
            onClick={() => onChange(on ? null : tag.key)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${focusRing} ${
              on
                ? "border-accent-dim bg-accent/15 text-text"
                : "border-line bg-panel/60 text-text hover:border-line-light hover:bg-panel"
            }`}
          >
            <span className="font-medium">{tag.name}</span>
            <span className="text-[10px] tabular-nums text-mute">{tag.count}</span>
          </button>
        );
      })}
    </div>
  );
}
