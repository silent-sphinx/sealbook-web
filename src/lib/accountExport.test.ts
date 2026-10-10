import { describe, expect, it } from "vitest";

import {
  ACCOUNT_EXPORT_TYPE,
  ACCOUNT_EXPORT_VERSION,
  accountExportFilename,
  buildAccountExport,
  generateAccountExportData,
} from "./accountExport";
import type { VaultExport } from "./client";
import type { DeviceState } from "./types";

const state: DeviceState = {
  server: "https://vault.example",
  username: "Ada Lovelace",
  account_id: "00000000-0000-0000-0000-0000000000aa",
  collection_id: "00000000-0000-0000-0000-0000000000bb",
  device_id: "00000000-0000-0000-0000-0000000000cc",
  kdf_salt: "",
  hpke_sk: "",
  mldsa_seed: "",
  ed25519_sk: "",
};

const vault: VaultExport = {
  objects: [
    {
      id: "00000000-0000-0000-0000-000000000002",
      contentType: "application/sealbook.note+json",
      payload: '{"@type":"Note","title":"Plan","pinned":true,"parentId":"x"}',
    },
    {
      id: "00000000-0000-0000-0000-000000000001",
      contentType: "application/jscontact+json",
      payload: '{"@type":"Card","name":{"full":"Ada"}}',
    },
    {
      id: "00000000-0000-0000-0000-000000000003",
      contentType: "application/sealbook.future+json",
      payload: '{"keep":"me"}',
    },
  ],
  unreadable: 0,
};

describe("buildAccountExport", () => {
  it("carries every object, including a content type this build cannot read", () => {
    const bundle = buildAccountExport(state, vault, "2026-10-10T00:00:00.000Z");

    expect(bundle["@type"]).toBe(ACCOUNT_EXPORT_TYPE);
    expect(bundle.version).toBe(ACCOUNT_EXPORT_VERSION);
    expect(bundle.exportedAt).toBe("2026-10-10T00:00:00.000Z");
    expect(bundle.account).toEqual({
      server: "https://vault.example",
      username: "Ada Lovelace",
      accountId: state.account_id,
      collectionId: state.collection_id,
      deviceId: state.device_id,
    });
    expect(bundle.objectCount).toBe(3);
    expect(bundle.objects.map((object) => object.contentType)).toEqual([
      "application/jscontact+json",
      "application/sealbook.future+json",
      "application/sealbook.note+json",
    ]);
    const future = bundle.objects[1];
    expect(future.payload).toEqual({ keep: "me" });
  });

  it("keeps the fields no view of a note reads", () => {
    const bundle = buildAccountExport(state, vault);
    const note = bundle.objects.find(
      (object) => object.contentType === "application/sealbook.note+json",
    );
    expect(note?.payload).toEqual({
      "@type": "Note",
      title: "Plan",
      pinned: true,
      parentId: "x",
    });
  });

  it("sorts by content type then id, so an unchanged vault exports the same bytes", () => {
    const first = buildAccountExport(state, vault, "fixed");
    const shuffled = { ...vault, objects: [...vault.objects].reverse() };
    const second = buildAccountExport(state, shuffled, "fixed");
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("keeps a payload that is not JSON rather than dropping it", () => {
    const bundle = buildAccountExport(state, {
      objects: [{ id: "x", contentType: "application/octet-stream", payload: "not json" }],
      unreadable: 0,
    });
    expect(bundle.objects[0].text).toBe("not json");
    expect(bundle.objects[0].payload).toBeUndefined();
  });

  it("states how many objects this device could not open, and nothing when none", () => {
    expect(buildAccountExport(state, vault).unreadable).toBeUndefined();
    expect(buildAccountExport(state, { ...vault, unreadable: 2 }).unreadable).toBe(2);
  });
});

describe("accountExportFilename", () => {
  it("slugs the username and dates the file", () => {
    expect(accountExportFilename("Ada Lovelace", new Date("2026-10-10T12:00:00Z"))).toBe(
      "sealbook-account-ada-lovelace-2026-10-10.json",
    );
    expect(accountExportFilename("..", new Date("2026-10-10T12:00:00Z"))).toBe(
      "sealbook-account-export-2026-10-10.json",
    );
  });
});

describe("generateAccountExportData", () => {
  it("serializes the bundle as readable JSON", () => {
    const { filename, mime, data } = generateAccountExportData(state, vault);
    expect(filename).toMatch(/^sealbook-account-ada-lovelace-\d{4}-\d{2}-\d{2}\.json$/u);
    expect(mime).toBe("application/json;charset=utf-8");
    const parsed = JSON.parse(data) as { objects: unknown[] };
    expect(parsed.objects).toHaveLength(3);
    expect(data).toContain("\n  ");
  });
});
