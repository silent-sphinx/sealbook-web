import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { COLLECTION_PALETTE } from "../lib/collectionPalette";
import { placeAt } from "../lib/placement";
import { focusRing, popoverSurface } from "../lib/styles";

export type PaletteState = { x: number; y: number; current: string } | null;

const COLUMNS = COLLECTION_PALETTE[0].length;

export function ColourPalette({
  state,
  label,
  onPick,
  onClose,
}: {
  state: PaletteState;
  label: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!state || !ref.current) {
      setPlaced(null);
      return;
    }
    // Layout size, not the bounding rect: the panel opens from `scale(0.95)`, so
    // its rect is 5% smaller than the panel and a menu at an edge would overrun it.
    const panel = ref.current;
    setPlaced(
      placeAt(
        { x: state.x, y: state.y },
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    const swatches = ref.current.querySelectorAll<HTMLButtonElement>("button");
    const current = Array.from(swatches).find((swatch) => swatch.getAttribute("aria-pressed") === "true");
    (current ?? swatches[0])?.focus();
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const close = (event: Event) => {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      const swatches = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      const at = swatches.indexOf(document.activeElement as HTMLButtonElement);
      const next = at + step;
      if (next >= 0 && next < swatches.length) swatches[next].focus();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [state, onClose]);

  if (!state) return null;
  const current = state.current.toLowerCase();

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      style={{
        left: placed?.left ?? state.x,
        top: placed?.top ?? state.y,
        visibility: placed ? "visible" : "hidden",
      }}
      className={`fixed z-(--z-popover) animate-pop p-2.5 ${popoverSurface}`}
    >
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1.25rem)` }}>
        {COLLECTION_PALETTE.flat().map((swatch) => {
          const chosen = swatch.hex === current;
          return (
            <button
              key={swatch.hex}
              type="button"
              title={swatch.name}
              aria-label={swatch.name}
              aria-pressed={chosen}
              onClick={() => {
                onClose();
                if (!chosen) onPick(swatch.hex);
              }}
              style={{ backgroundColor: swatch.hex }}
              className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                chosen ? "ring-2 ring-text ring-offset-2 ring-offset-panel" : ""
              } ${focusRing}`}
            />
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
