// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../test/dom";
import { AccountImportSection } from "./AccountImportSection";
import type { Session } from "../lib/client";

const ACCOUNT_EXPORT_TYPE = "SealbookAccountExport";
const ACCOUNT_EXPORT_VERSION = "1.0";

const importVault = vi.hoisted(() =>
  vi.fn<() => Promise<{ imported: number; skipped: number }>>(),
);

vi.mock("../lib/client", () => ({ importVault }));

const session = {
  state: { username: "alice", server: "https://vault.example" },
} as Session;

function bundle(objects: unknown[], account = { username: "alice", server: "https://vault.example" }) {
  return JSON.stringify({
    "@type": ACCOUNT_EXPORT_TYPE,
    version: ACCOUNT_EXPORT_VERSION,
    account,
    objects,
  });
}

const one = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    contentType: "application/jscontact+json",
    payload: { "@type": "Card" },
  },
];

/** A dropped or picked file, which jsdom has no File.text() for on its own. */
function file(name: string, body: string) {
  return { name, text: () => Promise.resolve(body) } as unknown as File;
}

function renderSection(onRefresh = vi.fn<() => Promise<void>>(() => Promise.resolve())) {
  const view = render(<AccountImportSection session={session} onRefresh={onRefresh} />);
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { ...view, input, onRefresh };
}

async function pick(input: HTMLInputElement, chosen: File) {
  Object.defineProperty(input, "files", { value: [chosen], configurable: true });
  fireEvent.change(input);
  await waitFor(() => screen.getByText(chosen.name));
}

describe("AccountImportSection", () => {
  it("opens the file picker from the keyboard", () => {
    const { input } = renderSection();
    // The input is `display: none` and so is not in the accessibility tree; the
    // zone is the only route to the picker, so it has to answer the keyboard.
    const opened = vi.fn<() => void>();
    input.addEventListener("click", opened);

    const zone = screen.getByRole("button", { name: /account export file to import/iu });
    fireEvent.keyDown(zone, { key: "Enter" });
    expect(opened).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(zone, { key: " " });
    expect(opened).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(zone, { key: "a" });
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it("reports what the file holds before anything is written", async () => {
    const { input } = renderSection();
    await pick(input, file("backup.json", bundle(one)));

    expect(screen.getByText(/1 item from alice at https:\/\/vault\.example/u)).toBeTruthy();
    expect(importVault).not.toHaveBeenCalled();
  });

  it("refuses a file it cannot restore without reaching the vault", async () => {
    const { input } = renderSection();
    const chosen = file("notes.txt", "not an export");
    Object.defineProperty(input, "files", { value: [chosen], configurable: true });
    fireEvent.change(input);

    await waitFor(() => screen.getByRole("alert"));
    expect(screen.getByRole("alert").textContent).toMatch(/cannot be imported/iu);
    expect(importVault).not.toHaveBeenCalled();
    // Still on the picker, so the next pick is the only way forward.
    expect(screen.getByRole("button", { name: /account export file to import/iu })).toBeTruthy();
  });

  it("warns when the file came from another account", async () => {
    const { input } = renderSection();
    await pick(
      input,
      file("other.json", bundle(one, { username: "bob", server: "https://vault.example" })),
    );
    expect(screen.getByText(/exported from a different account/iu)).toBeTruthy();
  });

  it("says so when the file itself is incomplete", async () => {
    const { input } = renderSection();
    await pick(
      input,
      file(
        "partial.json",
        JSON.stringify({
          "@type": ACCOUNT_EXPORT_TYPE,
          version: ACCOUNT_EXPORT_VERSION,
          account: { username: "alice", server: "https://vault.example" },
          unreadable: 2,
          objects: one,
        }),
      ),
    );
    // Importing a short backup must not look like a complete restore.
    expect(screen.getByText(/This file is incomplete: 2 items/u)).toBeTruthy();
  });

  it("imports without overwriting unless asked, and refreshes after", async () => {
    importVault.mockResolvedValue({ imported: 1, skipped: 0 });
    const { input, onRefresh } = renderSection();
    await pick(input, file("backup.json", bundle(one)));

    fireEvent.click(screen.getByRole("button", { name: /^Import 1 item$/u }));

    await waitFor(() => expect(importVault).toHaveBeenCalledTimes(1));
    expect(importVault).toHaveBeenLastCalledWith(session, expect.any(Array), {
      overwrite: false,
    });
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it("passes overwrite only when the box is ticked", async () => {
    importVault.mockResolvedValue({ imported: 1, skipped: 0 });
    const { input } = renderSection();
    await pick(input, file("backup.json", bundle(one)));

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /^Import 1 item$/u }));

    await waitFor(() => expect(importVault).toHaveBeenCalledTimes(1));
    expect(importVault).toHaveBeenLastCalledWith(session, expect.any(Array), {
      overwrite: true,
    });
  });

  it("says what it left alone, so a partial import is not read as a whole one", async () => {
    importVault.mockResolvedValue({ imported: 0, skipped: 1 });
    const { input } = renderSection();
    await pick(input, file("backup.json", bundle(one)));
    fireEvent.click(screen.getByRole("button", { name: /^Import 1 item$/u }));

    await waitFor(() => screen.getByRole("status"));
    expect(screen.getByRole("status").textContent).toMatch(/1 already in this vault was left alone/u);
  });

  it("reports a failed import and keeps the file", async () => {
    importVault.mockRejectedValue(new Error("the server said no"));
    const { input, onRefresh } = renderSection();
    await pick(input, file("backup.json", bundle(one)));
    fireEvent.click(screen.getByRole("button", { name: /^Import 1 item$/u }));

    await waitFor(() => screen.getByRole("alert"));
    expect(screen.getByRole("alert").textContent).toMatch(/Import failed/iu);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(screen.getByText("backup.json")).toBeTruthy();
  });
});
