// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { printRecoveryWords } from "./printPhrase";
import { clearClipboard } from "./clipboard";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("printRecoveryWords", () => {
  it("prints from a frame of its own, with the words numbered, and does not rely on window.open", () => {
    const open = vi.spyOn(window, "open");
    const print = vi.fn();
    const original = HTMLIFrameElement.prototype;
    const contentWindow = Object.getOwnPropertyDescriptor(original, "contentWindow");
    let printed = "";
    Object.defineProperty(original, "contentWindow", {
      configurable: true,
      get(this: HTMLIFrameElement) {
        const real = contentWindow?.get?.call(this) as Window;
        real.print = () => {
          printed = this.contentDocument?.body.textContent ?? "";
          print();
        };
        return real;
      },
    });
    try {
      expect(printRecoveryWords(["alpha", "bravo", "charlie"], "Keep it safe.")).toBe(true);
    } finally {
      Object.defineProperty(original, "contentWindow", contentWindow!);
    }

    expect(open).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledTimes(1);
    expect(printed).toContain("1alpha");
    expect(printed).toContain("3charlie");
    expect(printed).toContain("Keep it safe.");
  });

  it("takes the frame, and the words with it, out of the page when printing ends", () => {
    printRecoveryWords(["alpha"], "n");
    const frame = document.querySelector("iframe");
    expect(frame).not.toBeNull();
    frame!.contentWindow!.dispatchEvent(new Event("afterprint"));
    expect(document.querySelector("iframe")).toBeNull();
  });
});

describe("clearClipboard", () => {
  it("tries again when the window is next focused if the first clear was refused", async () => {
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("document not focused"))
      .mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    clearClipboard();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenLastCalledWith("");
  });
});
