// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/dom";
import { ALL_FOLDERS, importFolders, NO_FOLDERS, parseBookmarkImport } from "../lib/bookmarkExport";
import type { CoreBookmarkImportOptions } from "../lib/wasm";
import { BookmarkFolderEditor } from "./BookmarkFolderEditor";

const FILE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Reading</H3>
  <DL><p>
    <DT><H3>Deep</H3>
    <DL><p><DT><A HREF="https://a.example/">A</A></DL><p>
    <DT><A HREF="https://b.example/">B</A>
  </DL><p>
  <DT><H3>Work</H3>
  <DL><p><DT><A HREF="https://c.example/">C</A></DL><p>
</DL><p>`;

const read = parseBookmarkImport(FILE, "t");

let latest: CoreBookmarkImportOptions = NO_FOLDERS;

function Harness() {
  const [options, setOptions] = useState<CoreBookmarkImportOptions>(NO_FOLDERS);
  return (
    <BookmarkFolderEditor
      id="t"
      folders={importFolders(read, options)}
      options={options}
      onOptions={(next) => {
        latest = next;
        setOptions(next);
      }}
      collections={[{ id: "c1", name: "Inbox", raw: "{}" }]}
      disabled={false}
    />
  );
}

describe("the bookmark folder editor", () => {
  it("lists every folder with its size", () => {
    render(<Harness />);
    expect(screen.getByLabelText("What to do with Reading")).toBeTruthy();
    expect(screen.getByLabelText("What to do with Deep")).toBeTruthy();
    expect(screen.getAllByText("2 bookmarks").length).toBeGreaterThan(0);
  });

  it("makes a collection of each top-level folder from the preset", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Top-level folders"));
    expect(latest).toEqual({ depth: 1, rules: [] });
    expect((screen.getByLabelText("What to do with Work") as HTMLSelectElement).value).toBe("collection");
    expect((screen.getByLabelText("What to do with Deep") as HTMLSelectElement).value).toBe("merge");
  });

  it("keeps a per-folder choice as a custom rule that Reset clears", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("All folders"));
    expect(latest.depth).toBe(ALL_FOLDERS);
    fireEvent.change(screen.getByLabelText("What to do with Work"), { target: { value: "skip" } });
    expect(latest.rules).toEqual([{ path: ["Work"], action: { kind: "skip" } }]);
    expect(screen.getByText("Custom")).toBeTruthy();
    fireEvent.click(screen.getByText("Reset"));
    expect(latest.rules).toEqual([]);
  });

  it("renames a folder's collection", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Top-level folders"));
    fireEvent.change(screen.getByLabelText("Collection name for Work"), { target: { value: "Job" } });
    expect(latest.rules).toEqual([{ path: ["Work"], action: { kind: "collection", name: "Job" } }]);
  });

  it("files a folder in an existing collection", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("What to do with Work"), { target: { value: "existing" } });
    expect(latest.rules).toEqual([{ path: ["Work"], action: { kind: "existing", collection_id: "c1" } }]);
  });
});
