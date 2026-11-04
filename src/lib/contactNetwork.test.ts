/**
 * The force simulation's contract, which the map's frame loop reads directly:
 * node coordinates live in one flat buffer indexed by the graph's own node
 * order, and edges resolve to index pairs into it once per graph rather than
 * per step. These pin the behaviour that indexing is meant to preserve.
 */

import { describe, expect, it } from "vitest";
import {
  NetworkSimulation,
  nodeRadius,
  type ContactNetworkGraph,
  type NetworkPoint,
} from "./contactNetwork";

const WIDTH = 400;
const HEIGHT = 300;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const MARGIN = 20;

function graphOf(ids: string[], pairs: [string, string][] = []): ContactNetworkGraph {
  return {
    nodes: ids.map((id) => ({ id, name: id, degree: 0 })),
    edges: pairs.map(([source, target]) => ({
      id: `${source}|${target}`,
      source,
      target,
      kind: "friends" as const,
    })),
    totalLinked: ids.length,
  };
}

function settle(sim: NetworkSimulation, limit = 5000): number {
  for (let i = 0; i < limit; i++) {
    if (!sim.step()) return i;
  }
  return limit;
}

function distance(a: NetworkPoint, b: NetworkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("NetworkSimulation cluster separation", () => {
  it("keeps separate clusters and their avatars from overlapping", () => {
    const clusters = [
      ["a1", "a2", "a3", "a4"],
      ["b1", "b2", "b3"],
      ["c1", "c2", "c3", "c4"],
    ];
    const graph = graphOf(
      clusters.flat(),
      clusters.flatMap((ids) => ids.slice(1).map((id): [string, string] => [ids[0], id])),
    );
    const sim = new NetworkSimulation(graph, 700, 500);
    expect(settle(sim)).toBeLessThan(5000);

    const radius = nodeRadius(0);
    for (const id of clusters.flat()) {
      const p = sim.getPosition(id)!;
      const atCorner = (p.x <= MARGIN + 1 || p.x >= 700 - MARGIN - 1) && (p.y <= MARGIN + 1 || p.y >= 500 - MARGIN - 1);
      expect(atCorner).toBe(false);
    }
    const owner = (id: string) => id[0];
    const ids = clusters.flat();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = sim.getPosition(ids[i])!;
        const b = sim.getPosition(ids[j])!;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        expect(distance).toBeGreaterThan(radius * 2 - 1);
        if (owner(ids[i]) !== owner(ids[j])) {
          expect(distance).toBeGreaterThan(radius * 2 + 4);
        }
      }
    }
  });
});

describe("NetworkSimulation", () => {
  it("seeds a node with no position yet on the ring around the centre", () => {
    const sim = new NetworkSimulation(graphOf(["a", "b", "c", "d"]), WIDTH, HEIGHT);
    const radius = Math.min(WIDTH, HEIGHT) * 0.35;

    const points = ["a", "b", "c", "d"].map((id) => sim.getPosition(id)!);
    for (const point of points) {
      expect(distance(point, CENTER)).toBeCloseTo(radius, 6);
    }
    expect(new Set(points.map((point) => point.x)).size).toBe(4);
  });

  it("reports movement until the layout settles, then stops", () => {
    const sim = new NetworkSimulation(graphOf(["a", "b", "c"], [["a", "b"]]), WIDTH, HEIGHT);

    const steps = settle(sim);
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThan(5000);
    expect(sim.step()).toBe(false);
  });

  it("keeps every node inside the pane margins", () => {
    const ids = Array.from({ length: 24 }, (_, i) => `c${i}`);
    const sim = new NetworkSimulation(graphOf(ids), WIDTH, HEIGHT);
    settle(sim);

    for (const id of ids) {
      const point = sim.getPosition(id)!;
      expect(point.x).toBeGreaterThanOrEqual(MARGIN);
      expect(point.x).toBeLessThanOrEqual(WIDTH - MARGIN);
      expect(point.y).toBeGreaterThanOrEqual(MARGIN);
      expect(point.y).toBeLessThanOrEqual(HEIGHT - MARGIN);
    }
  });

  it("holds a pinned node where it was put while the rest keeps moving", () => {
    const sim = new NetworkSimulation(graphOf(["a", "b"], [["a", "b"]]), WIDTH, HEIGHT);
    const before = sim.getPosition("b")!;

    sim.pin("a", { x: 30, y: 40 });
    for (let i = 0; i < 20; i++) sim.step();

    expect(sim.getPosition("a")).toEqual({ x: 30, y: 40 });
    expect(distance(sim.getPosition("b")!, before)).toBeGreaterThan(0);
  });

  it("lets a pinned node move again on unpin", () => {
    const sim = new NetworkSimulation(graphOf(["a", "b"], [["a", "b"]]), WIDTH, HEIGHT);
    sim.pin("a", { x: 30, y: 40 });
    sim.unpin("a");

    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.getPosition("a")).not.toEqual({ x: 30, y: 40 });
  });

  it("keeps a surviving node's position across a new graph and rings the newcomer", () => {
    const sim = new NetworkSimulation(graphOf(["a", "b"], [["a", "b"]]), WIDTH, HEIGHT);
    settle(sim);
    const kept = sim.getPosition("a")!;

    sim.setGraph(graphOf(["a", "b", "z"], [["a", "z"]]));

    expect(sim.getPosition("a")).toEqual(kept);
    expect(distance(sim.getPosition("z")!, CENTER)).toBeCloseTo(Math.min(WIDTH, HEIGHT) * 0.35, 6);
  });

  it("keeps a node pinned across a new graph, so a drag survives a refresh", () => {
    const sim = new NetworkSimulation(graphOf(["a", "b"], [["a", "b"]]), WIDTH, HEIGHT);
    sim.pin("a", { x: 30, y: 40 });

    sim.setGraph(graphOf(["b", "a", "z"], [["a", "z"]]));
    for (let i = 0; i < 20; i++) sim.step();

    expect(sim.getPosition("a")).toEqual({ x: 30, y: 40 });
  });

  it("lines coordinates up with the node order and endpoints with the edge order", () => {
    const graph = graphOf(
      ["a", "b", "c"],
      [
        ["b", "c"],
        ["a", "c"],
      ],
    );
    const sim = new NetworkSimulation(graph, WIDTH, HEIGHT);
    settle(sim);

    const coordinates = sim.coordinates();
    graph.nodes.forEach((node, index) => {
      expect({ x: coordinates[index * 2], y: coordinates[index * 2 + 1] }).toEqual(
        sim.getPosition(node.id),
      );
    });

    expect([...sim.endpoints()]).toEqual([1, 2, 0, 2]);
  });

  it("marks an endpoint the graph does not hold rather than stepping over a hole", () => {
    const graph = graphOf(["a", "b"], [["a", "ghost"]]);
    const sim = new NetworkSimulation(graph, WIDTH, HEIGHT);

    expect([...sim.endpoints()]).toEqual([0, -1]);
    expect(() => settle(sim)).not.toThrow();
  });

  it("ignores an unknown id", () => {
    const sim = new NetworkSimulation(graphOf(["a"]), WIDTH, HEIGHT);
    const before = sim.getPosition("a")!;

    sim.pin("nope", { x: 1, y: 2 });
    sim.unpin("nope");

    expect(sim.getPosition("nope")).toBeUndefined();
    expect(sim.getPosition("a")).toEqual(before);
  });
});
