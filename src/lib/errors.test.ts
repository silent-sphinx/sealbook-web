import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";
import {
  ManifestError,
  RequestTimeoutError,
  RosterTooOldError,
  ServerUnreachableError,
} from "./client";
import { OfflineUnavailableError } from "./storage";

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

  // Core refuses a rotation by naming the condition. The sentence is this
  // client's, and the condition must not fall through to the generic answer or
  // to the roster branch, which the serialized error's own text would match.
  it("words each rotation core refused", () => {
    const refusal = (name: string) =>
      friendlyError(new Error(JSON.stringify({ kind: "Rotation", refusal: { refusal: name } })));
    expect(refusal("LastDevice")).toBe("You can't revoke the last device.");
    expect(refusal("RevokingSelf")).toContain("signed in on");
    expect(refusal("NotInRoster")).toContain("already been removed");
    expect(refusal("NotEnrolled")).toContain("Sign in again");
    expect(
      friendlyError(
        new Error(
          JSON.stringify({
            kind: "Rotation",
            refusal: { refusal: "Unreadable", object: "a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5", reason: "Key" },
          }),
        ),
      ),
    ).toContain("nothing was changed");
  });

  // As above for pairing: core names the refusal and this client words it. The
  // two that carry numbers are worded from the refusal's own fields, so a
  // mismatch tells the user which device list each side is on.
  it("words each pairing core refused", () => {
    const refusal = (fields: Record<string, unknown>) =>
      friendlyError(new Error(JSON.stringify({ kind: "Pair", refusal: fields })));
    expect(refusal({ refusal: "NoAnchor" })).toContain("nothing to pair against");
    expect(refusal({ refusal: "ServerCode" })).toContain("don't agree on the account's devices");
    expect(refusal({ refusal: "Expired" })).toContain("has expired");
    expect(refusal({ refusal: "TypedCode" })).toContain("doesn't match");
    expect(refusal({ refusal: "KeyRotated", held: 3, roster: 4 })).toContain("Sign in again");
    expect(refusal({ refusal: "AlreadyEnrolled", device: "dddddddd-dddd-dddd-dddd-dddddddddddd" })).toContain("already enrolled");
    expect(refusal({ refusal: "RosterMoved", joined_at: 2, now: 3 })).toBe(
      "The new device started pairing against device list 2 but this account is now on 3. " +
        "Start the pairing again.",
    );
  });

  it("gives a roster failure its own answer", () => {
    const text = friendlyError(new ManifestError("roster mac does not verify"));
    expect(text).toContain("device list");
    expect(text).toContain("Nothing was changed");
  });

  it("tells a device that fell behind to pair rather than that it was tampered with", () => {
    const text = friendlyError(
      new RosterTooOldError(
        "This device has been away too long to check the account's device list. Pair it again " +
          "to carry on.",
      ),
    );
    // The message mentions the device list, so the roster branch would otherwise
    // claim verification failed when nothing did.
    expect(text).toContain("Pair it again");
    expect(text).not.toContain("couldn't verify");
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
    expect(text).toContain("unfinished recovery");
  });

  it("still maps the server's own refusals", () => {
    expect(friendlyError(new Error("username taken"))).toBe("That name is taken.");
    expect(friendlyError(new Error("rate limited"))).toBe("Too many tries. Wait a moment.");
    expect(friendlyError(new Error("those words didn't match the phrase"))).toBe(
      "Those words didn't match.",
    );
  });

  it("names an unreachable server instead of advising a retry", () => {
    const text = friendlyError(new ServerUnreachableError("The server could not be reached."));
    expect(text).not.toBe("Something went wrong. Try again.");
    expect(text).toContain("reach the server");
    expect(text).toContain("address");
  });

  it("separates a server that never answered from one that was never there", () => {
    const text = friendlyError(new RequestTimeoutError("sent nothing back within 30 seconds"));
    expect(text).not.toBe("Something went wrong. Try again.");
    expect(text).toContain("in time");
  });

  it("keeps the remedy when the vault needs the server this once", () => {
    // The generic fallback tells the user to try again, which is the one thing
    // that cannot work while they are offline.
    const message = "Connect to the server once before using the vault offline.";
    expect(friendlyError(new OfflineUnavailableError(message))).toBe(message);
  });

  it("falls back for anything it does not recognise", () => {
    expect(friendlyError(new Error("connection reset"))).toBe("Something went wrong. Try again.");
    expect(friendlyError("not an error at all")).toBe("Something went wrong. Try again.");
  });
});
