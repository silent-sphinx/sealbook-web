import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";
import { ManifestError } from "./client";

describe("friendlyError", () => {
  it("passes a manifest failure through instead of calling it a glitch", () => {
    const message = "Server sent 3 objects but the manifest commits to 4.";
    const text = friendlyError(new ManifestError(message));
    // The one class of failure that is never transient and never the user's
    // fault, so "try again" is the opposite of the advice they need.
    expect(text).not.toBe("Something went wrong. Try again.");
    expect(text).toContain(message);
    expect(text).toContain("signed for");
  });

  it("gives a roster failure its own answer", () => {
    const text = friendlyError(new ManifestError("roster mac does not verify"));
    expect(text).toContain("device list");
    expect(text).toContain("Nothing was changed");
  });

  it("does not read an unfinished recovery as a bad phrase", () => {
    // The server's refusal mentions the recovery phrase it will issue, which the
    // phrase branch below used to swallow as "those words didn't match".
    const text = friendlyError(
      new Error(
        "this account has an unfinished recovery: the collection key must be rotated before it " +
          "can be used again, which issues a new recovery phrase",
      ),
    );
    expect(text).toContain("Finish the interrupted recovery");
  });

  it("still maps the server's own refusals", () => {
    expect(friendlyError(new Error("username taken"))).toBe("That name is taken.");
    expect(friendlyError(new Error("rate limited"))).toBe("Too many tries. Wait a moment.");
    expect(friendlyError(new Error("those words didn't match the phrase"))).toBe(
      "Those words didn't match.",
    );
  });

  it("falls back for anything it does not recognise", () => {
    expect(friendlyError(new Error("connection reset"))).toBe("Something went wrong. Try again.");
    expect(friendlyError("not an error at all")).toBe("Something went wrong. Try again.");
  });
});
