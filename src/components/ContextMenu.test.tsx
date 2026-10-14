// @vitest-environment jsdom
/**
 * The sidebar row context menu.
 *
 * On a pointer device this is the only way to reach a row's actions: the row's
 * own icon buttons are hidden by `.list-row-actions` under `(hover: hover)`. So
 * the cases that matter are the ones where the menu would otherwise be
 * unreachable or would not go away.
 */
import "../test/dom";

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";

function Harness({ items }: { items: MenuItem[] }) {
  const menu = useContextMenu();
  const [opened, setOpened] = useState(0);
  return (
    <div>
      <ContextMenu state={menu.menu} onClose={menu.close} />
      <div
        data-testid="row"
        onContextMenu={(event) => {
          setOpened((count) => count + 1);
          menu.open(event, items);
        }}
      >
        A row
      </div>
      <span data-testid="opened">{opened}</span>
    </div>
  );
}

function openAt(x = 40, y = 60) {
  fireEvent.contextMenu(screen.getByTestId("row"), { clientX: x, clientY: y });
}

describe("the row context menu", () => {
  it("opens on right-click and runs the action that is chosen", () => {
    const rename = vi.fn();
    render(<Harness items={[{ label: "Rename", onSelect: rename }]} />);
    expect(screen.queryByRole("menu")).toBeNull();

    openAt();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    expect(rename).toHaveBeenCalledTimes(1);
    // Closed by the choice, rather than left over the row it acted on.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape without running anything", () => {
    const remove = vi.fn();
    render(<Harness items={[{ label: "Delete", onSelect: remove, danger: true }]} />);
    openAt();
    expect(screen.getByRole("menu")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it("closes when something else is pressed", () => {
    render(<Harness items={[{ label: "Rename", onSelect: vi.fn() }]} />);
    openAt();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("will not run a disabled action", () => {
    const archive = vi.fn();
    render(
      <Harness
        items={[
          { label: "Archive", onSelect: archive, disabled: true, disabledReason: "Your only one" },
        ]}
      />,
    );
    openAt();
    const item = screen.getByRole("menuitem", { name: "Archive" }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.getAttribute("title")).toBe("Your only one");
    fireEvent.click(item);
    expect(archive).not.toHaveBeenCalled();
  });

  it("opens nothing for a row with no actions, leaving the browser's own menu", () => {
    render(<Harness items={[]} />);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    screen.getByTestId("row").dispatchEvent(event);
    expect(screen.queryByRole("menu")).toBeNull();
    // Not prevented, so a read-only row still gets the browser's menu.
    expect(event.defaultPrevented).toBe(false);
  });

  it("opens from the keyboard, where the event carries no pointer", () => {
    // The Menu key and Shift+F10 raise `contextmenu` with zeroed coordinates.
    // Without this the menu would be pinned to the top-left corner and the
    // actions would be unreachable without a mouse.
    render(<Harness items={[{ label: "Rename", onSelect: vi.fn() }]} />);
    openAt(0, 0);
    const menu = screen.getByRole("menu");
    expect(menu).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
  });

  it("moves between items with the arrow keys", () => {
    render(
      <Harness
        items={[
          { label: "Rename", onSelect: vi.fn() },
          { label: "Delete", onSelect: vi.fn(), danger: true },
        ]}
      />,
    );
    openAt();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));

    // Wraps, so the list cannot be walked off the end.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));
  });
});
