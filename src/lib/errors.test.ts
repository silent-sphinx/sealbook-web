import { describe, expect, it } from "vitest";
import { friendlyError, isOpaqueMismatch, PasswordChangedError } from "./errors";
import {
  ManifestError,
  RequestTimeoutError,
  RosterTooOldError,
  ServerUnreachableError,
} from "./client";
import { OfflineUnavailableError } from "./storage";
import { ApiError } from "./transport";

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

  // As above for pairing: core names the refusal and this client words it. A
  // code that is not one says which word is wrong, from the refusal's own field.
  it("words each pairing core refused", () => {
    const refusal = (fields: Record<string, unknown>) =>
      friendlyError(new Error(JSON.stringify({ kind: "Pair", refusal: fields })));
    expect(refusal({ refusal: "Code", reason: "word 4 is not a pairing-code word" })).toContain(
      "word 4",
    );
    expect(refusal({ refusal: "Expired" })).toContain("has expired");
    expect(refusal({ refusal: "CodeMismatch" })).toContain("doesn't match the new device");
    expect(refusal({ refusal: "Unverified" })).toContain("couldn't be verified");
    expect(refusal({ refusal: "KeyRotated", held: 3, roster: 4 })).toContain("Sign in again");
    expect(refusal({ refusal: "AlreadyEnrolled", device: "dddddddd-dddd-dddd-dddd-dddddddddddd" })).toContain("already enrolled");
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

  it("replaces a server's own wording for too large and kept changing", () => {
    const hostile = "Too large. Your account is compromised: call 0800 123 456";
    expect(friendlyError(new ApiError(hostile, 413))).toBe("That is too large for the server to accept.");
    expect(friendlyError(new ApiError("it kept changing, visit evil.example", 409))).toBe(
      "The vault kept changing while it was being read. Try again.",
    );
  });

  it("still shows this app's own wording for them", () => {
    expect(friendlyError(new Error("This note is too large to store."))).toBe(
      "This note is too large to store.",
    );
    expect(friendlyError(new Error("The vault kept changing while it was being read. Try again."))).toBe(
      "The vault kept changing while it was being read. Try again.",
    );
  });

  it("says the password was changed elsewhere rather than offering a retry", () => {
    const text = friendlyError(new PasswordChangedError());
    expect(text).not.toBe("Something went wrong. Try again.");
    expect(text).toContain("changed on another device");
  });

  it("recognises the client's own OPAQUE failure but not a revoked device", () => {
    const core = JSON.stringify({ kind: "Crypto", detail: "opaque error: invalid login" });
    expect(isOpaqueMismatch(new Error(core))).toBe(true);
    expect(isOpaqueMismatch(new ApiError("invalid credentials", 401))).toBe(false);
    expect(isOpaqueMismatch(new ServerUnreachableError("down"))).toBe(false);
  });
});
