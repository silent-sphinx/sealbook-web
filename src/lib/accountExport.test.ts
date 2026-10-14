import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_EXPORT_TYPE,
  ACCOUNT_EXPORT_VERSION,
  accountExportFilename,
  buildAccountExport,
  generateAccountExportData,
  parseAccountExport,
} from "./accountExport";
import { importBatches, type VaultExport } from "./client";
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

const bundleOf = (objects: unknown[]) =>
  `{"@type":"${ACCOUNT_EXPORT_TYPE}","version":"${ACCOUNT_EXPORT_VERSION}",` +
  `"objects":${JSON.stringify(objects)}}`;

describe("parseAccountExport", () => {
  it("reads an export back as the objects it was written from", () => {
    const { data } = generateAccountExportData(state, vault);
    const { objects, source } = parseAccountExport(data);

    expect(source).toBe("Ada Lovelace at https://vault.example");
    // Sorted as the export sorts, and the payloads are the stored text.
    expect(objects).toEqual([
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
      {
        id: "00000000-0000-0000-0000-000000000002",
        contentType: "application/sealbook.note+json",
        payload: '{"@type":"Note","title":"Plan","pinned":true,"parentId":"x"}',
      },
    ]);
  });

  it("restores a payload that was not JSON as those same bytes", () => {
    const { data } = generateAccountExportData(state, {
      objects: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          contentType: "application/octet-stream",
          payload: "not json at all",
        },
      ],
      unreadable: 0,
    });
    expect(parseAccountExport(data).objects[0]?.payload).toBe("not json at all");
  });

  it("refuses a file it cannot restore", () => {
    expect(() => parseAccountExport("}{")).toThrow(/not a JSON document/iu);
    expect(() => parseAccountExport('"a string"')).toThrow(/not a JSON document/iu);
    expect(() => parseAccountExport('{"@type":"SomethingElse"}')).toThrow(
      /not a Sealbook account export/iu,
    );
    expect(() => parseAccountExport(`{"@type":"${ACCOUNT_EXPORT_TYPE}"}`)).toThrow(/no version/iu);
    // A version whose major this build does not read.
    expect(() =>
      parseAccountExport(`{"@type":"${ACCOUNT_EXPORT_TYPE}","version":"2.0","objects":[]}`),
    ).toThrow(/version 2\.0/u);
    expect(() =>
      parseAccountExport(`{"@type":"${ACCOUNT_EXPORT_TYPE}","version":"1.0"}`),
    ).toThrow(/no objects/iu);
    expect(() =>
      parseAccountExport(
        `{"@type":"${ACCOUNT_EXPORT_TYPE}","version":"1.0","objects":[{"contentType":"a"}]}`,
      ),
    ).toThrow(/not a UUID/iu);
    expect(() =>
      parseAccountExport(
        `{"@type":"${ACCOUNT_EXPORT_TYPE}","version":"1.0","objects":[` +
          `{"id":"00000000-0000-0000-0000-000000000001","payload":{}}]}`,
      ),
    ).toThrow(/no contentType/iu);
    expect(() =>
      parseAccountExport(
        `{"@type":"${ACCOUNT_EXPORT_TYPE}","version":"1.0","objects":[` +
          `{"id":"00000000-0000-0000-0000-000000000001","contentType":"a"}]}`,
      ),
    ).toThrow(/neither a payload nor text/iu);
    // Two objects at one id: the batch write would refuse it later, and the file
    // is wrong either way.
    expect(() =>
      parseAccountExport(
        `{"@type":"${ACCOUNT_EXPORT_TYPE}","version":"1.0","objects":[` +
          `{"id":"00000000-0000-0000-0000-000000000001","contentType":"a","payload":{}},` +
          `{"id":"00000000-0000-0000-0000-000000000001","contentType":"a","payload":{}}]}`,
      ),
    ).toThrow(/repeats id/iu);
  });

  it("reads a newer minor version, fields it does not know included", () => {
    const { objects } = parseAccountExport(
      `{"@type":"${ACCOUNT_EXPORT_TYPE}","version":"1.7","objects":[` +
        `{"id":"00000000-0000-0000-0000-000000000001","contentType":"a",` +
        `"payload":{"writtenByANewerClient":true}}]}`,
    );
    expect(objects).toHaveLength(1);
    expect(objects[0]?.payload).toBe('{"writtenByANewerClient":true}');
  });

  it("carries the count of what the exporting device could not open", () => {
    // A web export writes `unreadable` when it was short of the vault, so an
    // import of that file cannot be a complete restore.
    expect(
      parseAccountExport(
        `{"@type":"${ACCOUNT_EXPORT_TYPE}","version":"1.0","unreadable":3,"objects":[]}`,
      ).unreadable,
    ).toBe(3);
    const { data } = generateAccountExportData(state, { ...vault, unreadable: 2 });
    expect(parseAccountExport(data).unreadable).toBe(2);
    // Absent when the export was whole, which is the common case.
    expect(parseAccountExport(bundleOf([])).unreadable).toBe(0);
  });

  it("names the file's account even when it has no account block", () => {
    const { source } = parseAccountExport(
      `{"@type":"${ACCOUNT_EXPORT_TYPE}","version":"1.0","objects":[]}`,
    );
    expect(source).toBe("an export with no account block");
  });
});

describe("a backup from the v1.0.0 release", () => {
  /**
   * That release's own output, generated by it and kept as a fixture. The same
   * file `a_v1_release_export_parses_into_every_object_it_carries` reads in the
   * server repo, so both clients are held to one document.
   */
  // Decoded rather than read as text: the `node:fs` shim in `src/node-fs.d.ts`
  // is deliberately the one byte-returning overload the suite needs.
  const fixture = new TextDecoder().decode(
    readFileSync(new URL("../test/fixtures/v1.0.0-account-export.json", import.meta.url)),
  );

  it("parses into every object it carries", () => {
    const { objects, source, unreadable } = parseAccountExport(fixture);

    expect(source).toBe("alice at https://vault.example");
    expect(unreadable).toBe(0);
    expect(objects.map((object) => object.contentType)).toEqual([
      "application/jscontact+json",
      "application/sealbook.addressbook+json",
      "application/sealbook.note+json",
      "application/sealbook.calendarevent+json",
      "application/sealbook.future+json",
      "application/octet-stream",
    ]);
    expect(objects[0]?.id).toBe("00000000-0000-0000-0000-000000000001");
    // Fields no view of a note reads are still in what goes back.
    expect(JSON.parse(objects[2]!.payload)).toMatchObject({
      title: "Weekly plan",
      pinned: true,
    });
    // The type this build has no parser for, and the non-JSON escape hatch.
    expect(JSON.parse(objects[4]!.payload)).toEqual({ keep: "me" });
    expect(objects[5]?.payload).toBe("not json at all");
  });

  it("batches into one request, since it is small", () => {
    expect(importBatches(parseAccountExport(fixture).objects)).toHaveLength(1);
  });
});
