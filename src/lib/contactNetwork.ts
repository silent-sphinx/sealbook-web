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

/** When a pair disagrees on its edge kind, the lowest rank here wins. */
const KIND_RANK: Record<LinkableSection, number> = { family: 0, friends: 1, colleagues: 2 };

/**
 * Builds the link graph from each contact's `family`/`friends`/`colleagues`
 * entries. Links are written reciprocally (both contacts get a `contactId`
 * entry), so a pair is collapsed to one edge rather than drawn twice.
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

  const edgeKinds = new Map<string, LinkableSection>();
  const degree = new Map<string, number>();

  for (const contact of byId.values()) {
    const profile = profileOf(contact.profile);
    for (const kind of LINKABLE_SECTIONS) {
      for (const person of profile[kind]) {
        if (!person.contactId || person.contactId === contact.id) continue;
        if (!byId.has(person.contactId)) continue;

        const key = [contact.id, person.contactId].sort().join("|");
        const existing = edgeKinds.get(key);
        if (!existing) {
          edgeKinds.set(key, kind);
        } else if (existing !== kind && KIND_RANK[kind] < KIND_RANK[existing]) {
          edgeKinds.set(key, kind);
        }
      }
    }
  }

  const edges: ContactNetworkEdge[] = [];
  for (const [key, kind] of edgeKinds) {
    const [source, target] = key.split("|") as [string, string];
    edges.push({ id: key, source, target, kind });
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
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
  private nodes: ContactNetworkNode[] = [];
  private edges: ContactNetworkEdge[] = [];
  private width: number;
  private height: number;
  private positions = new Map<string, NetworkPoint>();
  private velocities = new Map<string, NetworkPoint>();
  private pinned = new Set<string>();
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
    const count = Math.max(this.nodes.length, 1);
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

    const positions = new Map<string, NetworkPoint>();
    const velocities = new Map<string, NetworkPoint>();

    graph.nodes.forEach((node, index) => {
      const existing = this.positions.get(node.id);
      if (existing) {
        positions.set(node.id, existing);
        velocities.set(node.id, this.velocities.get(node.id) ?? { x: 0, y: 0 });
        return;
      }
      const angle = (2 * Math.PI * index) / Math.max(graph.nodes.length, 1);
      positions.set(node.id, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
      velocities.set(node.id, { x: 0, y: 0 });
    });

    this.nodes = graph.nodes;
    this.edges = graph.edges;
    this.positions = positions;
    this.velocities = velocities;
    for (const id of this.pinned) {
      if (!positions.has(id)) this.pinned.delete(id);
    }
    this.retune();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.retune();
  }

  /** Holds a node at a fixed point, e.g. the pointer during a drag, until `unpin`. */
  pin(id: string, point: NetworkPoint): void {
    if (!this.positions.has(id)) return;
    this.positions.set(id, point);
    this.velocities.set(id, { x: 0, y: 0 });
    this.pinned.add(id);
  }

  unpin(id: string): void {
    this.pinned.delete(id);
  }

  getPosition(id: string): NetworkPoint | undefined {
    return this.positions.get(id);
  }

  /** Advances the simulation by one step. Returns whether anything is still moving. */
  step(): boolean {
    const forces = new Map<string, NetworkPoint>(this.nodes.map((node) => [node.id, { x: 0, y: 0 }]));

    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i]!;
        const b = this.nodes[j]!;
        const pa = this.positions.get(a.id)!;
        const pb = this.positions.get(b.id)!;
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const distance = Math.max(Math.hypot(dx, dy), MIN_DISTANCE);
        const force = this.repel / (distance * distance);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        forces.get(a.id)!.x += fx;
        forces.get(a.id)!.y += fy;
        forces.get(b.id)!.x -= fx;
        forces.get(b.id)!.y -= fy;
      }
    }

    for (const edge of this.edges) {
      const pa = this.positions.get(edge.source);
      const pb = this.positions.get(edge.target);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const distance = Math.max(Math.hypot(dx, dy), MIN_DISTANCE);
      const force = (distance - this.springLength) * SPRING_STRENGTH;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      forces.get(edge.source)!.x += fx;
      forces.get(edge.source)!.y += fy;
      forces.get(edge.target)!.x -= fx;
      forces.get(edge.target)!.y -= fy;
    }

    const centerX = this.width / 2;
    const centerY = this.height / 2;
    let moving = false;

    for (const node of this.nodes) {
      if (this.pinned.has(node.id)) continue;

      const position = this.positions.get(node.id)!;
      const force = forces.get(node.id)!;
      force.x += (centerX - position.x) * this.centerStrength;
      force.y += (centerY - position.y) * this.centerStrength;

      const velocity = this.velocities.get(node.id)!;
      velocity.x = (velocity.x + force.x) * DAMPING;
      velocity.y = (velocity.y + force.y) * DAMPING;
      position.x = Math.min(Math.max(position.x + velocity.x, MARGIN), this.width - MARGIN);
      position.y = Math.min(Math.max(position.y + velocity.y, MARGIN), this.height - MARGIN);

      if (Math.hypot(velocity.x, velocity.y) > SETTLE_SPEED) moving = true;
    }

    return moving;
  }
}
