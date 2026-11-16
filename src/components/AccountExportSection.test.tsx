// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../test/dom";
import { AccountExportSection } from "./AccountExportSection";
import type { Session } from "../lib/client";

const { exportVault, loadDevice, triggerDownload } = vi.hoisted(() => ({
  exportVault: vi.fn(),
  loadDevice: vi.fn(),
  triggerDownload: vi.fn(),
}));

vi.mock("../lib/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/client")>()),
  exportVault,
}));
vi.mock("../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/storage")>()),
  loadDevice,
}));
vi.mock("../lib/importExport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/importExport")>()),
  triggerDownload,
}));
vi.mock("../lib/accountExport", () => ({
  generateAccountExportData: () => ({ filename: "vault.json", mime: "application/json", data: "{}" }),
}));

const session = { state: { username: "ada" } } as unknown as Session;

beforeEach(() => {
  exportVault.mockReset().mockResolvedValue({ objects: [], unreadable: 0 });
  loadDevice.mockReset();
  triggerDownload.mockReset();
});

function submit(password: string) {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Export…" }));
}

describe("exporting the account", () => {
  it("does nothing until a password is entered", () => {
    render(<AccountExportSection session={session} />);
    expect(screen.getByRole("button", { name: "Export…" }).hasAttribute("disabled")).toBe(true);
    expect(exportVault).not.toHaveBeenCalled();
  });

  it("reads and downloads nothing for a wrong password", async () => {
    loadDevice.mockResolvedValue(null);
    render(<AccountExportSection session={session} />);
    submit("not it");

    expect(await screen.findByText("Wrong password.")).toBeDefined();
    expect(exportVault).not.toHaveBeenCalled();
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it("exports once the password opens this device's record, and forgets the password", async () => {
    loadDevice.mockResolvedValue({});
    render(<AccountExportSection session={session} />);
    submit("correct horse battery");

    await waitFor(() => expect(triggerDownload).toHaveBeenCalledTimes(1));
    expect(loadDevice).toHaveBeenCalledWith("correct horse battery");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });
});
