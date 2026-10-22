import { afterEach, describe, expect, it, vi } from "vitest";

import { LAST_TAB_KEY, loadLastTab, MAIN_TABS, saveLastTab } from "./appState";

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
