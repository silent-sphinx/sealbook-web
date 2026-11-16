// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { announceSessionEnd, listenForSessionEnd } from "./sessionChannel";
import { DEVICE_STORAGE_KEY } from "./storage";

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

describe("session end across tabs", () => {
  it("does not hand a tab its own announcement", async () => {
    const heard = vi.fn();
    stop = listenForSessionEnd(heard);
    announceSessionEnd("lock");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(heard).not.toHaveBeenCalled();
  });

  it("hears the device record being removed as a sign-out", () => {
    const heard = vi.fn();
    stop = listenForSessionEnd(heard);
    window.dispatchEvent(new StorageEvent("storage", { key: DEVICE_STORAGE_KEY, newValue: null }));
    expect(heard).toHaveBeenCalledWith("sign-out");
  });

  it("ignores other keys and a device record that was written", () => {
    const heard = vi.fn();
    stop = listenForSessionEnd(heard);
    window.dispatchEvent(new StorageEvent("storage", { key: "sealbook.accent", newValue: null }));
    window.dispatchEvent(new StorageEvent("storage", { key: DEVICE_STORAGE_KEY, newValue: "{}" }));
    expect(heard).not.toHaveBeenCalled();
  });

  it("stops listening once unsubscribed", () => {
    const heard = vi.fn();
    listenForSessionEnd(heard)();
    window.dispatchEvent(new StorageEvent("storage", { key: DEVICE_STORAGE_KEY, newValue: null }));
    expect(heard).not.toHaveBeenCalled();
  });
});
