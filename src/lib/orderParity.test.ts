import { describe, expect, it } from "vitest";
import { readFixture } from "../test/fixtures";
import {
  coreOrderByName,
  coreOrderByRecency,
  coreOrderContainers,
  type OrderItem,
} from "./wasm";

const fixture = JSON.parse(readFixture("payloads/ordering.json")) as {
  cases: {
    name: string;
    rule: string;
    default_id?: string;
    items: OrderItem[];
    order: string[];
  }[];
};

describe("list order", () => {
  it.each(fixture.cases)(
    "matches the fixture: $name",
    ({ rule, default_id, items, order }) => {
      const got =
        rule === "name"
          ? coreOrderByName(items)
          : rule === "containers"
            ? coreOrderContainers(default_id ?? "", items)
            : coreOrderByRecency(items, rule === "recency_pinned");
      expect(got).toEqual(order);
    },
  );
});
