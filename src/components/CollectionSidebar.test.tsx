// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "../test/dom";
import { CollectionSidebar, type SidebarCollection } from "./CollectionSidebar";

const COLLECTIONS: SidebarCollection[] = [
  { id: "root", name: "Root" },
  { id: "mid", name: "Mid", parentId: "root" },
  { id: "leaf", name: "Leaf", parentId: "mid" },
  { id: "other", name: "Other" },
];

function mount(
  overrides: Partial<Parameters<typeof CollectionSidebar<SidebarCollection>>[0]> = {},
) {
  const props = {
    collections: COLLECTIONS,
    selectedId: "leaf",
    onSelect: vi.fn<(id: string) => void>(),
    icon: "tasks" as const,
    kindLabel: "list",
    subLabel: "sublist",
    tone: () => "#123456",
    protectedId: "root",
    counts: new Map<string, number>(),
    creating: false,
    onCreateHandled: vi.fn<() => void>(),
    onCreate: vi.fn<(name: string, parentId?: string) => void>(),
    onRename: vi.fn<(collection: SidebarCollection, name: string) => void>(),
    onDelete: vi.fn<(collection: SidebarCollection) => void>(),
    onRecolor: vi.fn<(collection: SidebarCollection, color: string) => void>(),
    canMove: () => true,
    onMove: vi.fn<(id: string, parentId: string | null) => void>(),
    renderContents: (collection: SidebarCollection) => <p>contents of {collection.name}</p>,
    ...overrides,
  };
  render(<CollectionSidebar {...props} />);
  return props;
}

const rowOf = (name: string) => screen.getByRole("button", { name }).closest(".list-row") as HTMLElement;

describe("CollectionSidebar", () => {
  it("opens the selected collection and every ancestor, and nothing else", () => {
    mount();
    expect(screen.getByText("contents of Root")).not.toBeNull();
    expect(screen.getByText("contents of Mid")).not.toBeNull();
    expect(screen.getByText("contents of Leaf")).not.toBeNull();
    expect(screen.queryByText("contents of Other")).toBeNull();
  });

  it("opens only a collection with something under it", () => {
    mount({ renderContents: undefined, selectedId: "other" });
    expect(rowOf("Other").parentElement!.children).toHaveLength(1);
  });

  it("tints each row's icon with its collection's tone", () => {
    mount();
    const mark = screen.getByRole("button", { name: "Other" }).querySelector("span") as HTMLElement;
    expect(mark.style.color).toBe("rgb(18, 52, 86)");
  });

  it("recolours a top-level collection from the preset swatches", () => {
    const props = mount();
    fireEvent.contextMenu(rowOf("Other"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change colour" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "List colour" })).getByRole("button", { name: "Deep teal" }));
    expect(props.onRecolor).toHaveBeenCalledWith(COLLECTIONS[3], "#4fae9f");
  });

  it("marks the current colour, and closes without a write when it is picked again", () => {
    const props = mount({ tone: () => "#7aa2f7" });
    fireEvent.contextMenu(rowOf("Other"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change colour" }));
    const palette = screen.getByRole("dialog", { name: "List colour" });
    const blue = within(palette).getByRole("button", { name: "Blue" });
    expect(blue.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(blue);
    fireEvent.click(blue);
    expect(props.onRecolor).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "List colour" })).toBeNull();
  });

  it("closes the swatches on Escape", () => {
    mount();
    fireEvent.contextMenu(rowOf("Other"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change colour" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "List colour" })).toBeNull();
  });

  it("offers no colour on a nested collection, and no delete on the protected one", () => {
    mount();
    fireEvent.contextMenu(rowOf("Mid"));
    expect(screen.queryByRole("menuitem", { name: "Change colour" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.contextMenu(rowOf("Root"));
    expect(screen.queryByRole("menuitem", { name: "Delete list" })).toBeNull();
  });

  it("stays flat without a move handler", () => {
    mount({ canMove: undefined, onMove: undefined, collections: [COLLECTIONS[0], COLLECTIONS[3]], selectedId: "root" });
    expect(screen.queryByRole("button", { name: "Add sublist under Root" })).toBeNull();
    expect(rowOf("Root").getAttribute("draggable")).toBe("false");
  });

  it("creates a sublist under the row it was asked from", () => {
    const props = mount({ selectedId: "other" });
    fireEvent.click(screen.getByRole("button", { name: "Add sublist under Other" }));
    const field = screen.getByLabelText("New sublist under Other");
    fireEvent.change(field, { target: { value: "Errands" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    expect(props.onCreate).toHaveBeenCalledWith("Errands", "other");
  });

  it("offers nothing to change when read only", () => {
    mount({ readOnly: true });
    expect(screen.queryByRole("button", { name: "Rename Other" })).toBeNull();
    expect(screen.queryByLabelText("List colour")).toBeNull();
    fireEvent.contextMenu(rowOf("Other"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  describe("archive", () => {
    const handlers = () => ({ onArchive: vi.fn(), onRestore: vi.fn() });

    it("offers archive on a row and on its menu, but not on the protected one", () => {
      const props = { ...handlers(), selectedId: "other" };
      mount(props);
      fireEvent.click(screen.getByRole("button", { name: "Archive Other" }));
      expect(props.onArchive).toHaveBeenCalledWith(COLLECTIONS[3]);
      expect(screen.queryByRole("button", { name: "Archive Root" })).toBeNull();
      fireEvent.contextMenu(rowOf("Other"));
      expect(screen.getByRole("menuitem", { name: "Archive list" })).not.toBeNull();
    });

    it("offers none of it without both handlers", () => {
      mount({ selectedId: "other", onArchive: vi.fn() });
      expect(screen.queryByRole("button", { name: "Archive Other" })).toBeNull();
      expect(screen.queryByText("Archived lists")).toBeNull();
    });

    it("moves an archived collection, and what is nested in it, out of the tree", () => {
      mount({
        ...handlers(),
        selectedId: "other",
        collections: COLLECTIONS.map((c) => (c.id === "mid" ? { ...c, archived: true } : c)),
      });
      expect(screen.queryByRole("button", { name: "Mid" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Leaf" })).toBeNull();
      expect(screen.getByRole("button", { name: /Archived lists/ }).getAttribute("aria-expanded")).toBe("false");
    });

    it("lists only the topmost archived collection, and restores it from the group", () => {
      const props = handlers();
      const archived = COLLECTIONS.map((c) =>
        c.id === "mid" || c.id === "leaf" ? { ...c, archived: true } : c,
      );
      mount({ ...props, selectedId: "other", collections: archived });
      const toggle = screen.getByRole("button", { name: /Archived lists/ });
      expect(within(toggle).getByText("1")).not.toBeNull();
      fireEvent.click(toggle);
      expect(screen.queryByRole("button", { name: "Leaf" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Restore Mid" }));
      expect(props.onRestore).toHaveBeenCalledWith(archived[1]);
    });

    it("opens the group while one of its collections is selected", () => {
      mount({
        ...handlers(),
        selectedId: "other",
        collections: COLLECTIONS.map((c) => (c.id === "other" ? { ...c, archived: true } : c)),
      });
      fireEvent.contextMenu(rowOf("Other"));
      expect(screen.getByRole("menuitem", { name: "Restore list" })).not.toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Archive list" })).toBeNull();
    });
  });

  describe("hiding from the overview", () => {
    it("offers the toggle on a row's menu, and names what it will do", () => {
      const onToggleHidden = vi.fn<(collection: SidebarCollection) => void>();
      mount({ selectedId: "other", onToggleHidden });
      fireEvent.contextMenu(rowOf("Other"));
      fireEvent.click(screen.getByRole("menuitem", { name: "Hide from overview" }));
      expect(onToggleHidden).toHaveBeenCalledWith(COLLECTIONS[3]);
    });

    it("offers it on the protected collection too, which has no delete", () => {
      mount({ selectedId: "other", onToggleHidden: vi.fn<(collection: SidebarCollection) => void>() });
      fireEvent.contextMenu(rowOf("Root"));
      expect(screen.getByRole("menuitem", { name: "Hide from overview" })).not.toBeNull();
    });

    it("offers a hidden collection to be shown again", () => {
      mount({
        selectedId: "other",
        onToggleHidden: vi.fn<(collection: SidebarCollection) => void>(),
        collections: COLLECTIONS.map((c) => (c.id === "other" ? { ...c, hideFromAll: true } : c)),
      });
      fireEvent.contextMenu(rowOf("Other"));
      expect(screen.getByRole("menuitem", { name: "Show in overview" })).not.toBeNull();
    });

    it("offers nothing without the handler", () => {
      mount({ selectedId: "other" });
      fireEvent.contextMenu(rowOf("Other"));
      expect(screen.queryByRole("menuitem", { name: /overview/ })).toBeNull();
    });

    it("dims a hidden collection and what is nested in it, and marks only the one that is hidden", () => {
      mount({
        selectedId: "leaf",
        onToggleHidden: vi.fn<(collection: SidebarCollection) => void>(),
        collections: COLLECTIONS.map((c) => (c.id === "mid" ? { ...c, hideFromAll: true } : c)),
        renderContents: undefined,
      });
      const marks = (name: string) =>
        screen.getByRole("button", { name }).querySelectorAll("[title='Hidden from the overview']");
      expect(screen.getByRole("button", { name: "Mid" }).className).toContain("opacity-60");
      expect(screen.getByRole("button", { name: "Leaf" }).className).toContain("opacity-60");
      expect(screen.getByRole("button", { name: "Root" }).className).not.toContain("opacity-60");
      expect(marks("Mid")).toHaveLength(1);
      expect(marks("Leaf")).toHaveLength(0);
    });
  });
});
