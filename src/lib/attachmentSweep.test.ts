// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { referencedAttachmentIds, SWEEP_INTERVAL_MS, sweepIfDue } from "./attachmentSweep";
import type { Session } from "./client";
import type { VaultListing } from "./clientVault";
import type { NoteAttachment } from "./types";

function attachment(id: string): NoteAttachment {
  return {
    id,
    filename: `${id}.png`,
    mimeType: "image/png",
    byteSize: 1,
    adk: "k",
    contentHash: "h",
    chunkSize: 1,
    chunkCount: 1,
  };
}

function listing(overrides: Partial<VaultListing> = {}): VaultListing {
  return {
    notes: [{ id: "n", attachments: [attachment("note-photo")] }],
    contacts: [{ id: "c", attachments: [attachment("contact-file")] }],
    unopened: 0,
    ...overrides,
  } as unknown as VaultListing;
}

const online = { offline: false, state: { collection_id: "col" } } as unknown as Session;
const NOW = 1_800_000_000_000;

beforeEach(() => localStorage.clear());

describe("referencedAttachmentIds", () => {
  it("includes note and contact attachments", () => {
    expect([...referencedAttachmentIds(listing())].sort()).toEqual(["contact-file", "note-photo"]);
  });
});

describe("sweepIfDue", () => {
  it("sweeps with everything the listing references", async () => {
    const sweep = vi.fn(async () => 3);
    expect(await sweepIfDue(online, listing(), sweep, NOW)).toBe(3);
    expect(sweep).toHaveBeenCalledWith(
      online,
      new Set(["note-photo", "contact-file"]),
      NOW,
    );
  });

  it("is skipped while any item could not be opened", async () => {
    const sweep = vi.fn(async () => 0);
    expect(await sweepIfDue(online, listing({ unopened: 1 }), sweep, NOW)).toBeNull();
    expect(sweep).not.toHaveBeenCalled();
  });

  it("is skipped offline", async () => {
    const sweep = vi.fn(async () => 0);
    const offline = { ...online, offline: true } as unknown as Session;
    expect(await sweepIfDue(offline, listing(), sweep, NOW)).toBeNull();
    expect(sweep).not.toHaveBeenCalled();
  });

  it("runs at most once a day", async () => {
    const sweep = vi.fn(async () => 0);
    await sweepIfDue(online, listing(), sweep, NOW);
    expect(await sweepIfDue(online, listing(), sweep, NOW + 60_000)).toBeNull();
    await sweepIfDue(online, listing(), sweep, NOW + SWEEP_INTERVAL_MS);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
});
