import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import init from "../pkg/sealbook_wasm.js";

import { payloadSchemaVersion, protocolVersion } from "./wasm";

import { serializeAccountSettings } from "./accountSettings";
import { serializeAddressBook } from "./addressBook";
import { serializeCard } from "./contact";
import { serializeNote, serializeNotebook } from "./note";
import { PAYLOAD_SCHEMA_VERSION, mergePayload, payloadSchemaReadable } from "./payload";
import { PROTOCOL_VERSION as PROTOCOL_VERSION_TS } from "./protocol";
import { DEFAULT_ACCOUNT_SETTINGS } from "./accountSettings";
import type { ContactDraft, NoteDraft } from "./types";

const OWNED = ["@type", "version", "title"] as const;

function parsed(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("mergePayload", () => {
  it("carries through a field this build does not own", () => {
    const previous = JSON.stringify({ "@type": "Note", title: "old", futureField: 7 });
    const merged = parsed(mergePayload(previous, { "@type": "Note", title: "new" }, OWNED));
    expect(merged.title).toBe("new");
    expect(merged.futureField).toBe(7);
  });

  it("does not resurrect an owned field the caller has just cleared", () => {
    // The serialisers omit an empty optional rather than writing null, so an
    // owned key absent from `fields` means cleared, not unmanaged.
    const previous = JSON.stringify({ "@type": "Note", title: "old" });
    const merged = parsed(mergePayload(previous, { "@type": "Note" }, OWNED));
    expect("title" in merged).toBe(false);
  });

  it("writes the fields alone when there is no previous payload", () => {
    expect(parsed(mergePayload(undefined, { a: 1 }, OWNED))).toEqual({ a: 1 });
    expect(parsed(mergePayload("", { a: 1 }, OWNED))).toEqual({ a: 1 });
  });

  it("ignores a previous payload that is not a JSON object", () => {
    expect(parsed(mergePayload("not json", { a: 1 }, OWNED))).toEqual({ a: 1 });
    expect(parsed(mergePayload("[1,2]", { a: 1 }, OWNED))).toEqual({ a: 1 });
    expect(parsed(mergePayload("null", { a: 1 }, OWNED))).toEqual({ a: 1 });
  });
});

describe("payloadSchemaReadable", () => {
  it("accepts this build's own version and any minor within it", () => {
    expect(payloadSchemaReadable(PAYLOAD_SCHEMA_VERSION)).toBe(true);
    expect(payloadSchemaReadable("1.9")).toBe(true);
  });

  it("refuses a newer major", () => {
    expect(payloadSchemaReadable("2.0")).toBe(false);
  });

  it("accepts a payload with no usable version, since every field is optional", () => {
    expect(payloadSchemaReadable(undefined)).toBe(true);
    expect(payloadSchemaReadable("")).toBe(true);
    expect(payloadSchemaReadable("beta")).toBe(true);
  });
});

describe("every payload a save writes", () => {
  const draft: NoteDraft = { title: "T", body: "B", notebookId: "" };

  it("keeps an unknown field on a note", () => {
    const previous = JSON.stringify({ "@type": "Note", title: "old", tableOfContents: true });
    const merged = parsed(serializeNote({ ...draft, raw: previous }));
    expect(merged.tableOfContents).toBe(true);
    expect(merged.title).toBe("T");
    expect(merged.version).toBe(PAYLOAD_SCHEMA_VERSION);
  });

  it("keeps an unknown field on a notebook", () => {
    const previous = JSON.stringify({ "@type": "Notebook", name: "old", icon: "folder" });
    expect(parsed(serializeNotebook("new", previous)).icon).toBe("folder");
  });

  it("keeps an unknown field on an address book", () => {
    const previous = JSON.stringify({ "@type": "AddressBook", name: "old", sortOrder: "given" });
    expect(parsed(serializeAddressBook("new", previous)).sortOrder).toBe("given");
  });

  it("keeps an unknown field on account settings", () => {
    const previous = JSON.stringify({ "@type": "AccountSettings", density: "compact" });
    const merged = parsed(serializeAccountSettings(DEFAULT_ACCOUNT_SETTINGS, previous));
    expect(merged.density).toBe("compact");
  });

  it("keeps an unknown field on a card", () => {
    const card: ContactDraft = {
      name: "Ada Lovelace",
      emails: [],
      phones: [],
      work: [],
      dates: [],
      socials: [],
      addresses: [],
      addressBookId: "",
      raw: JSON.stringify({ "@type": "Card", name: { full: "Ada" }, "sealbook:mood": "curious" }),
    };
    const merged = parsed(serializeCard(card));
    expect(merged["sealbook:mood"]).toBe("curious");
    expect((merged.name as { full: string }).full).toBe("Ada Lovelace");
  });

  it("drops an owned field a card no longer has, rather than carrying the old one", () => {
    const card: ContactDraft = {
      name: "Ada Lovelace",
      emails: [],
      phones: [],
      work: [],
      dates: [],
      socials: [],
      addresses: [],
      addressBookId: "",
      // The stored card had a nickname; this draft has none, so the save clears
      // it instead of merging the old value back in.
      raw: JSON.stringify({ "@type": "Card", nickNames: { n1: { name: "Countess" } } }),
    };
    expect("nickNames" in parsed(serializeCard(card))).toBe(false);
  });
});

describe("the versions this build declares", () => {
  beforeAll(async () => {
    const wasm = readFileSync(new URL("../pkg/sealbook_wasm_bg.wasm", import.meta.url));
    await init({ module_or_path: wasm });
  });

  it("match the Rust protocol crate's, which is where they are defined", () => {
    // Read through wasm rather than copied into the assertion: these strings are
    // duplicated in TypeScript for use before wasm loads, and a silent drift
    // between the two is what a protocol check exists to catch.
    expect(protocolVersion()).toBe(PROTOCOL_VERSION_TS);
    expect(payloadSchemaVersion()).toBe(PAYLOAD_SCHEMA_VERSION);
  });
});
