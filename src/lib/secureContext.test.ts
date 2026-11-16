import { describe, expect, it } from "vitest";
import { insecureContextReason } from "./secureContext";

describe("insecureContextReason", () => {
  it("is null on a secure page with the crypto API", () => {
    expect(insecureContextReason({ isSecureContext: true, crypto: { subtle: {} } })).toBeNull();
  });

  it("names the problem on a plain-HTTP page, where subtle is withheld", () => {
    expect(insecureContextReason({ isSecureContext: false, crypto: {} })).toMatch(/https/u);
    expect(insecureContextReason({ isSecureContext: true, crypto: {} })).toMatch(/secure connection/u);
    expect(insecureContextReason({})).toMatch(/secure connection/u);
  });
});
