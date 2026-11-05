import { describe, expect, it } from "vitest";

import { browserOs, browserPlatform, DEVICE_LABEL_CONTENT_TYPE, MAX_DEVICE_NAME_CHARS } from "./devices";
import {
  coreDeviceEntries,
  coreDeviceLabelEnsure,
  coreDeviceLabelRename,
  corePayloadKind,
  coreStaleDeviceLabels,
  type CoreDeviceEntry,
  type CoreDeviceKind,
  type CoreDeviceLabelObject,
} from "./wasm";
import { listingFrom } from "./clientVault";
import { readFixture } from "../test/fixtures";

/** The shared device fixture, held to `sealbook-core/tests/devices.rs`. */
type Fixture = {
  constants: { content_type: string; max_name_chars: number };
  user_agents: { case: string; user_agent: string; os: string; described: string }[];
  writes: {
    case: string;
    labels: CoreDeviceLabelObject[];
    device_id: string;
    rename: string | null;
    kind: CoreDeviceKind;
    platform: string;
    payload: string | null;
    reused_object: boolean;
  }[];
  entries: {
    case: string;
    roster: string[];
    labels: CoreDeviceLabelObject[];
    current: string;
    entries: CoreDeviceEntry[];
    stale: string[];
  }[];
};

const fixture = JSON.parse(readFixture("payloads/devices.json")) as Fixture;

describe("device labels match the shared fixture", () => {
  it("mirrors core's constants", () => {
    expect(DEVICE_LABEL_CONTENT_TYPE).toBe(fixture.constants.content_type);
    expect(MAX_DEVICE_NAME_CHARS).toBe(fixture.constants.max_name_chars);
  });

  it.each(fixture.user_agents.map((row) => [row.case, row] as const))(
    "describes %s",
    (_, row) => {
      expect(browserPlatform(row.user_agent)).toBe(row.described);
      expect(browserOs(row.user_agent)).toBe(row.os);
    },
  );

  it.each(fixture.writes.map((row) => [row.case, row] as const))("writes: %s", (_, row) => {
    const written =
      row.rename === null
        ? coreDeviceLabelEnsure(row.labels, row.device_id, row.kind, row.platform)
        : coreDeviceLabelRename(row.labels, row.device_id, row.rename);
    expect(written?.payload ?? null).toBe(row.payload);
    expect(row.labels.some((label) => label.object_id === written?.object_id)).toBe(
      row.reused_object,
    );
  });

  it.each(fixture.entries.map((row) => [row.case, row] as const))("lists: %s", (_, row) => {
    expect(coreDeviceEntries(row.roster, row.labels, row.current)).toEqual(row.entries);
    expect(coreStaleDeviceLabels(row.roster, row.labels)).toEqual(row.stale);
  });

  it("collects labels from a listing and nothing else", () => {
    const label = fixture.entries[0].labels[0];
    expect(corePayloadKind(DEVICE_LABEL_CONTENT_TYPE, label.payload)).toBe("device_label");
    const listed = listingFrom(
      [
        { id: label.object_id, content_type: DEVICE_LABEL_CONTENT_TYPE, payload: label.payload },
      ] as Parameters<typeof listingFrom>[0],
      0,
    );
    expect(listed.deviceLabels).toEqual([label]);
    expect(listed.contacts).toEqual([]);
  });
});
