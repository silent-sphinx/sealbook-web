/**
 * The force simulation's contract, which the map's frame loop reads directly:
 * node coordinates live in one flat buffer indexed by the graph's own node
 * order, and edges resolve to index pairs into it once per graph rather than
 * per step. These pin the behaviour that indexing is meant to preserve.
 */

import { describe, expect, it } from "vitest";
import {
  COOLING_STEPS,
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

/** Star clusters whose ids interleave once sorted, the order the graph lists its nodes in. */
function interleavedClusters(sizes: number[]): { graph: ContactNetworkGraph; clusters: string[][] } {
  const clusters = sizes.map((size, c) =>
    Array.from({ length: size }, (_, i) => `${String(i).padStart(2, "0")}-${String.fromCharCode(97 + c)}`),
  );
  const graph = graphOf(
    clusters.flat().sort(),
    clusters.flatMap((ids) => ids.slice(1).map((id): [string, string] => [ids[0]!, id])),
  );
  return { graph, clusters };
}

/** Each cluster's centroid and the radius that takes in every member's avatar. */
function footprints(sim: NetworkSimulation, clusters: string[][]) {
  return clusters.map((ids) => {
    const points = ids.map((id) => sim.getPosition(id)!);
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    const radius = Math.max(...points.map((p) => distance(p, { x, y }))) + nodeRadius(0);
    return { x, y, radius };
  });
}

function centroid(sim: NetworkSimulation, ids: string[]): NetworkPoint {
  const points = ids.map((id) => sim.getPosition(id)!);
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
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
        const gap = owner(ids[i]) === owner(ids[j]) ? -1 : 4;
        expect(distance).toBeGreaterThan(radius * 2 + gap);
      }
    }
  });
});

describe("NetworkSimulation seeding and settling", () => {
  it("seeds each cluster in its own patch, so none starts tangled in another", () => {
    const { graph, clusters } = interleavedClusters([9, 6, 6]);
    const sim = new NetworkSimulation(graph, 800, 680);

    const seeded = footprints(sim, clusters);
    for (let i = 0; i < seeded.length; i++) {
      for (let j = i + 1; j < seeded.length; j++) {
        const a = seeded[i]!;
        const b = seeded[j]!;
        expect(distance(a, b)).toBeGreaterThan(a.radius + b.radius);
      }
    }
  });

  it("comes to rest within its cooling period rather than drifting on", () => {
    const { graph } = interleavedClusters([9, 6, 6, 3, 2, 4]);
    const sim = new NetworkSimulation(graph, 800, 680);

    expect(settle(sim)).toBeLessThanOrEqual(COOLING_STEPS);
    expect(sim.step()).toBe(false);
  });

  it("opens with no avatar of one cluster touching another's", () => {
    for (const sizes of [[9, 6, 6], [9, 6, 6, 3, 2, 4], [12, 2, 2, 2, 2, 2, 2, 5]]) {
      const { graph, clusters } = interleavedClusters(sizes);
      const sim = new NetworkSimulation(graph, 800, 680);
      sim.settle();

      const owner = new Map(clusters.flatMap((ids, c) => ids.map((id) => [id, c] as const)));
      const ids = clusters.flat();
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (owner.get(ids[i]!) === owner.get(ids[j]!)) continue;
          const gap = distance(sim.getPosition(ids[i]!)!, sim.getPosition(ids[j]!)!);
          expect(gap).toBeGreaterThan(nodeRadius(0) * 2);
        }
      }
    }
  });

  it("is still once settled, and stays still for a graph with the same nodes and links", () => {
    const { graph } = interleavedClusters([5, 3]);
    const sim = new NetworkSimulation(graph, WIDTH, HEIGHT);
    sim.settle();

    sim.setGraph({ ...graph, nodes: graph.nodes.map((node) => ({ ...node, name: `${node.name}!` })) });

    expect(sim.step()).toBe(false);
  });

  it("comes back to rest once a dragged node is let go", () => {
    const { graph } = interleavedClusters([5, 3]);
    const sim = new NetworkSimulation(graph, WIDTH, HEIGHT);
    sim.settle();

    sim.pin("00-a", { x: 60, y: 60 });
    for (let i = 0; i < 30; i++) expect(sim.step()).toBe(true);
    sim.unpin("00-a");

    expect(settle(sim)).toBeLessThan(COOLING_STEPS);
  });

  it("places a newcomer next to the contact it links to", () => {
    const sim = new NetworkSimulation(graphOf(["a", "b"], [["a", "b"]]), WIDTH, HEIGHT);
    sim.settle();
    const anchor = sim.getPosition("a")!;

    sim.setGraph(graphOf(["a", "b", "z"], [["a", "b"], ["a", "z"]]));

    expect(sim.getPosition("a")).toEqual(anchor);
    expect(distance(sim.getPosition("z")!, anchor)).toBeLessThan(distance(sim.getPosition("b")!, anchor));
  });

  it("places a cluster that joins the map clear of the ones already on it", () => {
    const { graph, clusters } = interleavedClusters([6, 4]);
    const sim = new NetworkSimulation(graph, 800, 680);
    sim.settle();
    const before = footprints(sim, clusters);

    const joining = ["x1", "x2", "x3"];
    sim.setGraph({
      ...graph,
      nodes: [...graph.nodes, ...graphOf(joining).nodes],
      edges: [...graph.edges, ...graphOf([], [["x1", "x2"], ["x1", "x3"]]).edges],
    });

    for (const id of joining) {
      const point = sim.getPosition(id)!;
      for (const existing of before) expect(distance(point, existing)).toBeGreaterThan(existing.radius);
    }
  });

  it("keeps the layout centred on the pane when it resizes", () => {
    const { graph } = interleavedClusters([5, 3]);
    const ids = graph.nodes.map((node) => node.id);
    const sim = new NetworkSimulation(graph, WIDTH, HEIGHT);
    sim.settle();
    const offset = { x: centroid(sim, ids).x - CENTER.x, y: centroid(sim, ids).y - CENTER.y };

    sim.resize(WIDTH + 200, HEIGHT + 100);

    const moved = centroid(sim, ids);
    expect(moved.x).toBeCloseTo(CENTER.x + 100 + offset.x, 6);
    expect(moved.y).toBeCloseTo(CENTER.y + 50 + offset.y, 6);
  });
});

describe("NetworkSimulation", () => {
  it("seeds every node at its own point inside the pane", () => {
    const ids = ["a", "b", "c", "d"];
    const sim = new NetworkSimulation(graphOf(ids), WIDTH, HEIGHT);

    const points = ids.map((id) => sim.getPosition(id)!);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(MARGIN);
      expect(point.x).toBeLessThanOrEqual(WIDTH - MARGIN);
      expect(point.y).toBeGreaterThanOrEqual(MARGIN);
      expect(point.y).toBeLessThanOrEqual(HEIGHT - MARGIN);
    }
    expect(new Set(points.map((point) => `${point.x},${point.y}`)).size).toBe(4);
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
