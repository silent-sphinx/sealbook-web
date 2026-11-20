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

/**
 * Steps a fully heated layout takes to cool to rest. The layout forces fade
 * with the heat, so a layout always comes to rest in bounded time instead of
 * creeping on while forces that never quite balance trade small pushes.
 */
export const COOLING_STEPS = 300;
/** Heat below which the layout counts as settled and stops stepping. */
const ALPHA_MIN = 0.001;
const ALPHA_DECAY = 1 - ALPHA_MIN ** (1 / COOLING_STEPS);
/** Heat held while a node is dragged, so its neighbours follow it at once. */
const DRAG_ALPHA = 0.3;
/** Heat a changed graph brings back: enough to fit newcomers in without scrambling the rest. */
const RESHAPE_ALPHA = 0.5;
const RESIZE_ALPHA = 0.3;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Spacing between a new cluster's members as they are seeded, as a share of the edge length. */
const SEED_SPACING = 0.5;
/** Clear space left between seeded clusters, as a share of the edge length. */
const SEED_GAP = 0.5;
/** Distance between the spots tried when looking for room for a new cluster, as a share of the edge length. */
const SEED_PROBE_STEP = 0.25;

/** Drawn radius of a node, which the simulation also uses to keep avatars and clusters apart. */
export function nodeRadius(degree: number): number {
  return Math.min(Math.max(MIN_NODE_RADIUS + degree * 3, MIN_NODE_RADIUS), MAX_NODE_RADIUS);
}

/** A disc of the pane a cluster takes up. */
type Footprint = { x: number; y: number; radius: number };

/**
 * A continuously-steppable force simulation: nodes repel each other, edges
 * pull their pair toward a rest length, and a weak centering force keeps the
 * graph from drifting off-canvas. Those forces fade as the layout cools, and
 * `step()` reports when it has cooled to rest. Call `step()` once per frame to
 * animate it. Dragging a node calls `pin()` on every frame instead of moving
 * it directly, which holds it at the pointer and keeps the layout warm, so
 * forces still propagate through its edges, pulling connected nodes along.
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
  /** Connected group each node belongs to, as an index into the cluster arrays. */
  private clusterOf = new Int32Array(0);
  private clusterCount = 0;
  private clusterPx = new Float64Array(0);
  private clusterPy = new Float64Array(0);
  private indexById = new Map<string, number>();
  private edgeIds = new Set<string>();
  /** Edge endpoints as index pairs into `positions`, resolved once per graph rather than per step. */
  private edgePairs = new Int32Array(0);
  private springLength = MIN_SPRING_LENGTH;
  private repel = 0;
  private centerStrength = MIN_CENTER_STRENGTH;
  private alpha = 0;
  private alphaTarget = 0;

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

  private heat(alpha: number): void {
    this.alpha = Math.max(this.alpha, alpha);
  }

  /**
   * Adopts a new graph, keeping positions for nodes that survive and seeding
   * the rest. Only a graph whose nodes or links changed warms the layout up
   * again, so a refresh that changes nothing the map draws leaves it still.
   */
  setGraph(graph: ContactNetworkGraph): void {
    const count = graph.nodes.length;
    const positions = new Float64Array(count * 2);
    const velocities = new Float64Array(count * 2);
    const pinned = new Uint8Array(count);
    const placed = new Uint8Array(count);
    const radii = new Float64Array(count);
    const indexById = new Map<string, number>();
    let kept = 0;

    graph.nodes.forEach((node, index) => {
      indexById.set(node.id, index);
      radii[index] = nodeRadius(node.degree);
      const previous = this.indexById.get(node.id);
      if (previous === undefined) return;
      kept++;
      placed[index] = 1;
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

    const edgeIds = new Set(graph.edges.map((edge) => edge.id));
    const reshaped =
      kept < count ||
      kept < this.count ||
      edgeIds.size !== this.edgeIds.size ||
      [...edgeIds].some((id) => !this.edgeIds.has(id));

    this.radii = radii;
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
    this.edgeIds = edgeIds;
    this.edgePairs = edgePairs;
    this.alphaTarget = pinned.includes(1) ? DRAG_ALPHA : 0;
    this.retune();
    this.seed(placed);
    if (reshaped) this.heat(kept === 0 ? 1 : RESHAPE_ALPHA);
  }

  /**
   * Gives every node without a position a starting point. One that links to
   * a contact already on the map starts beside it; a cluster wholly new to
   * the map starts in free space, laid out around its best-connected member.
   * Seeding each cluster in its own patch, rather than interleaving them all
   * on one ring, means none has to pass through another to find its place.
   */
  private seed(placed: Uint8Array): void {
    const { count, positions, edgePairs, clusterOf, clusterCount, springLength } = this;
    if (placed.every(Boolean)) return;

    const neighbours: number[][] = Array.from({ length: count }, () => []);
    for (let e = 0; e < edgePairs.length; e += 2) {
      const a = edgePairs[e];
      const b = edgePairs[e + 1];
      if (a < 0 || b < 0 || a === b) continue;
      neighbours[a].push(b);
      neighbours[b].push(a);
    }
    const members: number[][] = Array.from({ length: clusterCount }, () => []);
    for (let i = 0; i < count; i++) members[clusterOf[i]].push(i);

    const spacing = springLength * SEED_SPACING;
    const taken: Footprint[] = [];
    const fresh: number[] = [];
    let turn = 0;

    for (let c = 0; c < clusterCount; c++) {
      const queue = members[c].filter((i) => placed[i]);
      if (queue.length === 0) {
        fresh.push(c);
        continue;
      }
      for (let q = 0; q < queue.length; q++) {
        const from = queue[q];
        for (const to of neighbours[from]) {
          if (placed[to]) continue;
          const angle = turn++ * GOLDEN_ANGLE;
          this.place(
            to,
            positions[from * 2] + spacing * Math.cos(angle),
            positions[from * 2 + 1] + spacing * Math.sin(angle),
          );
          placed[to] = 1;
          queue.push(to);
        }
      }
      taken.push(this.footprintOf(members[c]));
    }

    fresh.sort((a, b) => members[b].length - members[a].length || a - b);
    // A spot too tight for one cluster is too tight for the next of the same
    // size, so a run of them (such as every unlinked contact) resumes the
    // search where the last one found room instead of rescanning the centre.
    let resume = { radius: -1, probe: 0 };
    for (const c of fresh) {
      const order = breadthFirst(members[c], neighbours);
      const radius = spacing * Math.sqrt(order.length);
      const spot = this.freeSpot(radius, taken, radius === resume.radius ? resume.probe : 0);
      resume = { radius, probe: spot.probe };
      order.forEach((node, k) => {
        const r = spacing * Math.sqrt(k);
        const angle = k * GOLDEN_ANGLE;
        this.place(node, spot.x + r * Math.cos(angle), spot.y + r * Math.sin(angle));
      });
      taken.push({ x: spot.x, y: spot.y, radius });
    }
  }

  private place(index: number, x: number, y: number): void {
    this.positions[index * 2] = Math.min(Math.max(x, MARGIN), this.width - MARGIN);
    this.positions[index * 2 + 1] = Math.min(Math.max(y, MARGIN), this.height - MARGIN);
  }

  private footprintOf(nodes: number[]): Footprint {
    const { positions, radii } = this;
    let x = 0;
    let y = 0;
    for (const i of nodes) {
      x += positions[i * 2];
      y += positions[i * 2 + 1];
    }
    x /= nodes.length;
    y /= nodes.length;
    let radius = 0;
    for (const i of nodes) {
      radius = Math.max(radius, Math.hypot(positions[i * 2] - x, positions[i * 2 + 1] - y) + radii[i]);
    }
    return { x, y, radius };
  }

  /**
   * The spot nearest the pane's centre where a footprint this size fits
   * inside the pane and clear of every taken one, or the roomiest spot tried
   * when the pane has no such room left. The search spirals out from the
   * centre, stretched to the pane's shape so a wide pane fills sideways.
   * `probe` is where on the spiral a clear spot was found, or 0 if none was.
   */
  private freeSpot(
    radius: number,
    taken: Footprint[],
    from: number,
  ): NetworkPoint & { probe: number } {
    const { width, height, springLength } = this;
    const centerX = width / 2;
    const centerY = height / 2;
    const short = Math.min(width, height);
    const stretchX = width / short;
    const stretchY = height / short;
    const step = springLength * SEED_PROBE_STEP;
    const gap = springLength * SEED_GAP;
    const reach = Math.hypot(width, height) / 2;

    let best = { x: centerX, y: centerY, probe: 0 };
    let bestRoom = -Infinity;
    for (let t = from; step * Math.sqrt(t) <= reach; t++) {
      const r = step * Math.sqrt(t);
      const x = centerX + r * Math.cos(t * GOLDEN_ANGLE) * stretchX;
      const y = centerY + r * Math.sin(t * GOLDEN_ANGLE) * stretchY;
      let room = Math.min(x - MARGIN, width - MARGIN - x, y - MARGIN, height - MARGIN - y) - radius;
      for (const other of taken) {
        if (room <= bestRoom) break;
        room = Math.min(room, Math.hypot(x - other.x, y - other.y) - other.radius - radius - gap);
      }
      if (room >= 0) return { x, y, probe: t };
      if (room > bestRoom) {
        bestRoom = room;
        best = { x, y, probe: 0 };
      }
    }
    return best;
  }

  /** Follows the pane's centre, so a resize keeps the layout where it was within the pane rather than drifting over to it. */
  resize(width: number, height: number): void {
    const dx = (width - this.width) / 2;
    const dy = (height - this.height) / 2;
    for (let i = 0; i < this.count; i++) {
      if (this.pinned[i]) continue;
      this.positions[i * 2] += dx;
      this.positions[i * 2 + 1] += dy;
    }
    this.width = width;
    this.height = height;
    this.retune();
    this.heat(RESIZE_ALPHA);
  }

  /** Runs the layout until it cools, so it can be drawn already in place rather than springing into it. */
  settle(): void {
    for (let i = 0; i < COOLING_STEPS; i++) {
      if (!this.step()) return;
    }
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
    this.alphaTarget = DRAG_ALPHA;
    this.heat(DRAG_ALPHA);
  }

  unpin(id: string): void {
    const index = this.indexById.get(id);
    if (index === undefined) return;
    this.pinned[index] = 0;
    if (!this.pinned.includes(1)) this.alphaTarget = 0;
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

  /** Advances the simulation by one step. Returns whether it is still warm enough to move. */
  step(): boolean {
    if (this.alpha < ALPHA_MIN && this.alphaTarget < ALPHA_MIN) return false;
    this.alpha += (this.alphaTarget - this.alpha) * ALPHA_DECAY;

    const { count, positions, velocities, forces, pinned, edgePairs, springLength, radii, alpha } = this;
    const repel = this.repel * alpha;
    forces.fill(0);

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
        // Collision does not fade with the heat, so avatars end apart however the layout cooled.
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

    const spring = SPRING_STRENGTH * alpha;
    for (let e = 0; e < edgePairs.length; e += 2) {
      const source = edgePairs[e];
      const target = edgePairs[e + 1];
      if (source < 0 || target < 0) continue;
      const a = source * 2;
      const b = target * 2;
      const dx = positions[b] - positions[a];
      const dy = positions[b + 1] - positions[a + 1];
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), MIN_DISTANCE);
      const scale = ((distance - springLength) * spring) / distance;
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
    const centerStrength = this.centerStrength * alpha;

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
    return this.alpha >= ALPHA_MIN;
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
        const reach = radii[i] + radii[j] + NODE_GAP;
        if (dx * dx + dy * dy >= reach * reach) continue;
        let distance = Math.sqrt(dx * dx + dy * dy);
        const overlap = reach - distance;
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

/** A cluster's members in breadth-first order from its best-connected one, so a hub is seeded with its contacts around it. */
function breadthFirst(nodes: number[], neighbours: number[][]): number[] {
  let hub = nodes[0];
  for (const node of nodes) {
    if (neighbours[node].length > neighbours[hub].length) hub = node;
  }
  const seen = new Set([hub]);
  const order = [hub];
  for (let q = 0; q < order.length; q++) {
    for (const next of neighbours[order[q]]) {
      if (seen.has(next)) continue;
      seen.add(next);
      order.push(next);
    }
  }
  return order;
}
