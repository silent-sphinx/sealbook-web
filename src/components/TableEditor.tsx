import { useState } from "react";

import type { MdAlign } from "../lib/markdown";
import {
  addColumn,
  addRow,
  canMergeRight,
  canSplit,
  columnOf,
  columns,
  deleteColumn,
  deleteRow,
  mergeRight,
  modelFromBlock,
  setAlign,
  setCellText,
  splitCell,
  type CellRef,
  type TableModel,
} from "../lib/tableEdit";
import { focusRing } from "../lib/styles";
import { Inline, type MdTableBlock } from "./Markdown";

type Props = {
  block: MdTableBlock;
  selected: CellRef | null;
  onSelect: (ref: CellRef | null) => void;
  onChange: (model: TableModel) => void;
  readOnly: boolean;
};

function Glyph({ d }: { d: string }) {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const ICON = {
  rowAbove: "M2.5 9.5h11M2.5 12.5h11M8 2v4M6 4h4",
  rowBelow: "M2.5 3.5h11M2.5 6.5h11M8 10v4M6 12h4",
  columnLeft: "M9.5 2.5v11M12.5 2.5v11M2 8h4M4 6v4",
  columnRight: "M3.5 2.5v11M6.5 2.5v11M10 8h4M12 6v4",
  rowDelete: "M2.5 4.5h11M2.5 11.5h11M4 6.5 12 9.5M12 6.5 4 9.5",
  columnDelete: "M4.5 2.5v11M11.5 2.5v11M6.5 4 9.5 12M9.5 4 6.5 12",
  merge: "M2.5 3.5h11v9h-11zM8 3.5v1.75M8 10.75v1.75",
  split: "M2.5 3.5h11v9h-11zM8 3.5v9",
  alignLeft: "M2.5 4h11M2.5 8h7M2.5 12h9",
  alignCenter: "M2.5 4h11M4.5 8h7M3.5 12h9",
  alignRight: "M2.5 4h11M6.5 8h7M4.5 12h9",
};

const ALIGNMENTS: { value: MdAlign; icon: keyof typeof ICON; label: string }[] = [
  { value: "left", icon: "alignLeft", label: "Align column left" },
  { value: "center", icon: "alignCenter", label: "Align column centre" },
  { value: "right", icon: "alignRight", label: "Align column right" },
];

function Tool({
  icon,
  label,
  disabled,
  active,
  onClick,
}: {
  icon: keyof typeof ICON;
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${active ? "bg-surface text-note" : "text-mute hover:bg-surface hover:text-text"} ${focusRing}`}
    >
      <Glyph d={ICON[icon]} />
    </button>
  );
}

/**
 * A table the reader can restructure: pick a cell, then add or remove its row
 * and column, merge it rightwards, or retype its markdown.
 *
 * Merging is column-only because the stored note is markdown. A merged cell is
 * written as a doubled pipe, which a reader without that extension shows as one
 * extra empty cell rather than losing the text.
 */
export function TableEditor({ block, selected, onSelect, onChange, readOnly }: Props) {
  const model = modelFromBlock(block);
  const rows = model.rows;
  const active = selected && rows[selected.row]?.[selected.cell] ? selected : null;
  // What is being typed, against the cell it belongs to. Keyed rather than kept
  // in an effect so that reading the text back through markdown, which trims it,
  // cannot move the caret mid-word.
  const [typing, setTyping] = useState<{ at: string; text: string } | null>(null);
  const at = active ? `${active.row}:${active.cell}` : "";
  const buffer =
    typing?.at === at ? typing.text : active ? rows[active.row][active.cell].text : "";

  const column = active ? columnOf(rows[active.row], active.cell) : 0;
  const editable = !readOnly;

  function apply(next: TableModel, moveTo?: CellRef | null) {
    onChange(next);
    if (moveTo !== undefined) onSelect(moveTo);
  }

  return (
    <div className="md-table-shell">
      {active && editable ? (
        <div className="md-table-tools" role="toolbar" aria-label="Table">
          <Tool icon="rowAbove" label="Add row above" onClick={() => apply(addRow(model, Math.max(active.row, 1)))} />
          <Tool icon="rowBelow" label="Add row below" onClick={() => apply(addRow(model, active.row + 1))} />
          <Tool
            icon="rowDelete"
            label="Delete row"
            disabled={active.row === 0}
            onClick={() => apply(deleteRow(model, active.row), null)}
          />
          <span className="md-table-tools-divider" aria-hidden="true" />
          <Tool icon="columnLeft" label="Add column left" onClick={() => apply(addColumn(model, column))} />
          <Tool icon="columnRight" label="Add column right" onClick={() => apply(addColumn(model, column + rows[active.row][active.cell].span))} />
          <Tool
            icon="columnDelete"
            label="Delete column"
            disabled={columns(model) <= 1}
            onClick={() => apply(deleteColumn(model, column), null)}
          />
          <span className="md-table-tools-divider" aria-hidden="true" />
          <Tool
            icon="merge"
            label="Merge with cell on the right"
            disabled={!canMergeRight(model, active)}
            onClick={() => apply(mergeRight(model, active))}
          />
          <Tool
            icon="split"
            label="Split merged cell"
            disabled={!canSplit(model, active)}
            onClick={() => apply(splitCell(model, active))}
          />
          <span className="md-table-tools-divider" aria-hidden="true" />
          {ALIGNMENTS.map((item) => (
            <Tool
              key={item.label}
              icon={item.icon}
              label={item.label}
              active={model.align[column] === item.value}
              onClick={() =>
                apply(setAlign(model, column, model.align[column] === item.value ? null : item.value))
              }
            />
          ))}
        </div>
      ) : null}

      <div className="md-table">
        <table>
          <thead>{renderRow(0)}</thead>
          <tbody>{rows.slice(1).map((_, index) => renderRow(index + 1))}</tbody>
        </table>
      </div>
    </div>
  );

  function renderRow(rowIndex: number) {
    const row = rows[rowIndex];
    const Tag = rowIndex === 0 ? "th" : "td";
    return (
      <tr key={rowIndex}>
        {row.map((cell, cellIndex) => {
          const ref = { row: rowIndex, cell: cellIndex };
          const isActive = active?.row === rowIndex && active.cell === cellIndex;
          return (
            <Tag
              key={cellIndex}
              colSpan={cell.span > 1 ? cell.span : undefined}
              data-align={model.align[columnOf(row, cellIndex)] ?? undefined}
              data-selected={isActive || undefined}
              scope={rowIndex === 0 ? "col" : undefined}
              tabIndex={editable ? 0 : undefined}
              aria-selected={editable ? isActive : undefined}
              onClick={editable ? () => onSelect(ref) : undefined}
              onFocus={editable ? () => onSelect(ref) : undefined}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  onSelect(null);
                }
              }}
            >
              {isActive && editable ? (
                <input
                  value={buffer}
                  onChange={(event) => {
                    setTyping({ at, text: event.target.value });
                    onChange(setCellText(model, ref, event.target.value));
                  }}
                  aria-label={`Row ${rowIndex + 1}, column ${columnOf(row, cellIndex) + 1}`}
                  autoFocus
                  className="w-full min-w-0 border-0 bg-transparent p-0 text-inherit outline-none"
                />
              ) : (
                <Inline nodes={parsedOf(block, rowIndex, cellIndex)} />
              )}
            </Tag>
          );
        })}
      </tr>
    );
  }
}

/** The parsed inlines for a cell, which the model itself does not carry. */
function parsedOf(block: MdTableBlock, row: number, cell: number) {
  const cells = row === 0 ? block.header : block.rows[row - 1];
  return cells?.[cell]?.children ?? [];
}
