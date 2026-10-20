import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  buildContactNetwork,
  NetworkSimulation,
  PRESETTLE_ITERATIONS,
  type ContactNetworkEdge,
  type NetworkPoint,
} from "../lib/contactNetwork";
import type { Contact } from "../lib/types";
import { Avatar } from "./ContactCard";
import { focusRing, iconButton } from "../lib/styles";

/** Before the container has been measured. */
const FALLBACK_SIZE = { width: 320, height: 320 };
const MIN_NODE_RADIUS = 14;
const MAX_NODE_RADIUS = 30;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const DEFAULT_VIEW = { x: 0, y: 0, scale: 1 };
const DRAG_THRESHOLD = 3;

type View = { x: number; y: number; scale: number };

const EDGE_CLASS: Record<ContactNetworkEdge["kind"], string> = {
  family: "stroke-link-family",
  friends: "stroke-link-friend",
  colleagues: "stroke-link-colleague",
};

const EDGE_DASH: Record<ContactNetworkEdge["kind"], string | undefined> = {
  family: undefined,
  friends: "4 3",
  colleagues: "1.5 4",
};

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

export function ContactNetworkMap({
  contacts,
  onSelectContact,
}: {
  contacts: Contact[];
  onSelectContact: (contact: Contact) => void;
}) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [size, setSize] = useState(FALLBACK_SIZE);
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [, bumpTick] = useReducer((count: number) => count + 1, 0);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ start: NetworkPoint; startView: NetworkPoint } | null>(null);
  const nodeDragRef = useRef<{ id: string; moved: boolean; startClient: NetworkPoint } | null>(null);
  const simRef = useRef<NetworkSimulation | null>(null);
  const simGraphRef = useRef<ReturnType<typeof buildContactNetwork> | null>(null);
  const simSizeRef = useRef<{ width: number; height: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  // Sizes the graph to the pane's actual shape rather than a fixed square, so
  // it fills the area instead of letterboxing inside it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const byId = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const contact of contacts) map.set(contact.id, contact);
    return map;
  }, [contacts]);

  const graph = useMemo(
    () => buildContactNetwork(contacts, { includeUnlinked: showAllContacts }),
    [contacts, showAllContacts],
  );

  // Runs the loop that steps the physics simulation and re-renders while
  // anything is moving (including the duration of a node drag), then goes
  // idle once everything has settled, rather than ticking forever.
  function wake() {
    if (rafRef.current !== null) return;
    const loop = () => {
      const sim = simRef.current;
      if (!sim) {
        rafRef.current = null;
        return;
      }
      const moving = sim.step();
      bumpTick();
      if (moving || nodeDragRef.current) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  // Builds the simulation on first render, or updates it in place (keeping
  // existing node positions) when the graph or pane size changes, so the
  // layout is already available for this render rather than flashing in a
  // frame late via an effect.
  if (!simRef.current) {
    const sim = new NetworkSimulation(graph, size.width, size.height);
    for (let i = 0; i < PRESETTLE_ITERATIONS; i++) sim.step();
    simRef.current = sim;
    simGraphRef.current = graph;
    simSizeRef.current = size;
  } else if (
    simGraphRef.current !== graph ||
    simSizeRef.current?.width !== size.width ||
    simSizeRef.current?.height !== size.height
  ) {
    simRef.current.resize(size.width, size.height);
    simRef.current.setGraph(graph);
    simGraphRef.current = graph;
    simSizeRef.current = size;
  }

  // Starting and cancelling the loop in one effect keeps `rafRef` honest: a
  // cancelled frame id left behind would make every later `wake()` no-op on
  // its already-running guard, freezing the simulation for good.
  useEffect(() => {
    wake();
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [graph, size.width, size.height]);

  // React marks its own `onWheel` listener passive, which silently drops
  // `preventDefault`, so zoom is wired through a real DOM listener instead.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const point = clientToSvgPoint(svg, e.clientX, e.clientY, size.width, size.height);
      setView((prev) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const nextScale = clampZoom(prev.scale * factor);
        const k = nextScale / prev.scale;
        return {
          scale: nextScale,
          x: point.x * (1 - k) + k * prev.x,
          y: point.y * (1 - k) + k * prev.y,
        };
      });
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [size.width, size.height]);

  const isEmpty = graph.nodes.length === 0;

  const nodeRadius = (degree: number) =>
    Math.min(Math.max(MIN_NODE_RADIUS + degree * 3, MIN_NODE_RADIUS), MAX_NODE_RADIUS);

  const isHighlighted = (edge: ContactNetworkEdge) =>
    hoveredNodeId !== null &&
    (edge.source === hoveredNodeId || edge.target === hoveredNodeId);

  const position = (id: string): NetworkPoint => simRef.current!.getPosition(id)!;

  function zoomBy(factor: number) {
    setView((prev) => {
      const nextScale = clampZoom(prev.scale * factor);
      const k = nextScale / prev.scale;
      return {
        scale: nextScale,
        x: (size.width / 2) * (1 - k) + k * prev.x,
        y: (size.height / 2) * (1 - k) + k * prev.y,
      };
    });
  }

  function handleBackgroundPointerDown(e: React.PointerEvent<SVGRectElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const svg = svgRef.current;
    if (!svg) return;
    panRef.current = {
      start: clientToSvgPoint(svg, e.clientX, e.clientY, size.width, size.height),
      startView: { x: view.x, y: view.y },
    };
  }

  function handleBackgroundPointerMove(e: React.PointerEvent<SVGRectElement>) {
    const pan = panRef.current;
    const svg = svgRef.current;
    if (!pan || !svg) return;
    const point = clientToSvgPoint(svg, e.clientX, e.clientY, size.width, size.height);
    setView((prev) => ({
      ...prev,
      x: pan.startView.x + (point.x - pan.start.x),
      y: pan.startView.y + (point.y - pan.start.y),
    }));
  }

  function handleBackgroundPointerUp(e: React.PointerEvent<SVGRectElement>) {
    panRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleNodePointerDown(e: React.PointerEvent<SVGGElement>, nodeId: string) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    nodeDragRef.current = { id: nodeId, moved: false, startClient: { x: e.clientX, y: e.clientY } };
  }

  function handleNodePointerMove(e: React.PointerEvent<SVGGElement>, nodeId: string) {
    const drag = nodeDragRef.current;
    const svg = svgRef.current;
    const sim = simRef.current;
    if (!drag || drag.id !== nodeId || !svg || !sim) return;

    const dx = e.clientX - drag.startClient.x;
    const dy = e.clientY - drag.startClient.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;

    const outer = clientToSvgPoint(svg, e.clientX, e.clientY, size.width, size.height);
    const graphPoint = {
      x: (outer.x - view.x) / view.scale,
      y: (outer.y - view.y) / view.scale,
    };
    // Pinning (rather than just moving the node) keeps the simulation
    // stepping every frame, so spring forces on its edges keep pulling the
    // rest of its cluster along with it.
    sim.pin(nodeId, graphPoint);
    wake();
  }

  // `setPointerCapture` on `pointerdown` retargets the compatibility `click`
  // event to the capturing `<g>` rather than the `<button>` inside it (per the
  // Pointer Events spec), so the button's own `onClick` never fires for a
  // pointer-driven tap. Selection is handled here instead, once a drag is
  // ruled out; the button's `onClick` stays only for keyboard activation.
  function handleNodePointerUp(e: React.PointerEvent<SVGGElement>, contact: Contact | undefined) {
    const drag = nodeDragRef.current;
    nodeDragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (drag && drag.moved) {
      simRef.current?.unpin(drag.id);
      wake();
    } else if (drag && contact) {
      onSelectContact(contact);
    }
  }

  const isDefaultView =
    view.x === DEFAULT_VIEW.x && view.y === DEFAULT_VIEW.y && view.scale === DEFAULT_VIEW.scale;

  return (
    <div className="hidden min-h-56 flex-1 flex-col lg:flex">
      <div ref={containerRef} className="relative min-h-0 flex-1">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="max-w-xs text-sm leading-relaxed text-mute">
              {showAllContacts
                ? "Add a contact to see them here."
                : "Link a family member, friend, or colleague on a contact's detail page to see them here."}
            </p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${size.width} ${size.height}`}
            className="h-full w-full"
            style={{ touchAction: "none" }}
            role="img"
            aria-label="Contact relationship map"
          >
            <rect
              x={0}
              y={0}
              width={size.width}
              height={size.height}
              fill="transparent"
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={handleBackgroundPointerDown}
              onPointerMove={handleBackgroundPointerMove}
              onPointerUp={handleBackgroundPointerUp}
            />

            <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
              <g>
                {graph.edges.map((edge) => {
                  const from = position(edge.source);
                  const to = position(edge.target);
                  const highlighted = isHighlighted(edge);
                  return (
                    <line
                      key={edge.id}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      pointerEvents="none"
                      className={EDGE_CLASS[edge.kind]}
                      strokeWidth={highlighted ? 2.5 : 1.5}
                      strokeOpacity={highlighted ? 1 : 0.55}
                      strokeLinecap="round"
                      strokeDasharray={EDGE_DASH[edge.kind]}
                    />
                  );
                })}
              </g>

              <g>
                {graph.nodes.map((node) => {
                  const point = position(node.id);
                  const radius = nodeRadius(node.degree);
                  const diameter = radius * 2;
                  const contact = byId.get(node.id);
                  const hovered = hoveredNodeId === node.id;

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${point.x} ${point.y})`}
                      className="cursor-grab active:cursor-grabbing"
                      onPointerDown={(e) => handleNodePointerDown(e, node.id)}
                      onPointerMove={(e) => handleNodePointerMove(e, node.id)}
                      onPointerUp={(e) => handleNodePointerUp(e, contact)}
                      onMouseEnter={() => setHoveredNodeId(node.id)}
                      onMouseLeave={() => setHoveredNodeId(null)}
                    >
                      <circle r={radius} className="fill-surface stroke-line" strokeWidth={1} />
                      <foreignObject
                        x={-radius}
                        y={-radius}
                        width={diameter}
                        height={diameter}
                      >
                        <button
                          type="button"
                          aria-label={node.name}
                          onFocus={() => setHoveredNodeId(node.id)}
                          onBlur={() => setHoveredNodeId(null)}
                          onClick={() => contact && onSelectContact(contact)}
                          className={`flex items-center justify-center rounded-full ${focusRing}`}
                          style={{ width: diameter, height: diameter }}
                        >
                          <Avatar name={node.name} avatar={node.avatar} pixelSize={diameter} />
                        </button>
                      </foreignObject>
                      {hovered ? (
                        <text
                          y={radius + 14}
                          textAnchor="middle"
                          pointerEvents="none"
                          className="fill-text text-[10px] font-medium"
                        >
                          {node.name}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        )}

        <div
          role="group"
          aria-label="Contacts shown on the map"
          className="absolute left-2 top-2 flex items-center gap-0.5 rounded-lg border border-line bg-surface/90 p-0.5 backdrop-blur-sm"
        >
          <button
            type="button"
            aria-pressed={!showAllContacts}
            onClick={() => setShowAllContacts(false)}
            className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${focusRing} ${
              !showAllContacts ? "bg-accent text-bg" : "text-mute hover:text-text"
            }`}
          >
            Clusters only
          </button>
          <button
            type="button"
            aria-pressed={showAllContacts}
            onClick={() => setShowAllContacts(true)}
            className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${focusRing} ${
              showAllContacts ? "bg-accent text-bg" : "text-mute hover:text-text"
            }`}
          >
            Every contact
          </button>
        </div>

        {!isEmpty ? (
          <div className="absolute right-2 top-2 flex flex-col gap-1">
            {!isDefaultView ? (
              <button
                type="button"
                aria-label="Reset map view"
                title="Reset view"
                onClick={() => setView(DEFAULT_VIEW)}
                className={iconButton}
              >
                ⟲
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => zoomBy(1.3)}
              className={iconButton}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => zoomBy(1 / 1.3)}
              className={iconButton}
            >
              −
            </button>
          </div>
        ) : null}
      </div>

      {!isEmpty ? (
        <div className="flex items-center justify-center gap-4 px-4 py-3 text-xs text-mute">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-link-family" />
            Family
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 rounded-full bg-link-friend"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to right, var(--color-link-friend) 0 3px, transparent 3px 6px)",
              }}
            />
            Friends
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-0.5 w-4 rounded-full bg-link-colleague"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to right, var(--color-link-colleague) 0 1.5px, transparent 1.5px 4px)",
              }}
            />
            Colleagues
          </span>
        </div>
      ) : null}

      {!isEmpty && graph.nodes.length < graph.totalLinked ? (
        <p className="px-4 pb-3 text-center text-xs text-mute">
          Showing the {graph.nodes.length} most-connected of {graph.totalLinked}{" "}
          {showAllContacts ? "contacts" : "linked contacts"}.
        </p>
      ) : null}
    </div>
  );
}

function clientToSvgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  width: number,
  height: number,
): NetworkPoint {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * width,
    y: ((clientY - rect.top) / rect.height) * height,
  };
}
