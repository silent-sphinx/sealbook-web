import { putSealed } from "./clientFlush";
import type { Session } from "./clientCore";
import { listDevices } from "./clientPairing";
import {
  coreDescribeUserAgent,
  coreDeviceEntries,
  coreDeviceLabelEnsure,
  coreDeviceLabelRename,
  coreStaleDeviceLabels,
  coreUserAgentOs,
  type CoreDeviceEntry,
  type CoreDeviceKind,
  type CoreDeviceLabelObject,
} from "./wasm";

export type DeviceEntry = CoreDeviceEntry;
export type DeviceLabel = CoreDeviceLabelObject;

/** Mirrors `DEVICE_LABEL_CONTENT_TYPE` in sealbook-protocol. */
export const DEVICE_LABEL_CONTENT_TYPE = "application/sealbook.device+json";

/** Mirrors `MAX_DEVICE_NAME_CHARS` in sealbook-core. */
export const MAX_DEVICE_NAME_CHARS = 40;

/** The web app's platform line: "Firefox on macOS". */
export function browserPlatform(userAgent = navigator.userAgent): string {
  return coreDescribeUserAgent(userAgent);
}

/** The extension's platform line: the browser is implied, so only the OS. */
export function browserOs(userAgent = navigator.userAgent): string {
  return coreUserAgentOs(userAgent);
}

/**
 * Writes this device's label when it is missing or out of date. Returns the
 * label written, or undefined when nothing needed writing.
 */
export async function ensureDeviceLabel(
  session: Session,
  labels: DeviceLabel[],
  kind: CoreDeviceKind,
  platform: string,
): Promise<DeviceLabel | undefined> {
  const label = coreDeviceLabelEnsure(labels, session.state.device_id, kind, platform);
  if (!label) return undefined;
  await putSealed(session, label.object_id, DEVICE_LABEL_CONTENT_TYPE, false, label.payload);
  return label;
}

/** This device's display name from labels already listed, with no request. */
export function thisDeviceName(session: Session, labels: DeviceLabel[]): string {
  const id = session.state.device_id;
  try {
    return coreDeviceEntries([id], labels, id)[0]?.name ?? "";
  } catch {
    return "";
  }
}

/**
 * The verified roster with each device's name, this device first. Core
 * refuses an id that is not a UUID; such a roster lists by id rather than
 * throwing out of a render.
 */
export function deviceEntries(
  session: Session,
  roster: { device_id: string }[],
  labels: DeviceLabel[],
): DeviceEntry[] {
  const current = session.state.device_id;
  try {
    return coreDeviceEntries(
      roster.map((device) => device.device_id),
      labels,
      current,
    );
  } catch {
    return roster.map((device) => ({
      device_id: device.device_id,
      name: device.device_id,
      kind: "unknown",
      detail: "",
      is_current: device.device_id === current,
    }));
  }
}

/** Renames any device. An empty name restores the generated one. */
export async function renameDevice(
  session: Session,
  labels: DeviceLabel[],
  deviceId: string,
  name: string,
): Promise<DeviceLabel> {
  const label = coreDeviceLabelRename(labels, deviceId, name);
  await putSealed(session, label.object_id, DEVICE_LABEL_CONTENT_TYPE, false, label.payload);
  return label;
}

/** Tombstones labels whose device has left the roster, and race duplicates. */
export async function removeStaleDeviceLabels(
  session: Session,
  labels: DeviceLabel[],
): Promise<number> {
  const roster = (await listDevices(session)).map((device) => device.device_id);
  const stale = coreStaleDeviceLabels(roster, labels);
  for (const id of stale) {
    await putSealed(session, id, DEVICE_LABEL_CONTENT_TYPE, true, "");
  }
  return stale.length;
}
