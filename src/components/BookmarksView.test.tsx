// @vitest-environment jsdom
/**
 * The bookmarks view, mounted on its own.
 *
 * `BookmarkCollectionTree.test.tsx` drives the collections sidebar through
 * `App`; this covers the rest of the view: the bookmark form and what it
 * normalizes on the way to the vault, the list and its search, the
 * subcollection grid, and deleting a collection, which moves what it held up a
 * level rather than cascading.
 *
 * `lib/client` is faked rather than driven through a session, as in the suites
 * that mount `App`: every write here would otherwise need an OPAQUE exchange
 * only the server can answer.
 */

import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "../test/dom";
import { DEFAULT_BOOKMARK_COLLECTION_ID, serializeBookmark } from "../lib/bookmark";
import { useSidebar } from "./SidebarDrawer";
import type { Session } from "../lib/client";
import type { Bookmark, BookmarkCollection, BookmarkDraft } from "../lib/types";

/** The faked vault, read back by `onRefresh` as the server's copy would be. */
let bookmarks: Bookmark[] = [];
let collections: BookmarkCollection[] = [];
let writes: { id: string | undefined; draft: BookmarkDraft }[] = [];
let deletes: string[] = [];
let collectionWrites: {
  name: string;
  parentId?: string;
  id?: string;
  color?: string;
}[] = [];
let collectionDeletes: string[] = [];
let ensured = 0;
let refreshes = 0;

vi.mock("../lib/client", async () => {
  const actual = await vi.importActual<typeof import("../lib/client")>("../lib/client");
  return {
    ...actual,
    ensureDefaultBookmarkCollection: async () => {
      ensured += 1;
      collections = [
        { id: DEFAULT_BOOKMARK_COLLECTION_ID, name: "Default Collection", raw: "{}" },
        ...collections,
      ];
      return collections;
    },
    putBookmark: async (_session: unknown, draft: BookmarkDraft, id?: string) => {
      writes.push({ id, draft });
      const saved: Bookmark = { ...draft, id: id ?? `bookmark-${writes.length}`, raw: serializeBookmark(draft) };
      bookmarks = bookmarks.some((item) => item.id === saved.id)
        ? bookmarks.map((item) => (item.id === saved.id ? saved : item))
        : [...bookmarks, saved];
      return saved.id;
    },
    putBookmarks: async (_session: unknown, items: { id: string; draft: BookmarkDraft }[]) => {
      for (const { id, draft } of items) {
        writes.push({ id, draft });
        bookmarks = bookmarks.map((item) =>
          item.id === id ? { ...draft, id, raw: serializeBookmark(draft) } : item,
        );
      }
    },
    deleteBookmarks: async (_session: unknown, ids: string[]) => {
      deletes.push(...ids);
      bookmarks = bookmarks.filter((item) => !ids.includes(item.id));
    },
    deleteBookmark: async (_session: unknown, id: string) => {
      deletes.push(id);
      bookmarks = bookmarks.filter((item) => item.id !== id);
    },
    putBookmarkCollection: async (
      _session: unknown,
      name: string,
      parentId?: string,
      id?: string,
      _previousRaw?: string,
      color?: string,
    ) => {
      collectionWrites.push({ name, parentId, id, color });
      if (id) {
        collections = collections.map((item) =>
          item.id === id ? { ...item, name, parentId, color } : item,
        );
        return id;
      }
      const made = `collection-${name}`;
      collections = [...collections, { id: made, name, parentId, raw: "{}" }];
      return made;
    },
    deleteBookmarkCollection: async (_session: unknown, id: string) => {
      collectionDeletes.push(id);
      collections = collections.filter((item) => item.id !== id);
    },
  };
});

const { BookmarksView } = await import("./BookmarksView");

const SESSION = { state: { username: "ada" } } as unknown as Session;

const DEFAULT_COLLECTION: BookmarkCollection = {
  id: DEFAULT_BOOKMARK_COLLECTION_ID,
  name: "Default Collection",
  raw: "{}",
};

function aBookmark(overrides: Partial<Bookmark> & { id: string }): Bookmark {
  return {
    url: `https://${overrides.id}.example.com/`,
    title: overrides.id,
    collectionId: DEFAULT_BOOKMARK_COLLECTION_ID,
    raw: "{}",
    ...overrides,
  };
}

/** Stands in for the shell: vault lists in state, re-read on every refresh. */
function Harness({ readOnly }: { readOnly?: boolean }) {
  const [vault, setVault] = useState({ bookmarks, collections });
  const sidebar = useSidebar();
  return (
    <BookmarksView
      session={SESSION}
      bookmarks={vault.bookmarks}
      collections={vault.collections}
      busy={false}
      readOnly={readOnly}
      sidebar={sidebar}
      onRefresh={async () => {
        refreshes += 1;
        setVault({ bookmarks, collections });
      }}
      onCreateCollection={async (name, parentId) => {
        const made = `collection-${name}`;
        collections = [...collections, { id: made, name, parentId, raw: "{}" }];
        setVault({ bookmarks, collections });
        return made;
      }}
    />
  );
}

function mount(
  seed: {
    bookmarks?: Bookmark[];
    collections?: BookmarkCollection[];
    readOnly?: boolean;
  } = {},
) {
  bookmarks = seed.bookmarks ?? [];
  collections = seed.collections ?? [DEFAULT_COLLECTION];
  return render(<Harness readOnly={seed.readOnly} />);
}

/** The collections sidebar, where a row's name is followed by its count. */
function sidebar(): HTMLElement {
  const aside = document.querySelector("aside");
  if (!aside) throw new Error("no sidebar");
  return aside as HTMLElement;
}

/**
 * Selects a collection from the sidebar. The count sits inside the same button,
 * so a row carrying bookmarks reads as "Work3"; scoped to the sidebar, because
 * the same names are on the subcollection cards.
 */
function selectCollection(name: string): void {
  fireEvent.click(
    within(sidebar()).getByRole("button", { name: new RegExp(`^${name}\\d*$`) }),
  );
}

/** The bookmark list beside the sidebar, which repeats the open collection's links. */
function board(): HTMLElement {
  const section = [...document.querySelectorAll("section")].find((node) => !node.closest("aside"));
  if (!section) throw new Error("no bookmark list");
  return section as HTMLElement;
}

/** The bookmark form, once "New bookmark" has opened it. */
function openForm(): void {
  fireEvent.click(within(board()).getByRole("button", { name: /New bookmark|New$/ }));
}

function fillForm(values: { url?: string; title?: string; tags?: string; notes?: string }): void {
  if (values.url !== undefined) {
    fireEvent.change(screen.getByLabelText("Web address"), { target: { value: values.url } });
  }
  if (values.title !== undefined) {
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: values.title } });
  }
  if (values.tags !== undefined) {
    const input = screen.getByLabelText("Tags");
    for (const tag of values.tags.split(",")) {
      fireEvent.change(input, { target: { value: tag } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
  }
  if (values.notes !== undefined) {
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: values.notes } });
  }
}

beforeEach(() => {
  bookmarks = [];
  collections = [];
  writes = [];
  deletes = [];
  collectionWrites = [];
  collectionDeletes = [];
  ensured = 0;
  refreshes = 0;
});

describe("BookmarksView, the default collection", () => {
  it("creates it on first entry, once", async () => {
    mount({ collections: [] });

    await waitFor(() => expect(ensured).toBe(1));
    expect(refreshes).toBe(1);
    await waitFor(() =>
      expect(within(sidebar()).getByText("Default Collection")).not.toBeNull(),
    );
  });

  it("leaves the vault alone when one already exists", async () => {
    mount({ collections: [DEFAULT_COLLECTION] });

    await waitFor(() =>
      expect(within(sidebar()).getByText("Default Collection")).not.toBeNull(),
    );
    expect(ensured).toBe(0);
  });

  it("writes nothing at all offline", async () => {
    mount({ collections: [], readOnly: true });

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "All bookmarks" })).not.toBeNull(),
    );
    expect(ensured).toBe(0);
  });
});

describe("BookmarksView, saving a bookmark", () => {
  it("refuses something that is not a web address", async () => {
    mount();

    openForm();
    fillForm({ url: "not a url" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Enter a web address, for example example.com/page.",
      ),
    );
    expect(writes).toEqual([]);
    // The form is still open with what was typed, rather than cleared.
    expect((screen.getByLabelText("Web address") as HTMLInputElement).value).toBe("not a url");
  });

  it("adds a scheme to an address typed without one", async () => {
    mount();

    openForm();
    fillForm({ url: "example.com/page", title: "A page" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.url).toBe("https://example.com/page");
    expect(writes[0]!.id).toBeUndefined();
  });

  it("does not title a bookmark with its address when no title was given", async () => {
    mount();

    openForm();
    fillForm({ url: "example.com/page", title: "   " });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.title).toBe("");
  });

  it("splits the tags on commas and drops the empties", async () => {
    mount();

    openForm();
    fillForm({ url: "example.com", tags: " reading , ,  rust ," });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.tags).toEqual(["reading", "rust"]);
  });

  it("refuses a bookmark too large for one vault object", async () => {
    mount();

    openForm();
    fillForm({ url: "example.com", notes: "x".repeat(9 * 1024 * 1024) });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "This bookmark is too large to store. One bookmark can hold about 8 MB.",
      ),
    );
    expect(writes).toEqual([]);
  });

  it("files a new bookmark in the collection being shown", async () => {
    const work: BookmarkCollection = { id: "collection-work", name: "Work", raw: "{}" };
    mount({ collections: [DEFAULT_COLLECTION, work] });

    selectCollection("Work");
    openForm();
    fillForm({ url: "example.com" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.collectionId).toBe(work.id);
  });

  it("files it in the default collection when everything is being shown", async () => {
    mount({ collections: [DEFAULT_COLLECTION] });

    openForm();
    fillForm({ url: "example.com" });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.draft.collectionId).toBe(DEFAULT_BOOKMARK_COLLECTION_ID);
  });

  it("edits an existing bookmark in place", async () => {
    mount({
      collections: [DEFAULT_COLLECTION],
      bookmarks: [aBookmark({ id: "b1", title: "Rust book", tags: ["reading"] })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Edit Rust book" }));
    expect(screen.getByRole("button", { name: "Remove tag: reading" })).toBeTruthy();
    fillForm({ title: "The Rust book" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.id).toBe("b1");
    expect(writes[0]!.draft.title).toBe("The Rust book");
    // The form closes once the write has landed.
    await waitFor(() => expect(screen.queryByLabelText("Web address")).toBeNull());
  });

  it("closes the form without writing on cancel", () => {
    mount();

    openForm();
    fillForm({ url: "example.com" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Web address")).toBeNull();
    expect(writes).toEqual([]);
  });
});

describe("BookmarksView, the list", () => {
  it("leaves a hidden collection and its children out of All, but not out of their own view", () => {
    const secret: BookmarkCollection = {
      id: "collection-secret",
      name: "Secret",
      hideFromAll: true,
      raw: "{}",
    };
    const nested: BookmarkCollection = {
      id: "collection-nested",
      name: "Nested",
      parentId: secret.id,
      raw: "{}",
    };
    mount({
      collections: [DEFAULT_COLLECTION, secret, nested],
      bookmarks: [
        aBookmark({ id: "b1" }),
        aBookmark({ id: "b2", collectionId: secret.id }),
        aBookmark({ id: "b3", collectionId: nested.id }),
      ],
    });

    const header = screen.getByRole("heading", { name: "All bookmarks" }).parentElement!;
    expect(within(header).getByTitle("1 bookmark").textContent).toBe("1");

    selectCollection("Secret");
    expect(screen.getByTitle("1 bookmark").textContent).toBe("1");
  });

  it("counts what is on screen rather than the whole vault", () => {
    const work: BookmarkCollection = { id: "collection-work", name: "Work", raw: "{}" };
    mount({
      collections: [DEFAULT_COLLECTION, work],
      bookmarks: [
        aBookmark({ id: "b1" }),
        aBookmark({ id: "b2" }),
        aBookmark({ id: "b3", collectionId: work.id }),
      ],
    });

    const header = screen.getByRole("heading", { name: "All bookmarks" }).parentElement!;
    expect(within(header).getByTitle("3 bookmarks").textContent).toBe("3");

    selectCollection("Work");
    expect(screen.getByTitle("1 bookmark").textContent).toBe("1");
  });

  it("shows a bookmark's host and tags under its title", () => {
    mount({
      collections: [DEFAULT_COLLECTION],
      bookmarks: [
        aBookmark({
          id: "b1",
          title: "Rust book",
          url: "https://doc.rust-lang.org/book/",
          tags: ["reading", "rust"],
        }),
      ],
    });

    expect(screen.getByText("doc.rust-lang.org · reading, rust")).not.toBeNull();
  });

  it("filters on a search, and says so when nothing matches", async () => {
    mount({
      collections: [DEFAULT_COLLECTION],
      bookmarks: [
        aBookmark({ id: "b1", title: "Rust book" }),
        aBookmark({ id: "b2", title: "Go blog" }),
      ],
    });

    fireEvent.change(screen.getByLabelText("Search bookmarks"), { target: { value: "rust" } });
    await waitFor(() => expect(screen.queryByText("Go blog")).toBeNull());
    expect(screen.getByText("Rust book")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("Search bookmarks"), { target: { value: "zig" } });
    await waitFor(() =>
      expect(screen.getByText("No bookmarks match that search.")).not.toBeNull(),
    );
  });

  it("clears the search from the field's own button", async () => {
    mount({
      collections: [DEFAULT_COLLECTION],
      bookmarks: [aBookmark({ id: "b1", title: "Rust book" })],
    });

    fireEvent.change(screen.getByLabelText("Search bookmarks"), { target: { value: "zig" } });
    await waitFor(() =>
      expect(screen.getByText("No bookmarks match that search.")).not.toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    await waitFor(() => expect(screen.getByText("Rust book")).not.toBeNull());
  });

  it("says the collection is empty rather than showing a bare list", () => {
    mount({ collections: [DEFAULT_COLLECTION] });

    expect(screen.getByText("No bookmarks here yet")).not.toBeNull();
    expect(
      screen.getByText("Saved links are encrypted on this device before they leave it."),
    ).not.toBeNull();
  });

  it("moves a bookmark with the row's own collection picker", async () => {
    const work: BookmarkCollection = { id: "collection-work", name: "Work", raw: "{}" };
    mount({
      collections: [DEFAULT_COLLECTION, work],
      bookmarks: [aBookmark({ id: "b1", title: "Rust book" })],
    });

    fireEvent.change(screen.getByLabelText("Collection for Rust book"), {
      target: { value: work.id },
    });

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.id).toBe("b1");
    expect(writes[0]!.draft.collectionId).toBe(work.id);
  });

  it("deletes a bookmark behind a confirm", async () => {
    mount({
      collections: [DEFAULT_COLLECTION],
      bookmarks: [aBookmark({ id: "b1", title: "Rust book" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Rust book" }));
    const dialog = screen.getByRole("dialog", { name: "Delete bookmark" });
    expect(dialog.textContent).toContain("Delete “Rust book”?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deletes).toEqual(["b1"]));
    await waitFor(() => expect(screen.queryByText("Rust book")).toBeNull());
  });

  it("keeps a bookmark that the confirm was dismissed on", () => {
    mount({
      collections: [DEFAULT_COLLECTION],
      bookmarks: [aBookmark({ id: "b1", title: "Rust book" })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Rust book" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Delete bookmark" })).getByRole("button", {
        name: "Cancel",
      }),
    );

    expect(deletes).toEqual([]);
    expect(screen.getByText("Rust book")).not.toBeNull();
  });
});

describe("BookmarksView, nested collections", () => {
  const parent: BookmarkCollection = { id: "collection-parent", name: "Reading", raw: "{}" };
  const child: BookmarkCollection = {
    id: "collection-child",
    name: "Papers",
    parentId: parent.id,
    raw: "{}",
  };

  it("shows only top-level collections in the grid, and only on All bookmarks", () => {
    mount({ collections: [DEFAULT_COLLECTION, parent, child] });

    expect(within(board()).getByText("Collections")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open Reading" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Open Papers" })).toBeNull();

    selectCollection("Reading");
    expect(within(board()).queryByText("Collections")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Papers" })).toBeNull();
  });

  it("opens a collection from its card", () => {
    mount({
      collections: [DEFAULT_COLLECTION, parent, child],
      bookmarks: [aBookmark({ id: "b1", title: "A link", collectionId: parent.id })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Reading" }));

    expect(screen.getByRole("heading", { name: "Reading" })).not.toBeNull();
    expect(within(board()).getByText("A link")).not.toBeNull();
  });

  it("hides the grid during a search, which does not filter it", async () => {
    mount({
      collections: [DEFAULT_COLLECTION, parent, child],
      bookmarks: [aBookmark({ id: "b1", title: "Rust book", collectionId: parent.id })],
    });

    expect(within(board()).getByText("Collections")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("Search bookmarks"), { target: { value: "rust" } });

    await waitFor(() => expect(within(board()).queryByText("Collections")).toBeNull());
  });

  it("lists every collection, indented, in the form's picker", () => {
    mount({ collections: [DEFAULT_COLLECTION, parent, child] });

    openForm();

    const options = Array.from(
      (screen.getByLabelText("Collection") as HTMLSelectElement).options,
    ).map((option) => option.textContent);
    expect(options).toEqual(["Default Collection", "Reading", "— Papers"]);
  });

  it("moves a deleted collection's contents up a level instead of cascading", async () => {
    mount({
      collections: [DEFAULT_COLLECTION, parent, child],
      bookmarks: [aBookmark({ id: "b1", title: "A paper", collectionId: child.id })],
    });

    selectCollection("Reading");
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Delete Papers" }));
    const dialog = screen.getByRole("dialog", { name: "Delete collection" });
    expect(dialog.textContent).toContain("are kept and move up one level");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(collectionDeletes).toEqual([child.id]));
    expect(deletes).toEqual([]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.id).toBe("b1");
    expect(writes[0]!.draft.collectionId).toBe(parent.id);
  });

  it("re-parents a deleted collection's own children", async () => {
    const grandchild: BookmarkCollection = {
      id: "collection-grandchild",
      name: "Drafts",
      parentId: child.id,
      raw: "{}",
    };
    mount({ collections: [DEFAULT_COLLECTION, parent, child, grandchild] });

    selectCollection("Reading");
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Delete Papers" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Delete collection" })).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => expect(collectionDeletes).toEqual([child.id]));
    expect(collectionWrites).toEqual([
      { name: "Drafts", parentId: parent.id, id: grandchild.id, color: undefined },
    ]);
  });

  it("sends a top-level collection's contents to the default one", async () => {
    mount({
      collections: [DEFAULT_COLLECTION, parent],
      bookmarks: [aBookmark({ id: "b1", title: "Rust book", collectionId: parent.id })],
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Reading" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Delete collection" })).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => expect(collectionDeletes).toEqual([parent.id]));
    expect(writes[0]!.draft.collectionId).toBe(DEFAULT_BOOKMARK_COLLECTION_ID);
  });

  it("falls back to showing everything once the selected collection is gone", async () => {
    mount({ collections: [DEFAULT_COLLECTION, parent] });

    selectCollection("Reading");
    expect(screen.getByRole("heading", { name: "Reading" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete Reading" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Delete collection" })).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "All bookmarks" })).not.toBeNull(),
    );
  });
});

describe("BookmarksView, the sidebar", () => {
  const parent: BookmarkCollection = { id: "collection-parent", name: "Reading", raw: "{}" };
  const child: BookmarkCollection = {
    id: "collection-child",
    name: "Papers",
    parentId: parent.id,
    raw: "{}",
  };

  it("opens a collection to its subcollections, without its bookmarks", () => {
    mount({
      collections: [DEFAULT_COLLECTION, parent, child],
      bookmarks: [aBookmark({ id: "b1", title: "Rust book", collectionId: parent.id })],
    });

    selectCollection("Reading");
    const side = within(sidebar());
    expect(side.getByRole("button", { name: /^Papers/ })).not.toBeNull();
    expect(side.queryByRole("button", { name: "Rust book" })).toBeNull();
    expect(side.queryByRole("button", { name: "New bookmark" })).toBeNull();
  });

  it("recolours a top-level collection from its context menu, but not a nested one", async () => {
    mount({ collections: [DEFAULT_COLLECTION, parent, child] });
    selectCollection("Reading");
    fireEvent.contextMenu(within(sidebar()).getByRole("button", { name: /^Papers/ }));
    expect(screen.queryByRole("menuitem", { name: "Change colour" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.contextMenu(within(sidebar()).getByRole("button", { name: /^Reading/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change colour" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Collection colour" })).getByRole("button", { name: "Deep teal" }));
    await waitFor(() =>
      expect(collectionWrites).toEqual([
        { name: "Reading", parentId: undefined, id: parent.id, color: "#4fae9f" },
      ]),
    );
  });
});

describe("BookmarksView, offline", () => {
  it("offers nothing that would write", () => {
    mount({
      collections: [DEFAULT_COLLECTION],
      bookmarks: [aBookmark({ id: "b1", title: "Rust book" })],
      readOnly: true,
    });

    expect(screen.queryByRole("button", { name: /New bookmark|New$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add collection" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Rust book" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Rust book" })).toBeNull();
    expect(screen.queryByLabelText("Collection for Rust book")).toBeNull();
  });

  it("still lists and links the bookmarks it holds", () => {
    mount({
      collections: [DEFAULT_COLLECTION],
      bookmarks: [
        aBookmark({ id: "b1", title: "Rust book", url: "https://doc.rust-lang.org/book/" }),
      ],
      readOnly: true,
    });

    const link = screen.getByRole("link", { name: "Rust book" });
    expect(link.getAttribute("href")).toBe("https://doc.rust-lang.org/book/");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
  });

  it("shows a stored URL that is not http(s) as text, with no link to follow", () => {
    mount({
      collections: [DEFAULT_COLLECTION],
      bookmarks: [
        aBookmark({ id: "b1", title: "Worm", url: "ms-msdt:/id PCWDiagnostic" }),
        aBookmark({ id: "b2", title: "Script", url: "javascript:alert(1)" }),
      ],
    });

    expect(screen.queryByRole("link", { name: "Worm" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Script" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Worm" })).toBeNull();
    expect(screen.getByText("Worm")).toBeDefined();
  });

  it("links a scheme-less stored URL as https, not as a relative path", () => {
    mount({
      collections: [DEFAULT_COLLECTION],
      bookmarks: [aBookmark({ id: "b1", title: "Docs", url: "example.com/docs" })],
    });

    expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe(
      "https://example.com/docs",
    );
  });
});

describe("tags sidebar", () => {
  it("lists every tag once with its count and filters the list on click", () => {
    mount({
      bookmarks: [
        aBookmark({ id: "a", tags: ["rust"] }),
        aBookmark({ id: "b", tags: ["Rust", "web"] }),
        aBookmark({ id: "c" }),
      ],
    });

    const rust = screen.getByRole("button", { name: /rust/i, pressed: false });
    expect(rust.textContent).toContain("2");
    expect(screen.getByRole("button", { name: /web/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /web/ }));
    expect(within(board()).queryByText("a")).toBeNull();
    expect(within(board()).getByText("b")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /web/ }));
    expect(within(board()).getByText("c")).toBeTruthy();
  });
});

describe("tag history", () => {
  const history = () => [aBookmark({ id: "a", tags: ["Rust"] }), aBookmark({ id: "b" })];

  function openEditB(): HTMLElement {
    fireEvent.click(screen.getByRole("button", { name: "Edit b" }));
    return screen.getByLabelText("Tags");
  }

  it("suggests earlier tags while typing and adds the one picked", async () => {
    mount({ bookmarks: history() });
    const input = openEditB();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ru" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: "Rust" }));
    expect(screen.getByRole("button", { name: "Remove tag: Rust" })).toBeTruthy();
  });

  it("steps into the suggestions with Tab and picks one with Enter", () => {
    mount({ bookmarks: [...history(), aBookmark({ id: "c", tags: ["Ruby"] })] });
    const input = openEditB();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ru" } });
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(within(screen.getByRole("listbox", { name: "Tags suggestions" })).getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Remove tag: Ruby" })).toBeTruthy();
  });

  it("keeps the first spelling of a tag when another case is typed", async () => {
    mount({ bookmarks: history() });
    const input = openEditB();
    fireEvent.change(input, { target: { value: "RUST" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Remove tag: Rust" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes[0]?.draft.tags).toEqual(["Rust"]));
  });
});

describe("bulk editing", () => {
  const three = () => [
    aBookmark({ id: "a", tags: ["rust"] }),
    aBookmark({ id: "b", tags: ["Rust", "web"] }),
    aBookmark({ id: "c" }),
  ];

  function startSelecting(): void {
    fireEvent.click(screen.getByRole("checkbox", { name: "Select a" }));
  }

  function runAction(name: RegExp): void {
    fireEvent.click(within(board()).getByRole("button", { name: "Actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name }));
  }

  it("selects every bookmark on Ctrl+A, but not while typing in a field", () => {
    mount({ bookmarks: three() });
    fireEvent.change(screen.getByPlaceholderText("Search bookmarks"), { target: { value: "" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Search bookmarks"), { key: "a", ctrlKey: true });
    expect(screen.queryByText("3 selected")).toBeNull();

    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(screen.getByText("3 selected")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(screen.queryByText("3 selected")).toBeNull();
  });

  it("has no Select button in read-only mode", () => {
    mount({ bookmarks: three(), readOnly: true });
    expect(screen.queryByRole("checkbox", { name: "Select a" })).toBeNull();
  });

  it("selects all and adds a tag only where it is missing", async () => {
    mount({ bookmarks: three() });
    startSelecting();
    fireEvent.click(screen.getByLabelText("Select all bookmarks"));
    expect(screen.getByText("3 selected")).toBeTruthy();
    runAction(/Add tag to 3 bookmarks/);
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "rust" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(writes.map((write) => write.id)).toEqual(["c"]));
    expect(writes[0]?.draft.tags).toEqual(["rust"]);
    await waitFor(() => expect(screen.queryByText("3 selected")).toBeNull());
  });

  it("removes a tag regardless of case", async () => {
    mount({ bookmarks: three() });
    startSelecting();
    fireEvent.click(screen.getByLabelText("Select all bookmarks"));
    runAction(/Remove tag from/);
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "rust" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(writes.map((write) => write.id).sort()).toEqual(["a", "b"]));
    expect(writes.find((write) => write.id === "b")?.draft.tags).toEqual(["web"]);
  });

  it("moves the selection to another collection", async () => {
    mount({
      bookmarks: three(),
      collections: [DEFAULT_COLLECTION, { id: "work", name: "Work", raw: "{}" }],
    });
    startSelecting();
    fireEvent.click(screen.getByLabelText("Select b"));
    runAction(/Move 2 bookmarks/);
    fireEvent.change(screen.getByLabelText("Collection"), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.every((write) => write.draft.collectionId === "work")).toBe(true);
  });

  it("deletes the selection after confirming", async () => {
    mount({ bookmarks: three() });
    startSelecting();
    fireEvent.click(screen.getByLabelText("Select c"));
    runAction(/Delete 2 bookmarks/);
    expect(deletes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deletes.sort()).toEqual(["a", "c"]));
  });

  it("extends a selection with shift-click", () => {
    mount({ bookmarks: three() });
    startSelecting();
    fireEvent.click(screen.getByLabelText("Select c"), { shiftKey: true });
    expect(screen.getByText("3 selected")).toBeTruthy();
  });

  it("offers the bulk menu on right-click of a selected row", () => {
    mount({ bookmarks: three() });
    startSelecting();
    fireEvent.click(screen.getByLabelText("Select b"));
    const row = document.querySelector('[data-bookmark-id="a"]') as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menuitem", { name: /Add tag to 2 bookmarks/ })).toBeTruthy();
  });

  it("starts a selection from the row menu and with ctrl-click", () => {
    mount({ bookmarks: three() });
    const row = document.querySelector('[data-bookmark-id="a"]') as HTMLElement;
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Select" }));
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("enters selection with ctrl-click on a row", () => {
    mount({ bookmarks: three() });
    const row = document.querySelector('[data-bookmark-id="b"]') as HTMLElement;
    fireEvent.click(row, { ctrlKey: true });
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("selects from the collection dot, which doubles as the tick", () => {
    mount({ bookmarks: three() });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select b" }));
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Select b" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select b" }));
    expect(screen.queryByText("0 selected")).toBeNull();
    expect(screen.queryByLabelText("Select all bookmarks")).toBeNull();
  });

  it("skips a bookmark saved by a newer schema and says so", async () => {
    const locked = aBookmark({
      id: "locked",
      raw: JSON.stringify({ version: "99.0", url: "https://locked.example.com/" }),
    });
    mount({ bookmarks: [locked, aBookmark({ id: "ok" })] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select ok" }));
    fireEvent.click(screen.getByLabelText("Select all bookmarks"));
    runAction(/Add tag to 2 bookmarks/);
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(writes.map((write) => write.id)).toEqual(["ok"]));
  });
});
