import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifyWalk } from "./clientRotation";
import { entryFor, requireManifestAbsenceOk, verifyManifest, type Session } from "./clientCore";
import type { ChangesWalk } from "./clientVault";

vi.mock("./clientCore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./clientCore")>()),
  verifyManifest: vi.fn(),
  requireManifestAbsenceOk: vi.fn(),
  entryFor: vi.fn((object: { id: string }) => ({ id: object.id })),
}));

const session = {} as Session;

function walk(manifestSeq: number | null): ChangesWalk {
  return {
    objects: [{ id: "c", revision: 4, tombstone: true }],
    keyEpoch: 1,
    latestRevision: 4,
    manifestJson: manifestSeq === null ? undefined : JSON.stringify({ manifest_seq: manifestSeq }),
    tombstoneFloor: 0,
    full: true,
  } as unknown as ChangesWalk;
}

describe("verifying the walk a rotation re-encrypts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks the served rows against the manifest they came with", async () => {
    await verifyWalk(session, walk(7), 7);
    expect(verifyManifest).toHaveBeenCalledWith(session, walk(7).manifestJson, [{ id: "c" }]);
    expect(entryFor).toHaveBeenCalled();
  });

  it("refuses rows the manifest does not vouch for", async () => {
    vi.mocked(verifyManifest).mockRejectedValueOnce(new Error("forged tombstone"));
    await expect(verifyWalk(session, walk(7), 7)).rejects.toThrow("forged tombstone");
  });

  it("refuses a walk from a different manifest than the one verified", async () => {
    await expect(verifyWalk(session, walk(8), 7)).rejects.toThrow(/changed while/);
  });

  it("applies the absence rule when no manifest was served", async () => {
    await verifyWalk(session, walk(null), 0);
    expect(requireManifestAbsenceOk).toHaveBeenCalledWith(session);
    expect(verifyManifest).not.toHaveBeenCalled();
  });
});
