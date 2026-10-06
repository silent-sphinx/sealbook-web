import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver } from "./autosave";

type Edit = { id: string; body: string };

function harness(over: Partial<Parameters<typeof createAutosaver<Edit>>[0]> = {}) {
  const saved: Edit[] = [];
  const saver = createAutosaver<Edit>({
    delay: 600,
    maxDelay: 3000,
    key: (edit) => edit.id,
    save: async (edit) => {
      saved.push(edit);
    },
    ...over,
  });
  return { saved, saver };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createAutosaver", () => {
  it("writes nothing until the typing stops", async () => {
    const { saved, saver } = harness();
    saver.schedule({ id: "a", body: "L" });
    await vi.advanceTimersByTimeAsync(500);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(saved).toEqual([{ id: "a", body: "L" }]);
  });

  it("coalesces a burst of edits into one write", async () => {
    const { saved, saver } = harness();
    for (const body of ["L", "Li", "Lis", "Lisb"]) {
      saver.schedule({ id: "a", body });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(600);
    expect(saved).toEqual([{ id: "a", body: "Lisb" }]);
  });

  it("writes during continuous typing once maxDelay is up", async () => {
    const { saved, saver } = harness();
    for (let i = 0; i < 20; i += 1) {
      saver.schedule({ id: "a", body: `x${i}` });
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.length).toBeLessThan(20);
  });

  it("keeps edits to different notes apart", async () => {
    const { saved, saver } = harness();
    saver.schedule({ id: "a", body: "one" });
    saver.schedule({ id: "b", body: "two" });
    await saver.flush();
    expect(saved).toEqual([
      { id: "a", body: "one" },
      { id: "b", body: "two" },
    ]);
  });

  it("never has two writes in flight at once", async () => {
    let inFlight = 0;
    let overlapped = false;
    const { saver } = harness({
      save: async () => {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
        inFlight -= 1;
      },
    });
    saver.schedule({ id: "a", body: "one" });
    saver.schedule({ id: "b", body: "two" });
    saver.schedule({ id: "c", body: "three" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(overlapped).toBe(false);
  });

  it("flushes without waiting for the timer", async () => {
    const { saved, saver } = harness();
    saver.schedule({ id: "a", body: "one" });
    await saver.flush();
    expect(saved).toEqual([{ id: "a", body: "one" }]);
    expect(saver.pending()).toBe(false);
  });

  it("picks up an edit made while a write is in flight", async () => {
    const seen: string[] = [];
    const { saver } = harness({
      save: async (edit) => {
        seen.push(edit.body);
        if (edit.body === "first") {
          saver.schedule({ id: "a", body: "second" });
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
    });
    saver.schedule({ id: "a", body: "first" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen).toEqual(["first", "second"]);
  });

  it("keeps a failed write queued instead of retrying in a loop", async () => {
    let attempts = 0;
    const errors: unknown[] = [];
    const { saver } = harness({
      save: async () => {
        attempts += 1;
        throw new Error("offline");
      },
      onError: (error) => errors.push(error),
    });
    saver.schedule({ id: "a", body: "one" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempts).toBe(1);
    expect(errors).toHaveLength(1);
    expect(saver.pending()).toBe(true);
  });

  it("retries a failed write on the next flush", async () => {
    let fail = true;
    const saved: string[] = [];
    const { saver } = harness({
      save: async (edit) => {
        if (fail) throw new Error("offline");
        saved.push(edit.body);
      },
    });
    saver.schedule({ id: "a", body: "one" });
    await saver.flush();
    expect(saved).toEqual([]);
    fail = false;
    await saver.flush();
    expect(saved).toEqual(["one"]);
    expect(saver.pending()).toBe(false);
  });

  it("does not overwrite a newer edit when an older one fails", async () => {
    let fail = true;
    const { saver } = harness({
      save: async (edit) => {
        if (fail) {
          fail = false;
          throw new Error("offline");
        }
        expect(edit.body).toBe("newer");
      },
    });
    saver.schedule({ id: "a", body: "older" });
    const flushed = saver.flush();
    saver.schedule({ id: "a", body: "newer" });
    await flushed;
    await saver.flush();
  });

  it("drops a queued write for a note that is going away", async () => {
    const { saved, saver } = harness();
    saver.schedule({ id: "a", body: "one" });
    saver.schedule({ id: "b", body: "two" });
    saver.drop("a");
    await saver.flush();
    expect(saved).toEqual([{ id: "b", body: "two" }]);
  });

  it("cancels everything outstanding", async () => {
    const { saved, saver } = harness();
    saver.schedule({ id: "a", body: "one" });
    saver.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(saved).toEqual([]);
    expect(saver.pending()).toBe(false);
  });
});

describe("queued", () => {
  it("ignores the write in flight, which pending() would count", async () => {
    let seen: { pending: boolean; queued: boolean } | null = null;
    const { saver } = harness({
      save: async () => {
        seen = { pending: saver.pending(), queued: saver.queued() };
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
    });
    saver.schedule({ id: "a", body: "one" });
    const flushed = saver.flush();
    await vi.advanceTimersByTimeAsync(100);
    await flushed;
    expect(seen).toEqual({ pending: true, queued: false });
  });

  it("reports an edit made while a write is in flight", async () => {
    let duringFirst: boolean | null = null;
    const { saver } = harness({
      save: async (edit) => {
        if (edit.body === "one") {
          saver.schedule({ id: "a", body: "two" });
          duringFirst = saver.queued();
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
    });
    saver.schedule({ id: "a", body: "one" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(duringFirst).toBe(true);
    expect(saver.queued()).toBe(false);
  });
});
