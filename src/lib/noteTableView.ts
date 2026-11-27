/**
 * A note table drawn to its column shares, and resized by dragging the line
 * between two columns.
 *
 * ProseMirror's own column resizing stores pixels for the column dragged. A note
 * is read on screens of every width, so what is stored here is each column's
 * share, in the cells' `colwidth`, and the pixels are worked out on each screen.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { cellAround, TableMap } from "@tiptap/pm/tables";
import type { EditorView, NodeView, ViewMutationRecord } from "@tiptap/pm/view";

/** The narrowest a column is drawn, where there is room for every one to be. */
const COMFORTABLE = 64;
/** The narrowest with many columns, past which the table scrolls sideways. */
const NARROWEST = 48;
/** How close to a line between columns the pointer takes hold of it. */
const GRIP = 5;

function minimumWidth(columns: number, available: number): number {
  return Math.min(COMFORTABLE, Math.max(NARROWEST, available / columns));
}

/**
 * Pixel widths for columns with these shares, 0 standing for none. Android and
 * the desktop app size columns by the same rule.
 */
export function fitColumns(shares: number[], available: number): number[] {
  const count = shares.length;
  const minimum = minimumWidth(count, available);
  if (count * minimum >= available) return shares.map(() => minimum);

  const listed = shares.filter((share) => share > 0);
  const average = listed.length > 0 ? listed.reduce((a, b) => a + b, 0) / listed.length : 1;
  const weights = shares.map((share) => share || average);
  // Columns too narrow at their share are held at the minimum, and the rest
  // share what is left.
  const held = new Set<number>();
  for (;;) {
    const spare = available - held.size * minimum;
    const total = weights.reduce((sum, weight, i) => (held.has(i) ? sum : sum + weight), 0);
    const width = (i: number) => (held.has(i) ? minimum : (spare * weights[i]) / total);
    const narrow = weights.map((_, i) => i).filter((i) => !held.has(i) && width(i) < minimum);
    if (narrow.length === 0) return weights.map((_, i) => width(i));
    for (const i of narrow) held.add(i);
  }
}

/** The widths after the line before column `line` moves by `by`, which only its two neighbours feel. */
export function moveLine(widths: number[], line: number, by: number): number[] {
  const total = widths.reduce((a, b) => a + b, 0);
  const minimum = minimumWidth(widths.length, total);
  const pair = widths[line - 1] + widths[line];
  const left = Math.min(Math.max(widths[line - 1] + by, minimum), Math.max(pair - minimum, minimum));
  const out = [...widths];
  out[line - 1] = left;
  out[line] = pair - left;
  return out;
}

/** Shares in thousandths for columns drawn at these widths. */
export function sharesOf(widths: number[]): number[] {
  const total = widths.reduce((a, b) => a + b, 0);
  return widths.map((width) => Math.max(1, Math.round((width / total) * 1000)));
}

/** Each column's share as the first cell covering it gives it, 0 for none. */
export function columnShares(table: ProseMirrorNode): number[] {
  const map = TableMap.get(table);
  return Array.from({ length: map.width }, (_, column) => {
    for (let row = 0; row < map.height; row += 1) {
      const position = map.map[row * map.width + column];
      const share = table.nodeAt(position)?.attrs.colwidth?.[column - map.colCount(position)];
      if (share > 0) return share as number;
    }
    return 0;
  });
}

/** The document position of the table holding `cell`, and the columns the cell covers. */
function placeOfCell(view: EditorView, cell: Element) {
  const $cell = cellAround(view.state.doc.resolve(view.posAtDOM(cell, 0)));
  if ($cell === null) return null;
  const table = $cell.node(-1);
  const start = $cell.start(-1);
  const { left, right } = TableMap.get(table).findCell($cell.pos - start);
  return { table, start, left, right };
}

/** Gives every cell of the table at `start` its columns' shares, or none. */
export function setColumnShares(view: EditorView, table: ProseMirrorNode, start: number, shares: number[] | null) {
  const map = TableMap.get(table);
  const tr = view.state.tr;
  for (const position of new Set(map.map)) {
    const { left, right } = map.findCell(position);
    tr.setNodeAttribute(start + position, "colwidth", shares ? shares.slice(left, right) : null);
  }
  view.dispatch(tr);
}

export class ShareTableView implements NodeView {
  dom: HTMLDivElement;
  contentDOM: HTMLTableSectionElement;
  private table: HTMLTableElement;
  private colgroup: HTMLTableColElement;
  private observer: ResizeObserver | null = null;
  private dragging = false;
  private node: ProseMirrorNode;
  private view: EditorView;

  constructor(node: ProseMirrorNode, _cellMinWidth: number, view: EditorView) {
    this.node = node;
    this.view = view;
    this.dom = document.createElement("div");
    this.dom.className = "tableWrapper";
    this.table = this.dom.appendChild(document.createElement("table"));
    this.colgroup = this.table.appendChild(document.createElement("colgroup"));
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));
    this.layout();
    // The width is not known until the wrapper is in the page, and changes with it.
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => {
        if (!this.dragging) this.layout();
      });
      this.observer.observe(this.dom);
    }
    this.dom.addEventListener("pointermove", this.hover);
    this.dom.addEventListener("pointerdown", this.press);
    this.dom.addEventListener("dblclick", this.even);
  }

  update(node: ProseMirrorNode) {
    if (!node.sameMarkup(this.node)) return false;
    this.node = node;
    this.layout();
    return true;
  }

  destroy() {
    this.observer?.disconnect();
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return mutation.type !== "selection" && !this.contentDOM.contains(mutation.target);
  }

  /** The room for columns: the outer border is drawn outside them. */
  private room() {
    return Math.max(this.dom.clientWidth - 1, 0);
  }

  private layout() {
    const shares = columnShares(this.node);
    const sized = shares.some((share) => share > 0) && this.room() > 0;
    this.draw(shares.length, sized ? fitColumns(shares, this.room()) : null);
  }

  /** `null` leaves the columns to the stylesheet, which makes them equal. */
  private draw(count: number, widths: number[] | null) {
    while (this.colgroup.children.length < count) this.colgroup.appendChild(document.createElement("col"));
    while (this.colgroup.children.length > count) this.colgroup.lastElementChild?.remove();
    Array.from(this.colgroup.children as HTMLCollectionOf<HTMLTableColElement>).forEach((col, i) => {
      col.style.width = widths ? `${widths[i]}px` : "";
    });
    this.table.style.width = widths ? `${widths.reduce((a, b) => a + b, 0)}px` : "";
    this.table.style.minWidth = widths ? "" : `${count * NARROWEST}px`;
  }

  /** The line between two columns under the pointer, named by the column after it. */
  private lineAt(event: MouseEvent) {
    const cell = (event.target as Element).closest?.("td, th");
    if (!this.view.editable || !cell || !this.contentDOM.contains(cell)) return null;
    const box = cell.getBoundingClientRect();
    const onLeft = event.clientX - box.left <= GRIP;
    if (!onLeft && box.right - event.clientX > GRIP) return null;
    const place = placeOfCell(this.view, cell);
    if (place === null) return null;
    const line = onLeft ? place.left : place.right;
    const count = TableMap.get(place.table).width;
    return line > 0 && line < count ? { ...place, line, count } : null;
  }

  private hover = (event: PointerEvent) => {
    if (this.dragging) return;
    this.dom.classList.toggle("resize-cursor", event.pointerType !== "touch" && this.lineAt(event) !== null);
  };

  private even = (event: MouseEvent) => {
    const at = this.lineAt(event);
    if (at === null) return;
    event.preventDefault();
    setColumnShares(this.view, at.table, at.start, null);
  };

  private press = (event: PointerEvent) => {
    // A finger on a line is scrolling far more often than it is resizing.
    if (event.button !== 0 || event.pointerType === "touch") return;
    const at = this.lineAt(event);
    if (at === null) return;
    // Also stops the mouse events that would start a text or cell selection.
    event.preventDefault();
    const shares = columnShares(this.node);
    const total = this.table.getBoundingClientRect().width;
    const before = shares.some((share) => share > 0)
      ? fitColumns(shares, this.room())
      : shares.map(() => total / at.count);
    const from = event.clientX;
    let widths: number[] | null = null;
    this.dragging = true;

    const move = (next: PointerEvent) => {
      widths = moveLine(before, at.line, next.clientX - from);
      this.draw(at.count, widths);
    };
    const finish = (next: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      this.dragging = false;
      // The note may have changed while the line was held.
      const unchanged = this.view.state.doc.nodeAt(at.start - 1) === at.table;
      if (next.type === "pointerup" && widths !== null && next.clientX !== from && unchanged) {
        setColumnShares(this.view, at.table, at.start, sharesOf(widths));
      } else {
        this.layout();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
}
