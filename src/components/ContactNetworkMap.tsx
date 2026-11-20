import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  buildContactNetwork,
  NetworkSimulation,
  nodeRadius,
  type ContactNetworkEdge,
  type NetworkPoint,
} from "../lib/contactNetwork";
import type { Contact } from "../lib/types";
import { Avatar } from "./ContactCard";
import { Icon } from "./Icon";
import { focusRing, segment } from "../lib/styles";

/** For a pane with no box to measure, such as one that is hidden. */
const FALLBACK_SIZE = { width: 320, height: 320 };
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const DEFAULT_VIEW = { x: 0, y: 0, scale: 1 };
const DRAG_THRESHOLD = 3;
/** Opacity of nodes and edges outside the hovered contact's neighbourhood. */
const DIMMED_NODE_OPACITY = "0.25";
const DIMMED_EDGE_OPACITY = 0.12;
/** Pixels per wheel "line" for browsers (Firefox) that report wheel deltas in lines. */
const WHEEL_LINE_HEIGHT = 16;

type View = { x: number; y: number; scale: number };

const EDGE_CLASS: Record<ContactNetworkEdge["kind"], string> = {
  family: "stroke-link-family",
  friends: "stroke-link-friend",
  colleagues: "stroke-link-colleague",
};

const EDGE_LABEL: Record<ContactNetworkEdge["kind"], string> = {
  family: "Family",
  friends: "Friends",
  colleagues: "Colleagues",
};

const LEGEND_SWATCH: Record<ContactNetworkEdge["kind"], string | undefined> = {
  family: undefined,
  friends: "repeating-linear-gradient(to right, var(--color-link-friend) 0 3px, transparent 3px 6px)",
  colleagues:
    "repeating-linear-gradient(to right, var(--color-link-colleague) 0 1.5px, transparent 1.5px 4px)",
};

const LEGEND_CLASS: Record<ContactNetworkEdge["kind"], string> = {
  family: "bg-link-family",
  friends: "bg-link-friend",
  colleagues: "bg-link-colleague",
};

const EDGE_ORDER: ContactNetworkEdge["kind"][] = ["family", "friends", "colleagues"];

const EDGE_DASH: Record<ContactNetworkEdge["kind"], string | undefined> = {
  family: undefined,
  friends: "4 3",
  colleagues: "1.5 4",
};

/** Perpendicular spacing between parallel lines when a pair shares more than one relationship. */
const EDGE_OFFSET_GAP = 4;

function pairKey(edge: ContactNetworkEdge): string {
  return [edge.source, edge.target].sort().join("|");
}

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

function wheelPixels(e: WheelEvent, pageHeight: number): number {
  if (e.deltaMode === 1) return e.deltaY * WHEEL_LINE_HEIGHT;
  if (e.deltaMode === 2) return e.deltaY * pageHeight;
  return e.deltaY;
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
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [showAllContacts, setShowAllContacts] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ start: NetworkPoint; startView: NetworkPoint } | null>(null);
  const nodeDragRef = useRef<{ id: string; moved: boolean; startClient: NetworkPoint } | null>(null);
  const simRef = useRef<NetworkSimulation | null>(null);
  const simGraphRef = useRef<ReturnType<typeof buildContactNetwork> | null>(null);
  const simSizeRef = useRef<{ width: number; height: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const viewRef = useRef<View>(view);
  viewRef.current = view;
  const labelRef = useRef<SVGGElement | null>(null);
  const hoveredIndexRef = useRef(-1);

  // Sizes the graph to the pane's actual shape rather than a fixed square, so
  // it fills the area instead of letterboxing inside it.
  //
  // Measured before the first paint, and nothing is drawn until it has been:
  // a guessed size is a `viewBox` the browser scales to the pane, so the whole
  // graph, icons and all, would be drawn at the wrong scale and then jump when
  // the real size arrived. Only a pane with no box to measure settles for the
  // fallback, and a later measurement resizes it like any other.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    setSize(
      rect.width > 0 && rect.height > 0
        ? { width: rect.width, height: rect.height }
        : FALLBACK_SIZE,
    );

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const pane = size ?? FALLBACK_SIZE;

  const byId = useMemo(() => {
    const map = new Map<string, Contact>();
    for (const contact of contacts) map.set(contact.id, contact);
    return map;
  }, [contacts]);

  const graph = useMemo(
    () => buildContactNetwork(contacts, { includeUnlinked: showAllContacts }),
    [contacts, showAllContacts],
  );

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set());
      if (!map.has(edge.target)) map.set(edge.target, new Set());
      map.get(edge.source)!.add(edge.target);
      map.get(edge.target)!.add(edge.source);
    }
    return map;
  }, [graph.edges]);

  const kindsShown = useMemo(() => {
    const kinds = new Set(graph.edges.map((edge) => edge.kind));
    return EDGE_ORDER.filter((kind) => kinds.has(kind));
  }, [graph.edges]);

  // A pair sharing more than one relationship (e.g. friends and colleagues)
  // is drawn as parallel lines rather than one overdrawing the other, so each
  // edge carries the perpendicular offset its place in the pair gives it.
  const edgeOffsets = useMemo(() => {
    const sizes = new Map<string, number>();
    for (const edge of graph.edges) sizes.set(pairKey(edge), (sizes.get(pairKey(edge)) ?? 0) + 1);

    const seen = new Map<string, number>();
    return graph.edges.map((edge) => {
      const key = pairKey(edge);
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      return (index - ((sizes.get(key) ?? 1) - 1) / 2) * EDGE_OFFSET_GAP;
    });
  }, [graph.edges]);

  // The painted elements, in the graph's own node and edge order, so a frame
  // can go straight from a simulation index to the element it moves.
  const nodeEls = useMemo(
    () => graph.nodes.map((): SVGGElement | null => null),
    [graph.nodes],
  );
  const edgeEls = useMemo(
    () => graph.edges.map((): SVGLineElement | null => null),
    [graph.edges],
  );

  // Writes the layout the simulation holds onto the SVG. Positions are the
  // simulation's state rather than React's, so a frame moves the existing
  // elements instead of re-rendering a `<g>`, `<foreignObject>`, `<button>`
  // and `<Avatar>` per node.
  const paint = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    const coordinates = sim.coordinates();
    const endpoints = sim.endpoints();

    for (const [index, element] of nodeEls.entries()) {
      if (!element) continue;
      element.setAttribute(
        "transform",
        `translate(${coordinates[index * 2]} ${coordinates[index * 2 + 1]})`,
      );
    }

    for (const [index, element] of edgeEls.entries()) {
      if (!element) continue;
      const source = endpoints[index * 2]! * 2;
      const target = endpoints[index * 2 + 1]! * 2;
      if (source < 0 || target < 0) continue;

      const x1 = coordinates[source]!;
      const y1 = coordinates[source + 1]!;
      const x2 = coordinates[target]!;
      const y2 = coordinates[target + 1]!;

      let nx = 0;
      let ny = 0;
      const offset = edgeOffsets[index] ?? 0;
      if (offset !== 0) {
        const length = Math.max(Math.hypot(x2 - x1, y2 - y1), 1);
        nx = (-(y2 - y1) / length) * offset;
        ny = ((x2 - x1) / length) * offset;
      }

      element.setAttribute("x1", String(x1 + nx));
      element.setAttribute("y1", String(y1 + ny));
      element.setAttribute("x2", String(x2 + nx));
      element.setAttribute("y2", String(y2 + ny));
    }

    const hovered = hoveredIndexRef.current;
    if (labelRef.current && hovered >= 0) {
      labelRef.current.setAttribute(
        "transform",
        `translate(${coordinates[hovered * 2]} ${coordinates[hovered * 2 + 1]})`,
      );
    }
  }, [nodeEls, edgeEls, edgeOffsets]);

  // Runs the loop that steps the physics simulation and repaints while
  // anything is moving (including the duration of a node drag), then goes
  // idle once everything has settled, rather than ticking forever.
  const wake = useCallback(() => {
    if (rafRef.current !== null) return;
    const loop = () => {
      const sim = simRef.current;
      if (!sim) {
        rafRef.current = null;
        return;
      }
      const moving = sim.step();
      paint();
      if (moving || nodeDragRef.current) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [paint]);

  // Builds the simulation on the first render that has a measured pane, or
  // updates it in place (keeping existing node positions) when the graph or
  // pane size changes, so the layout is already available for this render
  // rather than flashing in a frame late via an effect.
  if (size) {
    if (!simRef.current) {
      const sim = new NetworkSimulation(graph, size.width, size.height);
      sim.settle();
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
  }

  // A render that replaced the elements, or the one that first measured the
  // pane, leaves them with no coordinates on them, so every render paints
  // before the browser draws rather than a frame later. Attribute writes on
  // elements that are already in place, so it costs little next to the render
  // that preceded it.
  useLayoutEffect(paint);

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
  }, [wake, pane.width, pane.height]);

  // React marks its own `onWheel` listener passive, which silently drops
  // `preventDefault`, so zoom is wired through a real DOM listener instead.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const point = clientToSvgPoint(svg, e.clientX, e.clientY, pane.width, pane.height);
      setView((prev) => {
        const factor = Math.exp(-wheelPixels(e, pane.height) * 0.0015);
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
  }, [pane.width, pane.height]);

  const isEmpty = graph.nodes.length === 0;

  const hoveredIndex =
    hoveredNodeId === null ? -1 : graph.nodes.findIndex((node) => node.id === hoveredNodeId);
  const hoveredNode = hoveredIndex >= 0 ? graph.nodes[hoveredIndex] : undefined;
  const hoveredNeighbours = hoveredNode ? neighbours.get(hoveredNode.id) : undefined;

  // Dims everything outside the hovered contact's neighbourhood on the
  // elements directly, so hovering does not re-render every avatar.
  useLayoutEffect(() => {
    hoveredIndexRef.current = hoveredIndex;
    for (const [index, element] of nodeEls.entries()) {
      if (!element) continue;
      const id = graph.nodes[index]!.id;
      const dim = hoveredIndex >= 0 && index !== hoveredIndex && !hoveredNeighbours?.has(id);
      element.style.opacity = dim ? DIMMED_NODE_OPACITY : "";
    }
    paint();
  }, [hoveredIndex, hoveredNeighbours, graph.nodes, nodeEls, paint]);

  const edgeOpacity = (edge: ContactNetworkEdge) => {
    if (!hoveredNode) return 0.55;
    return edge.source === hoveredNode.id || edge.target === hoveredNode.id
      ? 1
      : DIMMED_EDGE_OPACITY;
  };

  function zoomBy(factor: number) {
    setView((prev) => {
      const nextScale = clampZoom(prev.scale * factor);
      const k = nextScale / prev.scale;
      return {
        scale: nextScale,
        x: (pane.width / 2) * (1 - k) + k * prev.x,
        y: (pane.height / 2) * (1 - k) + k * prev.y,
      };
    });
  }

  function handleBackgroundPointerDown(e: React.PointerEvent<SVGRectElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const svg = svgRef.current;
    if (!svg) return;
    panRef.current = {
      start: clientToSvgPoint(svg, e.clientX, e.clientY, pane.width, pane.height),
      startView: { x: view.x, y: view.y },
    };
  }

  function handleBackgroundPointerMove(e: React.PointerEvent<SVGRectElement>) {
    const pan = panRef.current;
    const svg = svgRef.current;
    if (!pan || !svg) return;
    const point = clientToSvgPoint(svg, e.clientX, e.clientY, pane.width, pane.height);
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

    const current = viewRef.current;
    const outer = clientToSvgPoint(svg, e.clientX, e.clientY, pane.width, pane.height);
    const graphPoint = {
      x: (outer.x - current.x) / current.scale,
      y: (outer.y - current.y) / current.scale,
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

  // A cancelled pointer gets no `pointerup`, so the drag is dropped here or
  // the node would stay pinned and the frame loop would never go idle.
  function handleNodePointerCancel() {
    const drag = nodeDragRef.current;
    nodeDragRef.current = null;
    if (!drag) return;
    simRef.current?.unpin(drag.id);
    wake();
  }

  // The node layer is memoized so a pan or hover re-renders only the edges,
  // which is why its handlers are reached through a ref to their latest version.
  const nodeHandlers = useRef({
    down: handleNodePointerDown,
    move: handleNodePointerMove,
    up: handleNodePointerUp,
    cancel: handleNodePointerCancel,
    select: onSelectContact,
  });
  nodeHandlers.current = {
    down: handleNodePointerDown,
    move: handleNodePointerMove,
    up: handleNodePointerUp,
    cancel: handleNodePointerCancel,
    select: onSelectContact,
  };

  const nodeLayer = useMemo(
    () =>
      graph.nodes.map((node, index) => {
        const radius = nodeRadius(node.degree);
        const diameter = radius * 2;
        const contact = byId.get(node.id);

        return (
          <g
            key={node.id}
            ref={(element) => {
              nodeEls[index] = element;
            }}
            className="cursor-grab transition-opacity duration-150 active:cursor-grabbing"
            onPointerDown={(e) => nodeHandlers.current.down(e, node.id)}
            onPointerMove={(e) => nodeHandlers.current.move(e, node.id)}
            onPointerUp={(e) => nodeHandlers.current.up(e, contact)}
            onPointerCancel={() => nodeHandlers.current.cancel()}
            onLostPointerCapture={() => nodeHandlers.current.cancel()}
            onMouseEnter={() => setHoveredNodeId(node.id)}
            onMouseLeave={() => setHoveredNodeId(null)}
          >
            <circle r={radius} className="fill-surface stroke-line" strokeWidth={1} />
            <foreignObject x={-radius} y={-radius} width={diameter} height={diameter}>
              <button
                type="button"
                aria-label={node.name}
                onFocus={() => setHoveredNodeId(node.id)}
                onBlur={() => setHoveredNodeId(null)}
                onClick={() => contact && nodeHandlers.current.select(contact)}
                className={`flex items-center justify-center rounded-full ${focusRing}`}
                style={{ width: diameter, height: diameter }}
              >
                <Avatar name={node.name} avatar={node.avatar} pixelSize={diameter} />
              </button>
            </foreignObject>
          </g>
        );
      }),
    [graph.nodes, byId, nodeEls],
  );

  const isDefaultView =
    view.x === DEFAULT_VIEW.x && view.y === DEFAULT_VIEW.y && view.scale === DEFAULT_VIEW.scale;

  const toolbar = "absolute top-2 flex rounded-lg border border-line-light bg-elevated/90 p-0.5 shadow-raised backdrop-blur-sm";
  const zoomControl = `flex size-7 items-center justify-center rounded-md text-mute transition-colors hover:bg-hover hover:text-text disabled:pointer-events-none disabled:text-faint ${focusRing}`;

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
        ) : size ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${pane.width} ${pane.height}`}
            className="h-full w-full"
            style={{ touchAction: "none" }}
            role="group"
            aria-label="Contact relationship map"
          >
            <rect
              x={0}
              y={0}
              width={pane.width}
              height={pane.height}
              fill="transparent"
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={handleBackgroundPointerDown}
              onPointerMove={handleBackgroundPointerMove}
              onPointerUp={handleBackgroundPointerUp}
              onPointerCancel={() => (panRef.current = null)}
              onLostPointerCapture={() => (panRef.current = null)}
            />

            <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
              <g>
                {graph.edges.map((edge, index) => (
                  <line
                    key={edge.id}
                    ref={(element) => {
                      edgeEls[index] = element;
                    }}
                    pointerEvents="none"
                    className={EDGE_CLASS[edge.kind]}
                    strokeWidth={edgeOpacity(edge) === 1 ? 2.5 : 1.5}
                    strokeOpacity={edgeOpacity(edge)}
                    strokeLinecap="round"
                    strokeDasharray={EDGE_DASH[edge.kind]}
                  />
                ))}
              </g>

              <g>{nodeLayer}</g>

              {hoveredNode ? (
                <g ref={labelRef} pointerEvents="none">
                  <text
                    y={nodeRadius(hoveredNode.degree) + 14}
                    textAnchor="middle"
                    className="fill-text stroke-bg text-2xs font-medium"
                    strokeWidth={3}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                  >
                    {hoveredNode.name}
                  </text>
                </g>
              ) : null}
            </g>
          </svg>
        ) : null}

        <div
          role="group"
          aria-label="Contacts shown on the map"
          className={`${toolbar} left-2 items-center`}
        >
          <button
            type="button"
            aria-pressed={!showAllContacts}
            onClick={() => setShowAllContacts(false)}
            className={`${segment(!showAllContacts)} h-7`}
          >
            Clusters only
          </button>
          <button
            type="button"
            aria-pressed={showAllContacts}
            onClick={() => setShowAllContacts(true)}
            className={`${segment(showAllContacts)} h-7`}
          >
            Every contact
          </button>
        </div>

        {!isEmpty ? (
          <div role="group" aria-label="Map zoom" className={`${toolbar} right-2 flex-col`}>
            <button
              type="button"
              aria-label="Zoom in"
              title="Zoom in"
              disabled={view.scale >= MAX_ZOOM}
              onClick={() => zoomBy(1.3)}
              className={zoomControl}
            >
              <Icon name="plus" className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={view.scale <= MIN_ZOOM}
              onClick={() => zoomBy(1 / 1.3)}
              className={zoomControl}
            >
              <Icon name="minus" className="h-3.5 w-3.5" />
            </button>
            <span aria-hidden="true" className="mx-1 my-0.5 h-px bg-line" />
            <button
              type="button"
              aria-label="Reset map view"
              title="Reset view"
              disabled={isDefaultView}
              onClick={() => setView(DEFAULT_VIEW)}
              className={zoomControl}
            >
              <Icon name="fit" className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
      </div>

      {kindsShown.length > 0 ? (
        <div className="flex items-center justify-center gap-4 px-4 py-3 text-xs text-mute">
          {kindsShown.map((kind) => (
            <span key={kind} className="flex items-center gap-1.5">
              <span
                className={`h-0.5 w-4 rounded-full ${LEGEND_CLASS[kind]}`}
                style={LEGEND_SWATCH[kind] ? { backgroundImage: LEGEND_SWATCH[kind] } : undefined}
              />
              {EDGE_LABEL[kind]}
            </span>
          ))}
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
