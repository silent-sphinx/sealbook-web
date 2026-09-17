import type { DeviceState } from "./types";

const KEY = "sealbook.device";

export function loadDevice(): DeviceState | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as DeviceState;
  } catch {
    return null;
  }
}

export function saveDevice(state: DeviceState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function clearDevice(): void {
  localStorage.removeItem(KEY);
}

export function downloadDevice(state: DeviceState): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ".sealbook-state.json";
  a.click();
  URL.revokeObjectURL(url);
}
