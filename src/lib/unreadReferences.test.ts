import { describe, expect, it } from "vitest";
import { listingFrom } from "./clientVault";
import { JSCONTACT_CONTENT_TYPE } from "./addressBook";
import { CONTACT_ATTACHMENTS_PROP, emptyDraft, serializeCard } from "./contact";
import { NOTE_CONTENT_TYPE } from "./note";
import type { LocalObject } from "./wasm";

const good = {
  id: "a1",
  filename: "p.png",
  mimeType: "image/png",
  byteSize: 1,
  adk: "k",
  contentHash: "h",
  chunkSize: 1,
  chunkCount: 1,
};

function note(payload: unknown, id = "n1"): LocalObject {
  return {
    id,
    content_type: NOTE_CONTENT_TYPE,
    revision: 1,
    tombstone: false,
    payload: typeof payload === "string" ? payload : JSON.stringify({ "@type": "Note", ...(payload as object) }),
  };
}

describe("rows the sweep must not trust the listing for", () => {
  it("counts none when every attachment entry was read", () => {
    const listing = listingFrom([note({ attachments: [good, { ...good, id: "a2" }] })], 0);
    expect(listing.unreadReferences).toBe(0);
    expect(listing.notes[0].attachments).toHaveLength(2);
  });

  it("counts an attachment entry the parser dropped", () => {
    const listing = listingFrom([note({ attachments: [good, { id: "a2" }] })], 0);
    expect(listing.notes[0].attachments).toHaveLength(1);
    expect(listing.unreadReferences).toBe(1);
  });

  it("counts a contact's dropped entries under its own key", () => {
    const stored = JSON.parse(serializeCard({ ...emptyDraft(), name: "Ada", attachments: [good] }));
    expect(stored[CONTACT_ATTACHMENTS_PROP]).toHaveLength(1);
    stored[CONTACT_ATTACHMENTS_PROP].push({ id: "x" });
    const contact: LocalObject = {
      id: "c1",
      content_type: JSCONTACT_CONTENT_TYPE,
      revision: 1,
      tombstone: false,
      payload: JSON.stringify(stored),
    };
    const listing = listingFrom([contact], 0);
    expect(listing.contacts).toHaveLength(1);
    expect(listing.contacts[0].attachments).toHaveLength(1);
    expect(listing.unreadReferences).toBe(1);
  });
});
