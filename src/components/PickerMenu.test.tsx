// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "../test/dom";
import { PickerMenu, type PickerCreate, type PickerOption } from "./PickerMenu";

const few: PickerOption[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
];
const many: PickerOption[] = Array.from({ length: 12 }, (_, at) => ({ id: `n${at}`, name: `Item ${at}` }));

function mount(props: Partial<React.ComponentProps<typeof PickerMenu>> = {}) {
  const onPick = vi.fn<(id: string) => void>();
  render(
    <PickerMenu
      title="Move to"
      searchLabel="Find one"
      emptyNoun="items"
      options={few}
      onPick={onPick}
      trigger="Open"
      {...props}
    />,
  );
  return { onPick };
}

const open = () => fireEvent.click(screen.getByRole("button", { name: "Open" }));
const panel = () => within(screen.getByRole("dialog", { name: "Move to" }));

describe("PickerMenu", () => {
  it("opens on click and picks an option, closing after", () => {
    const { onPick } = mount();
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    fireEvent.click(panel().getByRole("button", { name: "Beta" }));
    expect(onPick).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    mount();
    open();
    fireEvent.keyDown(panel().getByRole("button", { name: "Alpha" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open" }));
  });

  it("closes on a press outside", () => {
    mount();
    open();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks the current option only when it is given a value", () => {
    mount({ value: "a" });
    open();
    expect(panel().getByRole("button", { name: "Alpha" }).getAttribute("aria-pressed")).toBe("true");
    expect(panel().getByRole("button", { name: "Beta" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("has no current option for an action picker", () => {
    mount();
    open();
    expect(panel().getByRole("button", { name: "Alpha" }).hasAttribute("aria-pressed")).toBe(false);
  });

  it("offers a filter box only past eight options, and says when nothing matches", () => {
    mount();
    open();
    expect(panel().queryByLabelText("Find one")).toBeNull();
    fireEvent.pointerDown(document.body);

    mount({ options: many });
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[1]!);
    const list = panel();
    fireEvent.change(list.getByLabelText("Find one"), { target: { value: "item 11" } });
    expect(list.getAllByRole("button", { name: /Item/ })).toHaveLength(1);
    fireEvent.change(list.getByLabelText("Find one"), { target: { value: "zzz" } });
    expect(list.getByText(/No items match "zzz"/)).not.toBeNull();
  });

  it("picks the first match on Enter in the filter box", () => {
    const { onPick } = mount({ options: many });
    open();
    const box = panel().getByLabelText("Find one");
    fireEvent.change(box, { target: { value: "item 7" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("n7");
  });

  it("moves focus through the rows with the arrow keys", () => {
    mount();
    open();
    const alpha = panel().getByRole("button", { name: "Alpha" });
    const beta = panel().getByRole("button", { name: "Beta" });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: "ArrowDown" });
    expect(document.activeElement).toBe(beta);
    fireEvent.keyDown(beta, { key: "ArrowDown" });
    expect(document.activeElement).toBe(alpha);
    fireEvent.keyDown(alpha, { key: "End" });
    expect(document.activeElement).toBe(beta);
    fireEvent.keyDown(beta, { key: "Home" });
    expect(document.activeElement).toBe(alpha);
  });

  it("clears the current value from the header", () => {
    const onClear = vi.fn();
    mount({ value: "a", onClear });
    open();
    fireEvent.click(panel().getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  describe("creating", () => {
    const create = (onCreate: PickerCreate["onCreate"]): PickerCreate => ({ label: "New thing", placeholder: "Name", onCreate });

    it("has no create row unless it is given a way to create", () => {
      mount();
      open();
      expect(panel().queryByRole("button", { name: /New thing/ })).toBeNull();
    });

    it("names a new item in a field, then picks it", async () => {
      const onCreate = vi.fn(async (_name: string): Promise<string | undefined> => "fresh");
      const { onPick } = mount({ create: create(onCreate) });
      open();
      fireEvent.click(panel().getByRole("button", { name: "New thing" }));
      const field = panel().getByLabelText("New thing");
      fireEvent.change(field, { target: { value: "  Gamma " } });
      fireEvent.submit(field.closest("form")!);
      await waitFor(() => expect(onPick).toHaveBeenCalledWith("fresh"));
      expect(onCreate).toHaveBeenCalledWith("Gamma");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("creates from what was typed in the filter when it names nothing that exists", async () => {
      const onCreate = vi.fn(async (_name: string): Promise<string | undefined> => "fresh");
      const { onPick } = mount({ options: many, create: create(onCreate) });
      open();
      fireEvent.change(panel().getByLabelText("Find one"), { target: { value: "Brand new" } });
      fireEvent.click(panel().getByRole("button", { name: 'Create "Brand new"' }));
      await waitFor(() => expect(onPick).toHaveBeenCalledWith("fresh"));
      expect(onCreate).toHaveBeenCalledWith("Brand new");
    });

    it("does not offer to create what already exists", () => {
      mount({ options: many, create: create(async () => "x") });
      open();
      fireEvent.change(panel().getByLabelText("Find one"), { target: { value: "item 3" } });
      expect(panel().queryByRole("button", { name: /^Create/ })).toBeNull();
    });

    it("stays open and says so when it could not create", async () => {
      const { onPick } = mount({ create: create(async () => undefined) });
      open();
      fireEvent.click(panel().getByRole("button", { name: "New thing" }));
      const field = panel().getByLabelText("New thing");
      fireEvent.change(field, { target: { value: "Gamma" } });
      fireEvent.submit(field.closest("form")!);
      expect((await panel().findByRole("alert")).textContent).toContain("Gamma");
      expect(onPick).not.toHaveBeenCalled();
    });

    it("steps back from the name field on Escape instead of closing", () => {
      mount({ create: create(async () => "x") });
      open();
      fireEvent.click(panel().getByRole("button", { name: "New thing" }));
      fireEvent.keyDown(panel().getByLabelText("New thing"), { key: "Escape" });
      expect(panel().getByRole("button", { name: "New thing" })).not.toBeNull();
    });
  });
});
