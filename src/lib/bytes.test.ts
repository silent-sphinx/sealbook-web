import { describe, expect, it } from "vitest";
import { b64ToByteArray, b64encode, bytesFromJson } from "./bytes";

/** Every byte value, so nothing is lost to a sign or a high bit. */
const allBytes = Uint8Array.from({ length: 256 }, (_, i) => i);

describe("b64encode", () => {
  it("encodes for a URL: no plus, slash or padding", () => {
    const encoded = b64encode(allBytes);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("encodes nothing as nothing", () => {
    expect(b64encode(new Uint8Array())).toBe("");
  });
});

describe("the base64 round trip", () => {
  it("returns every byte value unchanged", () => {
    // This carries key material: `hpke_sk`, `mldsa_seed` and `ed25519_sk` all
    // pass through here, and a byte lost is a key that no longer opens anything.
    expect(b64ToByteArray(b64encode(allBytes))).toEqual([...allBytes]);
  });

  it("survives every length, so padding is handled at each remainder", () => {
    for (let length = 0; length <= 8; length += 1) {
      const bytes = allBytes.slice(0, length);
      expect(b64ToByteArray(b64encode(bytes))).toEqual([...bytes]);
    }
  });
});

describe("b64ToByteArray", () => {
  it("reads the URL alphabet and the standard one alike", () => {
    // Bytes chosen to land on a `-`/`+` and a `_`/`/` in the output.
    const bytes = Uint8Array.from([251, 255, 190]);
    const url = b64encode(bytes);
    const standard = url.replaceAll("-", "+").replaceAll("_", "/");
    expect(url).not.toBe(standard);
    expect(b64ToByteArray(url)).toEqual([...bytes]);
    expect(b64ToByteArray(standard)).toEqual([...bytes]);
  });

  it("reads a padded string as well as a bare one", () => {
    expect(b64ToByteArray("QQ")).toEqual([65]);
    expect(b64ToByteArray("QQ==")).toEqual([65]);
  });
});

describe("bytesFromJson", () => {
  it("encodes a byte array", () => {
    expect(bytesFromJson([65, 66, 67])).toBe(b64encode(Uint8Array.from([65, 66, 67])));
  });

  it("leaves a string that is already base64 alone", () => {
    const encoded = b64encode(allBytes.slice(0, 32));
    expect(bytesFromJson(encoded)).toBe(encoded);
  });

  it("converts an array that was stored as its JSON text", () => {
    // What an older build wrote for these fields. Both spellings have to come
    // out as the same base64, or the same key reads differently per record.
    expect(bytesFromJson("[65,66,67]")).toBe(bytesFromJson([65, 66, 67]));
  });

  it("agrees on every byte value whichever way it was stored", () => {
    const asArray = bytesFromJson([...allBytes]);
    const asJsonText = bytesFromJson(JSON.stringify([...allBytes]));
    expect(asJsonText).toBe(asArray);
    expect(b64ToByteArray(asArray)).toEqual([...allBytes]);
  });

  it("keeps a base64 string that happens to begin with a digit", () => {
    // The heuristic that spots a stored array looks at the first character, so
    // this is the case it must not mangle.
    const encoded = b64encode(Uint8Array.from([235, 80, 0]));
    expect(encoded).toMatch(/^\d/u);
    expect(bytesFromJson(encoded)).toBe(encoded);
  });
});
