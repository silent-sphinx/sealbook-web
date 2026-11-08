// @vitest-environment jsdom
/**
 * The network map's frame loop, mounted on its own.
 *
 * Positions belong to the simulation rather than to React, so a frame moves
 * the elements already on the page. What is under test is that the layout is
 * on the nodes before the first frame, at the pane's measured size, that a
 * frame moves both the nodes and the edges, and that it does so without
 * re-rendering the avatar subtree each node carries.
 */

import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "../test/dom";
import { profileOf } from "../lib/contactProfile";
import type { Contact } from "../lib/types";

let avatarRenders = 0;

vi.mock("./ContactCard", async () => {
  const actual = await vi.importActual<typeof import("./ContactCard")>("./ContactCard");
  return {
    ...actual,
    Avatar: (props: Parameters<typeof actual.Avatar>[0]) => {
      avatarRenders++;
      return createElement(actual.Avatar, props);
    },
  };
});

const { ContactNetworkMap } = await import("./ContactNetworkMap");

/** A ring of mutually linked contacts, large enough that the presettle leaves it still moving. */
function aRing(count: number): Contact[] {
  return Array.from({ length: count }, (_, index) => {
    const next = `c${(index + 1) % count}`;
    return {
      id: `c${index}`,
      name: `Person ${index}`,
      emails: [],
      phones: [],
      work: [],
      dates: [],
      socials: [],
      addresses: [],
      addressBookId: "default",
      raw: "{}",
      ciphertext: "",
      paddedSize: 0,
      profile: {
        ...profileOf(),
        friends: [{ id: `p${index}`, name: next, contactId: next }],
      },
    } satisfies Contact;
  });
}

let frames: FrameRequestCallback[] = [];

// jsdom has neither pointer capture nor `PointerEvent`, which the drag handlers use.
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
globalThis.PointerEvent ??= class extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
} as typeof PointerEvent;

/** jsdom lays nothing out, so a measurable pane has to be given one. */
function givePaneLayout(width: number, height: number): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect);
}

beforeEach(() => {
  avatarRenders = 0;
  frames = [];
  // The map draws nothing until the pane measures, and jsdom lays nothing out.
  givePaneLayout(600, 400);
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function runFrames(count: number): void {
  for (let i = 0; i < count; i++) {
    const queued = frames;
    frames = [];
    act(() => {
      for (const callback of queued) callback(i);
    });
  }
}

/** Each node's `<g>`, found through the circle it draws rather than the pan-and-zoom wrapper. */
function nodeTransforms(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("circle")].map((circle) =>
    circle.parentElement!.getAttribute("transform"),
  );
}

function edgeEnds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("line")].map((line) => line.getAttribute("x1"));
}

function mount(count = 40) {
  return render(<ContactNetworkMap contacts={aRing(count)} onSelectContact={() => {}} />);
}

function nodeX(transform: string | null): number {
  return Number(/translate\(([-\d.]+)/.exec(transform ?? "")?.[1]);
}

describe("the contact network map's frame loop", () => {
  it("lays the graph out at the pane's measured size, not at a guess", () => {
    givePaneLayout(900, 500);

    const { container } = mount();

    // Drawn at the pane's own size: a `viewBox` of any other shape is scaled
    // to the pane, which draws the graph and its icons at the wrong scale.
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 900 500");
    expect(Math.max(...nodeTransforms(container).map(nodeX))).toBeGreaterThan(500);
  });

  it("has the presettled layout on the nodes before the first frame", () => {
    const { container } = mount();

    const transforms = nodeTransforms(container);
    expect(transforms.length).toBe(40);
    for (const transform of transforms) expect(transform).toMatch(/^translate\(/);
    expect(new Set(transforms).size).toBe(transforms.length);
  });

  it("moves the nodes and their edges on a frame", () => {
    const { container } = mount();
    const nodesBefore = nodeTransforms(container);
    const edgesBefore = edgeEnds(container);

    runFrames(10);

    expect(nodeTransforms(container)).not.toEqual(nodesBefore);
    expect(edgeEnds(container)).not.toEqual(edgesBefore);
  });

  it("paints a frame without re-rendering the node subtrees", () => {
    const { container } = mount();
    const painted = avatarRenders;
    expect(painted).toBeGreaterThan(0);

    runFrames(10);

    expect(nodeTransforms(container)).not.toEqual([]);
    expect(avatarRenders).toBe(painted);
  });

  it("stops asking for frames once the layout settles", () => {
    mount(3);

    runFrames(400);

    expect(frames).toEqual([]);
  });

  it("dims contacts outside the hovered one's neighbourhood without re-rendering avatars", () => {
    const { container } = mount();
    const painted = avatarRenders;
    const nodeOf = (name: string) => screen.getByRole("button", { name }).closest("g")!;

    fireEvent.mouseEnter(nodeOf("Person 0"));

    expect(nodeOf("Person 0").style.opacity).toBe("");
    expect(nodeOf("Person 1").style.opacity).toBe("");
    expect(nodeOf("Person 39").style.opacity).toBe("");
    expect(nodeOf("Person 20").style.opacity).not.toBe("");
    expect(container.querySelector("text")?.textContent).toBe("Person 0");
    expect(avatarRenders).toBe(painted);

    fireEvent.mouseLeave(nodeOf("Person 0"));

    expect(nodeOf("Person 20").style.opacity).toBe("");
    expect(container.querySelector("text")).toBeNull();
  });

  it("goes idle after a drag the browser cancels", () => {
    mount(3);
    const node = screen.getByRole("button", { name: "Person 0" }).closest("g")!;

    fireEvent.pointerDown(node, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(node, { clientX: 80, clientY: 80 });
    fireEvent.pointerCancel(node);
    runFrames(400);

    expect(frames).toEqual([]);
  });

  it("keeps the zoom controls in place as the view changes", () => {
    mount();
    const controls = () =>
      screen.getByRole("button", { name: "Zoom in" }).parentElement!.querySelectorAll("button");
    const labels = () => [...controls()].map((button) => button.getAttribute("aria-label"));
    const reset = () => screen.getByRole("button", { name: "Reset map view" });

    expect(labels()).toEqual(["Zoom in", "Zoom out", "Reset map view"]);
    expect(reset()).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(labels()).toEqual(["Zoom in", "Zoom out", "Reset map view"]);
    expect(reset()).toHaveProperty("disabled", false);

    fireEvent.click(reset());

    expect(reset()).toHaveProperty("disabled", true);
  });

  it("zooms on a wheel that reports its delta in lines", () => {
    const { container } = mount();
    const svg = container.querySelector("svg")!;

    act(() => {
      svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -3, deltaMode: 1, cancelable: true }));
    });

    const scale = Number(/scale\(([\d.]+)\)/.exec(svg.querySelector("g")!.getAttribute("transform")!)![1]);
    expect(scale).toBeGreaterThan(1.05);
  });
});
