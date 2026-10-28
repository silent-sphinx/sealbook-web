import { describe, expect, it } from "vitest";

import {
  DEFAULT_TASK_LIST_ID,
  DEFAULT_TASK_LIST_NAME,
  MAX_TASK_COMPLETIONS,
  TASK_CONTENT_TYPE,
  TASK_LIST_CONTENT_TYPE,
  completeTask,
  normalizeDueDate,
  parseTask,
  parseTaskList,
  reopenTask,
  resolveTaskListId,
  serializeTask,
  serializeTaskList,
  taskDraft,
  taskListTone,
} from "./task";
import {
  coreDefaultTaskListId,
  coreErrorOf,
  coreResolveTaskListId,
  coreTaskKeys,
  coreTaskListKeys,
} from "./wasm";
import type { CoreTask, CoreTaskDraft, CoreTaskList, CoreTaskListDraft } from "./wasm";
import { readFixture } from "../test/fixtures";

/**
 * The shared task fixture, through the same core the CLI and Android run. Held
 * to the same document as `sealbook-core/tests/tasks.rs`: the payloads are
 * pinned byte for byte, and nothing but this test says so when a key or a value
 * differs here.
 */
type Fixture = {
  constants: {
    task_content_type: string;
    list_content_type: string;
    task_keys: string[];
    list_keys: string[];
    default_list_id: string;
    default_list_name: string;
    max_completions: number;
  };
  writes: { case: string; draft: CoreTaskDraft; payload: string }[];
  parses: { case: string; id: string; raw: string; task: CoreTask }[];
  due_dates: { case: string; value: string; normalized?: string | null }[];
  list_writes: { case: string; draft: CoreTaskListDraft; payload: string }[];
  list_parses: { case: string; id: string; raw: string; list: CoreTaskList }[];
  tones: { case: string; lists: CoreTaskList[]; id: string; tone: string }[];
  refusals: { case: string; error: string }[];
};

const fixture = JSON.parse(readFixture("payloads/tasks.json")) as Fixture;

const NOW = "2026-10-28T12:00:00Z";

describe("the constants this client mirrors", () => {
  it("are core's", () => {
    expect(TASK_CONTENT_TYPE).toBe(fixture.constants.task_content_type);
    expect(TASK_LIST_CONTENT_TYPE).toBe(fixture.constants.list_content_type);
    expect(DEFAULT_TASK_LIST_ID).toBe(fixture.constants.default_list_id);
    expect(DEFAULT_TASK_LIST_ID).toBe(coreDefaultTaskListId());
    expect(DEFAULT_TASK_LIST_NAME).toBe(fixture.constants.default_list_name);
    expect(MAX_TASK_COMPLETIONS).toBe(fixture.constants.max_completions);
  });

  it("include the owned key sets", () => {
    expect(coreTaskKeys()).toEqual(fixture.constants.task_keys);
    expect(coreTaskListKeys()).toEqual(fixture.constants.list_keys);
  });

  it("resolve a list id the way core does", () => {
    for (const id of [undefined, "", "   ", "all", "l-7", " l-7 "]) {
      expect(resolveTaskListId(id)).toBe(coreResolveTaskListId(id));
    }
  });
});

describe("every due value the fixture holds", () => {
  it.each(fixture.due_dates.map((due, index) => [due.case, index] as const))(
    "normalises one way: %s",
    (_case, index) => {
      const due = fixture.due_dates[index];
      expect(normalizeDueDate(due.value)).toBe(due.normalized ?? undefined);
    },
  );

  it("reads a value that is not a string as no date", () => {
    for (const value of [undefined, null, 20261028, {}, []]) {
      expect(normalizeDueDate(value)).toBeUndefined();
    }
  });
});

describe("every task list tone the fixture holds", () => {
  it.each(fixture.tones.map((tone, index) => [tone.case, index] as const))(
    "resolves to one colour: %s",
    (_case, index) => {
      const tone = fixture.tones[index];
      expect(
        taskListTone(
          tone.lists.map((item) => parseTaskList(item.id, item.raw)),
          tone.id,
        ),
      ).toBe(tone.tone);
    },
  );
});

describe("a task an editor opens and saves without changing", () => {
  const stored = () => fixture.parses[0].raw;

  it("keeps what the editor cannot show", () => {
    const written = JSON.parse(serializeTask(taskDraft(parseTask("t1", stored())))) as Record<
      string,
      unknown
    >;
    expect(written.somethingNewer).toEqual({ from: "a later build" });
    expect(written.recurrenceAnchor).toBe("2026-09-01");
    expect(written.completions).toHaveLength(2);
  });

  it("does not title a task by saving it", () => {
    const task = parseTask("t2", '{"@type":"Task","dueDate":"2026-11-01"}');
    expect(task.title).toBe("Untitled task");
    expect(task.derivedTitle).toBe(true);
    const written = JSON.parse(serializeTask(taskDraft(task))) as { title: string };
    expect(written.title).toBe("");
  });

  it("does not title a task by ticking it either", () => {
    const task = parseTask("t3", '{"@type":"Task"}');
    const done = JSON.parse(serializeTask(completeTask(task, new Date(NOW), "UTC"))) as {
      title: string;
      done: boolean;
    };
    expect(done.done).toBe(true);
    expect(done.title).toBe("");
    const reopened = JSON.parse(serializeTask(reopenTask(parseTask("t3", serializeTask(completeTask(task, new Date(NOW), "UTC")))))) as {
      done?: boolean;
      title: string;
    };
    expect(reopened.done).toBeUndefined();
    expect(reopened.title).toBe("");
  });

  it("puts back a repeat rule this build cannot name", () => {
    const raw =
      '{"@type":"Task","title":"t","dueDate":"2026-11-01","recurrence":{"frequency":"hourly"},"recurrenceAnchor":"2026-11-01"}';
    const task = parseTask("t4", raw);
    expect(task.recurrence).toBeUndefined();
    const written = JSON.parse(serializeTask(taskDraft(task))) as Record<string, unknown>;
    expect(written.recurrence).toEqual({ frequency: "hourly" });
  });

  it("keeps a list's colour and parent through a rename", () => {
    const list = parseTaskList(
      "l1",
      '{"@type":"TaskList","name":"Home","parentId":"p","color":"#112233","x":1}',
    );
    const written = JSON.parse(
      serializeTaskList("Renamed", list.parentId, list.raw, list.color),
    ) as Record<string, unknown>;
    expect(written).toMatchObject({ name: "Renamed", parentId: "p", color: "#112233", x: 1 });
  });
});

describe("a payload from a newer schema major", () => {
  it("is read, and never written over", () => {
    const future = '{"@type":"Task","version":"2.0","title":"t"}';
    expect(parseTask("t1", future).readable).toBe(false);
    let caught: unknown;
    try {
      serializeTask({ ...taskDraft(parseTask("t1", future)), title: "edited" });
    } catch (err) {
      caught = err;
    }
    expect(coreErrorOf(caught)?.kind).toBe(fixture.refusals[0].error);

    caught = undefined;
    try {
      serializeTaskList("edited", undefined, '{"version":"3.1","name":"future"}');
    } catch (err) {
      caught = err;
    }
    expect(coreErrorOf(caught)?.kind).toBe(fixture.refusals[1].error);
  });
});
