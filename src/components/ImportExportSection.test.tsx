// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { fireEvent, render, screen } from "@testing-library/react";
import "../test/dom";
import { ImportExportSection } from "./ImportExportSection";
import type { Session } from "../lib/client";

const { putContact } = vi.hoisted(() => ({ putContact: vi.fn(async () => "new-id") }));
vi.mock("../lib/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/client")>()),
  putContact,
}));

/**
 * Nothing here reaches the server: the drop zone is inert until a file is
 * chosen, so the session is only needed to satisfy the prop.
 */
function renderSection() {
  return render(
    <ImportExportSection
      session={{} as Session}
      contacts={[]}
      addressBooks={[]}
      onRefresh={async () => {}}
    />,
  );
}

describe("ImportExportSection", () => {
  it("hides its file input from the accessibility tree", () => {
    const { container } = renderSection();

    // The premise of the test below. The input is `display: none`, so it is
    // unreachable by keyboard and absent from the tree a screen reader walks.
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.className).toContain("hidden");
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("opens the file picker from the keyboard", () => {
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const opened = vi.fn<() => void>();
    input.addEventListener("click", opened);

    const zone = screen.getByRole("button", { name: /contacts file to import/iu });
    // Without this the zone is pointer-only and there is no other route to the
    // picker, so a keyboard-only user cannot import at all.
    fireEvent.keyDown(zone, { key: "Enter" });
    expect(opened).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(zone, { key: " " });
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("ignores keys that are not an activation", () => {
    const { container } = renderSection();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const opened = vi.fn<() => void>();
    input.addEventListener("click", opened);

    const zone = screen.getByRole("button", { name: /contacts file to import/iu });
    fireEvent.keyDown(zone, { key: "Tab" });
    fireEvent.keyDown(zone, { key: "a" });
    expect(opened).not.toHaveBeenCalled();
  });

  it("is reachable in the tab order", () => {
    renderSection();
    const zone = screen.getByRole("button", { name: /contacts file to import/iu });
    expect(zone.tabIndex).toBe(0);
  });

  it("stores no remote photo URL from an imported vCard", async () => {
    putContact.mockClear();
    const { container } = renderSection();
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Ada Lovelace",
      "EMAIL:ada@example.com",
      "PHOTO;VALUE=uri:https://tracker.example/p.png",
      "END:VCARD",
    ].join("\r\n");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([vcf], "ada.vcf", { type: "text/vcard" })] },
    });

    fireEvent.click(await screen.findByRole("button", { name: /^Import/u }));

    await waitFor(() => expect(putContact).toHaveBeenCalledTimes(1));
    const draft = (putContact.mock.calls[0] as unknown as [unknown, { avatar?: string }])[1];
    expect(draft.avatar).toBeUndefined();
  });
});
