import { describe, expect, it } from "vitest";

import {
  accountExportFilename,
  generateAccountExportData,
  parseAccountExport,
} from "./accountExport";
import type { VaultExport } from "./client";
import type { DeviceState } from "./types";
import { coreAccountExportFilename, coreAccountExportParse, coreAccountExportWrite } from "./wasm";
import { readFixture } from "../test/fixtures";

type Fixture = {
  writes: {
    name: string;
    account: Parameters<typeof coreAccountExportWrite>[0];
    objects: Parameters<typeof coreAccountExportWrite>[1];
    unreadable: number;
    exported_at: string;
    document: string;
  }[];
  reads: {
    name: string;
    document: string;
    imported: ReturnType<typeof coreAccountExportParse> | null;
    error: string | null;
  }[];
  filenames: { username: string; day: string; filename: string }[];
};

const fixture = JSON.parse(readFixture("payloads/account_export.json")) as Fixture;

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
      contentType: "application/octet-stream",
      payload: "not json at all",
    },
  ],
  unreadable: 2,
};

describe("the shared account export fixture", () => {
  it.each(fixture.writes)("writes: $name", (c) => {
    expect(coreAccountExportWrite(c.account, c.objects, c.unreadable, c.exported_at)).toBe(
      c.document,
    );
  });

  it.each(fixture.reads.filter((c) => c.error !== null))("reads: $name", (c) => {
    expect(() => parseAccountExport(c.document)).toThrow(c.error as string);
  });

  it.each(fixture.reads.filter((c) => c.error === null))("reads: $name", (c) => {
    expect(coreAccountExportParse(c.document)).toEqual(c.imported);
  });

  it.each(fixture.filenames)("names the file for $username", (c) => {
    expect(coreAccountExportFilename(c.username, c.day)).toBe(c.filename);
  });
});

describe("generateAccountExportData", () => {
  it("writes the vault through core and names the file for the account", () => {
    const { filename, mime, data } = generateAccountExportData(state, vault, "fixed");
    expect(filename).toMatch(/^sealbook-account-ada-lovelace-\d{4}-\d{2}-\d{2}\.json$/u);
    expect(mime).toBe("application/json;charset=utf-8");
    const document = JSON.parse(data) as {
      exportedAt: string;
      unreadable: number;
      account: { accountId: string };
      objects: { contentType: string }[];
    };
    expect(document.exportedAt).toBe("fixed");
    expect(document.unreadable).toBe(2);
    expect(document.account.accountId).toBe(state.account_id);
    expect(document.objects.map((object) => object.contentType)).toEqual([
      "application/jscontact+json",
      "application/octet-stream",
      "application/sealbook.note+json",
    ]);
  });
});

describe("accountExportFilename", () => {
  it("dates the file with the given day", () => {
    expect(accountExportFilename("Ada Lovelace", new Date("2026-10-10T12:00:00Z"))).toBe(
      "sealbook-account-ada-lovelace-2026-10-10.json",
    );
  });
});

describe("parseAccountExport", () => {
  it("reads an export back as the objects it was written from", () => {
    const { data } = generateAccountExportData(state, vault);
    const { objects, source, unreadable } = parseAccountExport(data);

    expect(source).toBe("Ada Lovelace at https://vault.example");
    expect(unreadable).toBe(2);
    expect(objects).toEqual([
      {
        id: "00000000-0000-0000-0000-000000000001",
        contentType: "application/jscontact+json",
        // Read back through core, which moves a 1.0 payload to the current schema.
        payload:
          '{"@type":"Card","name":{"full":"Ada"},"sealbook:addressBookId":"00000000-0000-0000-0000-000000000001","sealbook:version":"1.1","version":"1.0"}',
      },
      {
        id: "00000000-0000-0000-0000-000000000003",
        contentType: "application/octet-stream",
        payload: "not json at all",
      },
      {
        id: "00000000-0000-0000-0000-000000000002",
        contentType: "application/sealbook.note+json",
        payload: '{"@type":"Note","parentId":"x","pinned":true,"title":"Plan","version":"1.1"}',
      },
    ]);
  });

  it("throws an Error carrying the sentence, not the serialised core error", () => {
    expect(() => parseAccountExport("}{")).toThrow(new Error("This is not a JSON document."));
  });
});

describe("an export written by the v1.0.0 release", () => {
  it("still imports every object it holds", () => {
    const document = readFixture("v1.0.0-account-export.json");
    const written = JSON.parse(document) as {
      objects: { id: string; contentType: string }[];
    };
    const { objects } = parseAccountExport(document);

    expect(objects.map((o) => [o.id, o.contentType])).toEqual(
      written.objects.map((o) => [o.id, o.contentType]),
    );
  });
});
