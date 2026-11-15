// @vitest-environment jsdom
/**
 * The camera has to go off whenever the scanner is done with it, including
 * when the stream only arrives after the scanner has gone.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import "../test/dom";
import { QrScanner } from "./QrScanner";

function fakeStream() {
  const track = { stop: vi.fn<() => void>() };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

function stubCamera(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("QrScanner", () => {
  it("stops a camera that starts after the scanner was closed", async () => {
    const { track, stream } = fakeStream();
    let grant: (value: MediaStream) => void = () => undefined;
    stubCamera(() => new Promise<MediaStream>((resolve) => (grant = resolve)));

    const view = render(<QrScanner onScan={vi.fn<(text: string) => void>()} onCancel={vi.fn<() => void>()} />);
    view.unmount();
    await act(async () => {
      grant(stream);
      await Promise.resolve();
    });

    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("stops the camera when the scanner closes while it is running", async () => {
    const { track, stream } = fakeStream();
    stubCamera(() => Promise.resolve(stream));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

    const view = render(<QrScanner onScan={vi.fn<(text: string) => void>()} onCancel={vi.fn<() => void>()} />);
    await act(async () => {
      await Promise.resolve();
    });
    view.unmount();

    expect(track.stop).toHaveBeenCalledOnce();
  });
});
