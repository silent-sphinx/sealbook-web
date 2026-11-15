// @vitest-environment jsdom
/**
 * The eight-word pairing code entry, mounted on its own.
 *
 * The code is one string in `App`'s state drawn as eight boxes, so every path
 * that fills a box has to split what it was given and report the whole code
 * back. What is under test is that splitting, the clamp at eight words, that
 * the code is only sent once it is complete, the scan option where a camera
 * exists, and the two stages after the code: waiting for the new device, and
 * asking before approving what it says it is.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "../test/dom";
import { AddDeviceModal } from "./AddDeviceModal";

const EIGHT = "alpha bravo charlie delta echo foxtrot golf hotel";

type Props = Parameters<typeof AddDeviceModal>[0];

function mount(overrides: Partial<Props> = {}) {
  const spies = {
    onCodeChange: vi.fn<(code: string) => void>(),
    onScanned: vi.fn<(code: string) => void>(),
    onSubmit: vi.fn<(event: { preventDefault: () => void }) => void>((event) =>
      event.preventDefault(),
    ),
    onBackToCode: vi.fn<() => void>(),
    onClose: vi.fn<() => void>(),
  };
  render(
    <AddDeviceModal
      busy={false}
      error={null}
      addCode=""
      stage="code"
      description=""
      {...spies}
      {...overrides}
    />,
  );
  return spies;
}

/** The eight word boxes, in order. */
function boxes(): HTMLInputElement[] {
  return within(screen.getByRole("dialog")).getAllByRole("textbox") as HTMLInputElement[];
}

/** A fake `ClipboardEvent`: jsdom has no `DataTransfer` for a paste to carry. */
function pasteEvent(text: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  return event;
}

describe("AddDeviceModal, entering the code", () => {
  it("draws eight numbered boxes for an empty code", () => {
    mount();

    expect(boxes()).toHaveLength(8);
    expect(boxes().every((box) => box.value === "")).toBe(true);
    // The number sits above its own box, so it is read from there rather than
    // from the page, where the numbered setup steps carry the same digits.
    const numbers = boxes().map((box) => box.parentElement?.firstElementChild?.textContent);
    expect(numbers).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("reports the whole code when one box is typed into", () => {
    const { onCodeChange } = mount({ addCode: "alpha" });

    fireEvent.change(boxes()[1], { target: { value: "bravo" } });

    expect(onCodeChange.mock.calls).toEqual([["alpha bravo"]]);
  });

  it("spreads a multi-word value across the boxes after it", () => {
    const { onCodeChange } = mount();

    fireEvent.change(boxes()[0], { target: { value: "alpha bravo charlie" } });

    expect(onCodeChange.mock.calls).toEqual([["alpha bravo charlie"]]);
  });

  it("drops the words past the eighth rather than running off the end", () => {
    const { onCodeChange } = mount();

    fireEvent.change(boxes()[6], {
      target: { value: "golf hotel india juliett" },
    });

    // The six boxes in front are still empty, which is what the leading spaces
    // are; only the trailing ones are trimmed.
    expect(onCodeChange.mock.calls).toEqual([["      golf hotel"]]);
  });

  it("fills from the box a paste landed in", () => {
    const { onCodeChange } = mount({ addCode: "alpha bravo" });

    fireEvent(boxes()[2], pasteEvent("charlie delta"));

    expect(onCodeChange.mock.calls).toEqual([["alpha bravo charlie delta"]]);
  });

  it("takes the whole code from the clipboard button", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: () => Promise.resolve(` ${EIGHT} india `) },
    });
    const { onCodeChange } = mount();

    fireEvent.click(screen.getByRole("button", { name: /Paste from clipboard/ }));

    await waitFor(() => expect(onCodeChange.mock.calls).toEqual([[EIGHT]]));
  });

  it("leaves the boxes alone when the clipboard cannot be read", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: () => Promise.reject(new Error("denied")) },
    });
    const { onCodeChange } = mount({ addCode: "alpha" });

    fireEvent.click(screen.getByRole("button", { name: /Paste from clipboard/ }));

    await waitFor(() => expect(onCodeChange).not.toHaveBeenCalled());
  });

  it("moves to the next box on space rather than typing one", async () => {
    mount({ addCode: "alpha" });

    boxes()[0].focus();
    fireEvent.keyDown(boxes()[0], { key: " " });

    // The focus move is deferred to the next frame, so the box is rendered by
    // the time it is asked for.
    await waitFor(() => expect(document.activeElement).toBe(boxes()[1]));
  });

  it("goes back a box on backspace in an empty one", async () => {
    mount({ addCode: "alpha" });

    boxes()[1].focus();
    fireEvent.keyDown(boxes()[1], { key: "Backspace" });

    await waitFor(() => expect(document.activeElement).toBe(boxes()[0]));
  });

  it("will not verify a code that is not finished", () => {
    mount({ addCode: "alpha bravo charlie" });

    const submit = screen.getByRole("button", { name: "Connect →" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("verifies a complete code", () => {
    const { onSubmit } = mount({ addCode: EIGHT });

    fireEvent.click(screen.getByRole("button", { name: "Connect →" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows a pairing failure where the code was entered", () => {
    mount({ addCode: EIGHT, error: "That code has expired." });

    expect(screen.getByRole("alert").textContent).toBe("That code has expired.");
  });
});

describe("AddDeviceModal, scanning", () => {
  it("offers no scan where the browser has no camera", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Scan QR code" })).toBeNull();
  });

  it("opens the camera, and says so plainly when it is not allowed", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
      },
    });
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));

    expect(screen.getByLabelText("Camera view")).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Camera access was not allowed/u),
    );
    fireEvent.click(screen.getByRole("button", { name: "Type the words instead" }));
    expect(boxes()).toHaveLength(8);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  });
});

describe("AddDeviceModal, after the code", () => {
  it("waits for the new device, with nothing to type and a way back", () => {
    const { onBackToCode, onSubmit } = mount({ addCode: EIGHT, stage: "waiting" });

    expect(screen.getByRole("status").textContent).toMatch(/Waiting for the new device/u);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBackToCode).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows what the new device says it is before approving", () => {
    mount({ addCode: EIGHT, stage: "approve", description: "Firefox on macOS" });

    expect(screen.getByRole("heading", { name: "Approve device" })).not.toBeNull();
    expect(screen.getByText("Firefox on macOS")).not.toBeNull();
  });

  it("approves the device", () => {
    const { onSubmit } = mount({ addCode: EIGHT, stage: "approve", description: "Pixel 8a" });

    fireEvent.click(screen.getByRole("button", { name: "Approve device" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("can be turned down", () => {
    const { onBackToCode, onSubmit } = mount({ addCode: EIGHT, stage: "approve" });

    fireEvent.click(screen.getByRole("button", { name: "Don't approve" }));

    expect(onBackToCode).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("holds both buttons while the transfer is running", () => {
    mount({ addCode: EIGHT, stage: "approve", busy: true });

    expect((screen.getByRole("button", { name: "Don't approve" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "Approving…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
