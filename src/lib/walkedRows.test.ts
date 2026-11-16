import { describe, expect, it } from "vitest";
import { checkRowsAgainstEntries, entryFor } from "./clientCore";
import { ManifestError } from "./roster";

const row = (over: Partial<Parameters<typeof entryFor>[0]> = {}) => ({
  id: "a",
  revision: 5,
  tombstone: false,
  nonce: "AAAAAAAAAAAAAAAA",
  ciphertext: "Y2lwaGVydGV4dA",
  ...over,
});

describe("checking an incremental read against the signed entries", () => {
  it("accepts rows that are what the manifest commits to", () => {
    const rows = [row(), row({ id: "b", tombstone: true, revision: 6 })];
    expect(checkRowsAgainstEntries(rows, rows.map(entryFor))).toBe("verified");
  });

  it("refuses a forged tombstone for an object the manifest holds live", () => {
    const forged = row({ tombstone: true, revision: 6 });
    expect(() => checkRowsAgainstEntries([forged], [entryFor(row({ revision: 6 }))])).toThrow(
      ManifestError,
    );
  });

  it("refuses an older ciphertext relabelled with the current revision", () => {
    const replayed = row({ ciphertext: "b2xkZXIgdmVyc2lvbg" });
    expect(() => checkRowsAgainstEntries([replayed], [entryFor(row())])).toThrow(ManifestError);
  });

  it("refuses an object the manifest does not list, and one newer than it", () => {
    expect(() => checkRowsAgainstEntries([row({ id: "z" })], [entryFor(row())])).toThrow(
      ManifestError,
    );
    expect(() =>
      checkRowsAgainstEntries([row({ revision: 9 })], [entryFor(row({ revision: 5 }))]),
    ).toThrow(ManifestError);
  });

  it("asks for another read, rather than crying tampering, when the manifest has moved on", () => {
    expect(checkRowsAgainstEntries([row()], [entryFor(row({ revision: 8 }))])).toBe("moved");
  });
});
