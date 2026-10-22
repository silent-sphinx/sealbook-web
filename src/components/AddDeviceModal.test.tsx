// @vitest-environment jsdom
/**
 * The eight-word pairing code entry, mounted on its own.
 *
 * The code is one string in `App`'s state drawn as eight boxes, so every path
 * that fills a box has to split what it was given and report the whole code
 * back. What is under test is that splitting, the clamp at eight words, and
 * that the approve step is only reachable once the code is complete.
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
      addConfirm={null}
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

    const submit = screen.getByRole("button", { name: "Next: Verify code →" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("verifies a complete code", () => {
    const { onSubmit } = mount({ addCode: EIGHT });

    fireEvent.click(screen.getByRole("button", { name: "Next: Verify code →" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows a pairing failure where the code was entered", () => {
    mount({ addCode: EIGHT, error: "That code has expired." });

    expect(screen.getByRole("alert").textContent).toBe("That code has expired.");
  });
});

describe("AddDeviceModal, approving the device", () => {
  it("shows the confirmation code in groups, and nothing to type into", () => {
    mount({ addCode: EIGHT, addConfirm: "ABCD2345" });

    expect(screen.getByRole("heading", { name: "Verify & approve device" })).not.toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText("ABCD")).not.toBeNull();
    expect(screen.getByText("2345")).not.toBeNull();
  });

  it("goes back to the code without approving", () => {
    const { onBackToCode, onSubmit } = mount({ addCode: EIGHT, addConfirm: "ABCD2345" });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBackToCode).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("approves the device", () => {
    const { onSubmit } = mount({ addCode: EIGHT, addConfirm: "ABCD2345" });

    fireEvent.click(screen.getByRole("button", { name: "Approve device" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("holds both buttons while the transfer is running", () => {
    mount({ addCode: EIGHT, addConfirm: "ABCD2345", busy: true });

    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Approving…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
