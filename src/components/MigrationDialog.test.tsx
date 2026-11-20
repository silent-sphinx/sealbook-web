// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../lib/client";

const listDevices = vi.hoisted(() => vi.fn());

vi.mock("../lib/client", async () => {
  const actual = await vi.importActual<typeof import("../lib/client")>("../lib/client");
  return { ...actual, listDevices };
});

import { MigrationDialog } from "./MigrationDialog";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const session = { state: { device_id: ME }, rotationOwed: "upgrade" } as unknown as Session;

afterEach(cleanup);

function mount(onRun = vi.fn<(password: string, ids: string[]) => void>()) {
  listDevices.mockResolvedValue([{ device_id: ME }, { device_id: OTHER }]);
  render(
    <MigrationDialog
      session={session}
      deviceLabels={[]}
      busy={false}
      error={null}
      progress={{ done: 0, total: 0 }}
      onRun={onRun}
      onLater={() => undefined}
    />,
  );
  return onRun;
}

describe("the migration dialog", () => {
  it("revokes every other device by default", async () => {
    const onRun = mount();
    const box = await screen.findByRole("checkbox", { name: "Revoke all other devices" });
    expect((box as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByLabelText("Confirm your password"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace the key" }));

    expect(onRun).toHaveBeenCalledWith("correct horse battery", [OTHER]);
  });

  it("keeps the other devices when the box is cleared", async () => {
    const onRun = mount();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Revoke all other devices" }));
    fireEvent.change(screen.getByLabelText("Confirm your password"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace the key" }));

    await waitFor(() => expect(onRun).toHaveBeenCalledWith("correct horse battery", []));
  });

  it("says what is owed in core's words", async () => {
    mount();
    expect(await screen.findByText(/Replacing the vault key makes sure no old copy/u)).toBeDefined();
  });
});
