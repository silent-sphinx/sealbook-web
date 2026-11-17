// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import "../test/dom";
import { useItemSelection } from "./useItemSelection";

const item = (id: string) => ({ id });
const rows = ["a", "b", "c", "d"].map(item);

describe("useItemSelection", () => {
  it("toggles one item and reports selecting while any is picked", () => {
    const { result } = renderHook(() => useItemSelection(rows));
    expect(result.current.selecting).toBe(false);
    act(() => result.current.toggle(rows[1]!));
    expect(result.current.selecting).toBe(true);
    expect(result.current.selectedItems).toEqual([rows[1]]);
    act(() => result.current.toggle(rows[1]!));
    expect(result.current.selecting).toBe(false);
  });

  it("extends a run from the last item toggled, in either direction", () => {
    const { result } = renderHook(() => useItemSelection(rows));
    act(() => result.current.toggle(rows[3]!));
    act(() => result.current.toggle(rows[1]!, true));
    expect(result.current.selectedItems.map((entry) => entry.id)).toEqual(["b", "c", "d"]);
  });

  it("selects everything, then clears when all are picked", () => {
    const { result } = renderHook(() => useItemSelection(rows));
    act(() => result.current.toggleAll());
    expect(result.current.selected.size).toBe(4);
    act(() => result.current.toggleAll());
    expect(result.current.selecting).toBe(false);
  });

  it("drops what leaves the list", () => {
    const { result, rerender } = renderHook(({ items }) => useItemSelection(items), {
      initialProps: { items: rows },
    });
    act(() => result.current.toggleAll());
    rerender({ items: rows.slice(0, 2) });
    expect([...result.current.selected]).toEqual(["a", "b"]);
    rerender({ items: [] });
    expect(result.current.selecting).toBe(false);
  });

  it("clears on Escape, but not while paused", () => {
    const { result, rerender } = renderHook(({ paused }) => useItemSelection(rows, { paused }), {
      initialProps: { paused: true },
    });
    act(() => result.current.begin(rows[0]!));
    act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(result.current.selecting).toBe(true);
    rerender({ paused: false });
    act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(result.current.selecting).toBe(false);
  });

  it("leaves Ctrl+A to a text field", () => {
    const { result } = renderHook(() => useItemSelection(rows));
    const input = document.body.appendChild(document.createElement("input"));
    act(() => void input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true })));
    expect(result.current.selecting).toBe(false);
    act(() => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true })));
    expect(result.current.selected.size).toBe(4);
    input.remove();
  });
});
