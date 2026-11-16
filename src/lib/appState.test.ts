import { afterEach, describe, expect, it, vi } from "vitest";

import { LAST_TAB_KEY, loadLastTab, MAIN_TABS, passwordProblem, saveLastTab } from "./appState";

function stubSession(initial?: string) {
  const store = new Map<string, string>(initial === undefined ? [] : [[LAST_TAB_KEY, initial]]);
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadLastTab", () => {
  it("restores every tab that is saved", () => {
    for (const tab of MAIN_TABS.filter((candidate) => candidate !== "settings")) {
      stubSession();
      saveLastTab(tab);
      expect(loadLastTab()).toBe(tab);
    }
  });

  it("never saves or restores settings", () => {
    const store = stubSession();
    saveLastTab("settings");
    expect(store.size).toBe(0);
    stubSession("settings");
    expect(loadLastTab()).toBe("contacts");
  });

  it("falls back to contacts for nothing or for garbage", () => {
    stubSession();
    expect(loadLastTab()).toBe("contacts");
    stubSession("nonsense");
    expect(loadLastTab()).toBe("contacts");
  });
});

describe("the password floor", () => {
  it("refuses anything under 12 characters", () => {
    expect(passwordProblem("")).not.toBeNull();
    expect(passwordProblem("Sh0rt!pass")).not.toBeNull();
    expect(passwordProblem("elevenchars")).not.toBeNull();
  });

  it("counts characters rather than UTF-16 units", () => {
    expect(passwordProblem("😀".repeat(11))).not.toBeNull();
    expect(passwordProblem("😀".repeat(6) + "abcdef")).toBeNull();
  });

  it("refuses a repeated character and a common password", () => {
    expect(passwordProblem("a".repeat(20))).not.toBeNull();
    expect(passwordProblem("Password1234")).not.toBeNull();
  });

  it("accepts a passphrase", () => {
    expect(passwordProblem("correct horse battery")).toBeNull();
    expect(passwordProblem("twelve chars")).toBeNull();
  });
});
