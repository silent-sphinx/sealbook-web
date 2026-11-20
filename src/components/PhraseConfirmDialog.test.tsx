// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePhraseConfirm, RotationAbandoned } from "../lib/usePhraseConfirm";

const PHRASE = Array.from({ length: 24 }, (_, i) => `word${i + 1}`).join(" ");

afterEach(cleanup);

function Harness({ onResult }: { onResult: (outcome: "confirmed" | "abandoned") => void }) {
  const { confirm, dialog } = usePhraseConfirm();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void confirm(PHRASE).then(
            () => onResult("confirmed"),
            (err: unknown) => onResult(err instanceof RotationAbandoned ? "abandoned" : "confirmed"),
          )
        }
      >
        rotate
      </button>
      {dialog}
    </>
  );
}

/** The words the dialog asked for, read back from its field labels. */
function typeRequestedWords(value: (position: number) => string) {
  for (const input of screen.getAllByRole("textbox")) {
    const label = input.closest("label")?.textContent ?? "";
    const position = Number(/Word (\d+)/u.exec(label)?.[1]);
    fireEvent.change(input, { target: { value: value(position) } });
  }
}

describe("the phrase confirmation", () => {
  it("shows the words and waits, so nothing can be sent yet", () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText("rotate"));

    expect(screen.getByText("word1")).toBeDefined();
    expect(screen.getByText("word24")).toBeDefined();
    expect(onResult).not.toHaveBeenCalled();
  });

  it("abandons the rotation when it is closed", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText("rotate"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(onResult).toHaveBeenCalledWith("abandoned");
  });

  it("refuses wrong words and goes on only for the right ones", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText("rotate"));
    fireEvent.click(screen.getByRole("button", { name: "I have written them down" }));

    typeRequestedWords(() => "nope");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm and continue" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("do not match");
    expect(onResult).not.toHaveBeenCalled();

    typeRequestedWords((position) => `word${position}`);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm and continue" }));
    });
    expect(onResult).toHaveBeenCalledWith("confirmed");
  });

  it("abandons a rotation still waiting when the screen goes away", async () => {
    const onResult = vi.fn();
    const view = render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText("rotate"));
    await act(async () => {
      view.unmount();
    });

    expect(onResult).toHaveBeenCalledWith("abandoned");
  });
});
