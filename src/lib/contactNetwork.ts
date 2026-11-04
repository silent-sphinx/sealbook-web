import { LINKABLE_SECTIONS, profileOf, type LinkableSection } from "./contactProfile";
import type { Contact } from "./types";

export type ContactNetworkNode = {
  id: string;
  name: string;
  avatar?: string;
  degree: number;
};

export type ContactNetworkEdge = {
  id: string;
  source: string;
  target: string;
  kind: LinkableSection;
};

export type ContactNetworkGraph = {
  nodes: ContactNetworkNode[];
  edges: ContactNetworkEdge[];
  /** Nodes before the `MAX_NETWORK_NODES` cutoff, for a "showing N of M" note. */
  totalLinked: number;
};

export type ContactNetworkOptions = {
  /** When true, a contact with no links still appears, as an isolated node. */
  includeUnlinked?: boolean;
};

export type NetworkPoint = { x: number; y: number };

/** Nodes beyond this many are dropped, keeping the least-connected out first. */
export const MAX_NETWORK_NODES = 150;

/**
 * Builds the link graph from each contact's `family`/`friends`/`colleagues`
 * entries. Links are written reciprocally (both contacts get a `contactId`
 * entry), so a pair is only read once per kind rather than drawn twice. A
 * pair sharing more than one kind (e.g. both friends and colleagues) gets one
 * edge per kind, so the map draws a line for each relationship rather than
 * picking a single one to represent the pair.
 *
 * With `includeUnlinked`, every contact becomes a node even without an edge,
 * for the "every contact" view of the map rather than just its clusters.
 */
export function buildContactNetwork(
  contacts: Contact[],
  options: ContactNetworkOptions = {},
): ContactNetworkGraph {
  const byId = new Map<string, Contact>();
  for (const contact of contacts) {
    if (!contact.archived) byId.set(contact.id, contact);
  }

  const pairKinds = new Map<string, Set<LinkableSection>>();
  const degree = new Map<string, number>();

  for (const contact of byId.values()) {
    const profile = profileOf(contact.profile);
    for (const kind of LINKABLE_SECTIONS) {
      for (const person of profile[kind]) {
        if (!person.contactId || person.contactId === contact.id) continue;
        if (!byId.has(person.contactId)) continue;

        const key = [contact.id, person.contactId].sort().join("|");
        const kinds = pairKinds.get(key) ?? new Set<LinkableSection>();
        kinds.add(kind);
        pairKinds.set(key, kinds);
      }
    }
  }

  const edges: ContactNetworkEdge[] = [];
  for (const [key, kinds] of pairKinds) {
    const [source, target] = key.split("|") as [string, string];
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
    for (const kind of LINKABLE_SECTIONS) {
      if (kinds.has(kind)) edges.push({ id: `${key}:${kind}`, source, target, kind });
    }
  }

  const nodeIds = options.includeUnlinked ? [...byId.keys()] : [...degree.keys()];
  const nodes: ContactNetworkNode[] = nodeIds
    .sort()
    .map((id) => {
      const contact = byId.get(id)!;
      return { id, name: contact.name, avatar: contact.avatar, degree: degree.get(id) ?? 0 };
    });

  if (nodes.length <= MAX_NETWORK_NODES) return { nodes, edges, totalLinked: nodes.length };

  const kept = new Set(
    [...nodes]
      .sort((a, b) => b.degree - a.degree)
      .slice(0, MAX_NETWORK_NODES)
      .map((node) => node.id),
  );
  return {
    nodes: nodes.filter((node) => kept.has(node.id)),
    edges: edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
    totalLinked: nodes.length,
  };
}

const SPRING_STRENGTH = 0.02;
const DAMPING = 0.85;
const MIN_DISTANCE = 1;
const SETTLE_SPEED = 0.02;
const MARGIN = 20;

/** Edge length as a share of the pane area each node gets, bounded so avatars neither overlap nor strand each other. */
const SPACING_FACTOR = 0.6;
const MIN_SPRING_LENGTH = 60;
const MAX_SPRING_LENGTH = 260;
/** Repulsion relative to the square of the edge length, which keeps unlinked nodes roughly one edge apart. */
const REPEL_RATIO = 0.34;
/** The cloud settles at the radius where centering balances repulsion, so that radius is aimed at the pane. */
const TARGET_RADIUS_FACTOR = 0.45;
const MIN_CENTER_STRENGTH = 0.001;
const MAX_CENTER_STRENGTH = 0.05;

const MIN_NODE_RADIUS = 14;
const MAX_NODE_RADIUS = 30;
/** Clear space kept between two avatars. */
const NODE_GAP = 4;
const COLLISION_STRENGTH = 0.03;
/** Share of a cluster overlap corrected per step, and the most any node is moved by it. */
const CLUSTER_PUSH_RATE = 0.5;
const CLUSTER_PUSH_MAX = 6;

/** Drawn radius of a node, which the simulation also uses to keep avatars and clusters apart. */
export function nodeRadius(degree: number): number {
  return Math.min(Math.max(MIN_NODE_RADIUS + degree * 3, MIN_NODE_RADIUS), MAX_NODE_RADIUS);
}

/** Synchronous steps run when a simulation is first created, so the initial layout doesn't visibly spring into place. */
export const PRESETTLE_ITERATIONS = 250;

/**
 * A continuously-steppable force simulation: nodes repel each other, edges
 * pull their pair toward a rest length, and a weak centering force keeps the
 * graph from drifting off-canvas. Call `step()` once per frame to animate
 * it. Dragging a node calls `pin()` on every frame instead of moving it
 * directly, which holds it at the pointer while forces still propagate
 * through its edges each step, pulling connected nodes along with it.
 */
export class NetworkSimulation {
  private count = 0;
  private width: number;
  private height: number;
  /** `[x0, y0, x1, y1, ...]`, indexed by a node's place in the graph's node list. */
  private positions = new Float64Array(0);
  private velocities = new Float64Array(0);
  private forces = new Float64Array(0);
  private pinned = new Uint8Array(0);
  private radii = new Float64Array(0);
  private previous = new Float64Array(0);
  /** Connected group each node belongs to, as an index into the cluster arrays. */
  private clusterOf = new Int32Array(0);
  private clusterCount = 0;
  private clusterPx = new Float64Array(0);
  private clusterPy = new Float64Array(0);
  private indexById = new Map<string, number>();
  /** Edge endpoints as index pairs into `positions`, resolved once per graph rather than per step. */
  private edgePairs = new Int32Array(0);
  private springLength = MIN_SPRING_LENGTH;
  private repel = 0;
  private centerStrength = MIN_CENTER_STRENGTH;

  constructor(graph: ContactNetworkGraph, width: number, height: number) {
    this.width = width;
    this.height = height;
    this.setGraph(graph);
  }

  /** Scales the forces to the pane, so a graph spreads across the space it has rather than clumping at one fixed size. */
  private retune(): void {
    const count = Math.max(this.count, 1);
    const spacing = Math.sqrt((this.width * this.height) / count) * SPACING_FACTOR;
    this.springLength = Math.min(Math.max(spacing, MIN_SPRING_LENGTH), MAX_SPRING_LENGTH);
    this.repel = this.springLength * this.springLength * REPEL_RATIO;

    const targetRadius = Math.max(Math.min(this.width, this.height) * TARGET_RADIUS_FACTOR, 1);
    const strength = (count * this.repel) / targetRadius ** 3;
    this.centerStrength = Math.min(Math.max(strength, MIN_CENTER_STRENGTH), MAX_CENTER_STRENGTH);
  }

  /** Adopts a new graph, keeping positions for nodes that survive and starting new ones on the ring. */
  setGraph(graph: ContactNetworkGraph): void {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const radius = Math.min(this.width, this.height) * 0.35;
    const count = graph.nodes.length;

    const positions = new Float64Array(count * 2);
    const velocities = new Float64Array(count * 2);
    const pinned = new Uint8Array(count);
    const radii = new Float64Array(count);
    const indexById = new Map<string, number>();

    graph.nodes.forEach((node, index) => {
      indexById.set(node.id, index);
      radii[index] = nodeRadius(node.degree);
      const previous = this.indexById.get(node.id);
      if (previous === undefined) {
        const angle = (2 * Math.PI * index) / Math.max(count, 1);
        positions[index * 2] = centerX + radius * Math.cos(angle);
        positions[index * 2 + 1] = centerY + radius * Math.sin(angle);
        return;
      }
      positions[index * 2] = this.positions[previous * 2];
      positions[index * 2 + 1] = this.positions[previous * 2 + 1];
      velocities[index * 2] = this.velocities[previous * 2];
      velocities[index * 2 + 1] = this.velocities[previous * 2 + 1];
      pinned[index] = this.pinned[previous];
    });

    const edgePairs = new Int32Array(graph.edges.length * 2);
    graph.edges.forEach((edge, index) => {
      edgePairs[index * 2] = indexById.get(edge.source) ?? -1;
      edgePairs[index * 2 + 1] = indexById.get(edge.target) ?? -1;
    });

    const parent = Int32Array.from({ length: count }, (_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    for (let e = 0; e < edgePairs.length; e += 2) {
      if (edgePairs[e] < 0 || edgePairs[e + 1] < 0) continue;
      parent[find(edgePairs[e])] = find(edgePairs[e + 1]);
    }
    const clusterIds = new Map<number, number>();
    const clusterOf = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const root = find(i);
      if (!clusterIds.has(root)) clusterIds.set(root, clusterIds.size);
      clusterOf[i] = clusterIds.get(root)!;
    }

    this.radii = radii;
    this.previous = new Float64Array(count * 2);
    this.clusterOf = clusterOf;
    this.clusterCount = clusterIds.size;
    this.clusterPx = new Float64Array(clusterIds.size);
    this.clusterPy = new Float64Array(clusterIds.size);
    this.count = count;
    this.positions = positions;
    this.velocities = velocities;
    this.forces = new Float64Array(count * 2);
    this.pinned = pinned;
    this.indexById = indexById;
    this.edgePairs = edgePairs;
    this.retune();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.retune();
  }

  /** Holds a node at a fixed point, e.g. the pointer during a drag, until `unpin`. */
  pin(id: string, point: NetworkPoint): void {
    const index = this.indexById.get(id);
    if (index === undefined) return;
    this.positions[index * 2] = point.x;
    this.positions[index * 2 + 1] = point.y;
    this.velocities[index * 2] = 0;
    this.velocities[index * 2 + 1] = 0;
    this.pinned[index] = 1;
  }

  unpin(id: string): void {
    const index = this.indexById.get(id);
    if (index !== undefined) this.pinned[index] = 0;
  }

  getPosition(id: string): NetworkPoint | undefined {
    const index = this.indexById.get(id);
    if (index === undefined) return undefined;
    return { x: this.positions[index * 2], y: this.positions[index * 2 + 1] };
  }

  /**
   * The live `[x, y, ...]` buffer in the graph's node order, so a caller
   * painting every node each frame can read it without a point object per
   * node. Valid until the next `setGraph`.
   */
  coordinates(): Float64Array {
    return this.positions;
  }

  /** Edge endpoints as `[source, target, ...]` indices into `coordinates()`, in the graph's edge order; -1 for an endpoint the graph does not hold. */
  endpoints(): Int32Array {
    return this.edgePairs;
  }

  /** Advances the simulation by one step. Returns whether anything is still moving. */
  step(): boolean {
    const { count, positions, velocities, forces, pinned, edgePairs, repel, springLength, radii } = this;
    forces.fill(0);
    this.previous.set(positions);

    for (let i = 0; i < count; i++) {
      const a = i * 2;
      const ax = positions[a];
      const ay = positions[a + 1];
      let fax = 0;
      let fay = 0;
      for (let j = i + 1; j < count; j++) {
        const b = j * 2;
        const dx = ax - positions[b];
        const dy = ay - positions[b + 1];
        const distance = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DISTANCE);
        let scale = repel / (distance * distance * distance);
        const minGap = radii[i] + radii[j] + NODE_GAP;
        if (distance < minGap) scale += ((minGap - distance) * COLLISION_STRENGTH) / distance;
        const fx = dx * scale;
        const fy = dy * scale;
        fax += fx;
        fay += fy;
        forces[b] -= fx;
        forces[b + 1] -= fy;
      }
      forces[a] += fax;
      forces[a + 1] += fay;
    }

    for (let e = 0; e < edgePairs.length; e += 2) {
      const source = edgePairs[e];
      const target = edgePairs[e + 1];
      if (source < 0 || target < 0) continue;
      const a = source * 2;
      const b = target * 2;
      const dx = positions[b] - positions[a];
      const dy = positions[b + 1] - positions[a + 1];
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DISTANCE);
      const scale = ((distance - springLength) * SPRING_STRENGTH) / distance;
      const fx = dx * scale;
      const fy = dy * scale;
      forces[a] += fx;
      forces[a + 1] += fy;
      forces[b] -= fx;
      forces[b + 1] -= fy;
    }

    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const maxX = this.width - MARGIN;
    const maxY = this.height - MARGIN;
    const centerStrength = this.centerStrength;
    const settleSpeed = SETTLE_SPEED * SETTLE_SPEED;

    for (let i = 0; i < count; i++) {
      if (pinned[i]) continue;
      const a = i * 2;
      const fx = forces[a] + (centerX - positions[a]) * centerStrength;
      const fy = forces[a + 1] + (centerY - positions[a + 1]) * centerStrength;
      const vx = (velocities[a] + fx) * DAMPING;
      const vy = (velocities[a + 1] + fy) * DAMPING;
      velocities[a] = vx;
      velocities[a + 1] = vy;
      positions[a] = Math.min(Math.max(positions[a] + vx, MARGIN), maxX);
      positions[a + 1] = Math.min(Math.max(positions[a + 1] + vy, MARGIN), maxY);

    }

    this.separateClusters();

    for (let i = 0; i < count; i++) {
      if (pinned[i]) continue;
      const a = i * 2;
      const dx = positions[a] - this.previous[a];
      const dy = positions[a + 1] - this.previous[a + 1];
      if (dx * dx + dy * dy > settleSpeed) return true;
    }
    return false;
  }

  /** Pushes a whole cluster away when one of its avatars would touch another cluster's, so groups never overlap but may sit close. */
  private separateClusters(): void {
    const { count, clusterCount, clusterOf, positions, radii } = this;
    if (clusterCount < 2) return;
    const { clusterPx: px, clusterPy: py } = this;
    px.fill(0);
    py.fill(0);

    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = clusterOf[i];
        const b = clusterOf[j];
        if (a === b) continue;
        let dx = positions[i * 2] - positions[j * 2];
        let dy = positions[i * 2 + 1] - positions[j * 2 + 1];
        let distance = Math.hypot(dx, dy);
        const overlap = radii[i] + radii[j] + NODE_GAP - distance;
        if (overlap <= 0) continue;
        if (distance < MIN_DISTANCE) {
          dx = 1;
          dy = 0;
          distance = 1;
        }
        const push = Math.min((overlap / 2) * CLUSTER_PUSH_RATE, CLUSTER_PUSH_MAX);
        const fx = (dx / distance) * push;
        const fy = (dy / distance) * push;
        px[a] += fx;
        py[a] += fy;
        px[b] -= fx;
        py[b] -= fy;
      }
    }

    const maxX = this.width - MARGIN;
    const maxY = this.height - MARGIN;
    for (let i = 0; i < count; i++) {
      if (this.pinned[i]) continue;
      const c = clusterOf[i];
      if (px[c] === 0 && py[c] === 0) continue;
      this.velocities[i * 2] = 0;
      this.velocities[i * 2 + 1] = 0;
      positions[i * 2] = Math.min(Math.max(positions[i * 2] + px[c], MARGIN), maxX);
      positions[i * 2 + 1] = Math.min(Math.max(positions[i * 2 + 1] + py[c], MARGIN), maxY);
    }
  }
}
