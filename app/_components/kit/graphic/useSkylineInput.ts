"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { nextFocus, rankAt, type SkyGeometry } from "./skylineGeometry";

/*
 * The Skyline's one focusable control: pointer drag draws a brush (a click without movement picks a
 * bar), and the keyboard does everything the pointer does - arrows move, Alt x10, Shift extends the
 * range from an anchor, Home/End jump, Enter opens, Escape clears the brush. Keys the part handles stop
 * here, so the workspace's own shortcuts (the g-chords) never see them.
 */
export function useSkylineInput<T>({
  items, geo, brush, onBrush, onPick,
}: {
  items: readonly T[];
  geo: SkyGeometry | null;
  brush: readonly [number, number] | null | undefined;
  onBrush: (range: [number, number] | null) => void;
  onPick: (item: T) => void;
}) {
  const [focus, setFocus] = useState<number | null>(null);
  const [live, setLive] = useState<[number, number] | null>(null);
  const anchor = useRef<number | null>(null);
  const drag = useRef<{ from: number; moved: boolean } | null>(null);

  const rankOf = (e: PointerEvent<SVGSVGElement>) => {
    if (!geo) return 0;
    const r = e.currentTarget.getBoundingClientRect();
    return rankAt(geo, e.clientX - r.left, items.length);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!geo || !items.length) return;
    drag.current = { from: rankOf(e), moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const b = rankOf(e);
    if (b !== d.from) d.moved = true;
    if (d.moved) setLive([Math.min(d.from, b), Math.max(d.from, b)]);
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    setLive(null);
    if (!d) return;
    const b = rankOf(e);
    if (!d.moved) {
      setFocus(d.from);
      onPick(items[d.from]);
      return;
    }
    onBrush([Math.min(d.from, b), Math.max(d.from, b)]);
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!items.length) return;
    const f = focus ?? 0;
    const nf = nextFocus(f, e.key, e.altKey, items.length);
    if (nf != null) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        if (anchor.current == null || !brush) anchor.current = f;
        onBrush([Math.min(anchor.current, nf), Math.max(anchor.current, nf)]);
      } else anchor.current = null;
      setFocus(nf);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onPick(items[f]);
    } else if (e.key === "Escape" && brush) {
      e.preventDefault();
      e.stopPropagation();
      anchor.current = null;
      onBrush(null);
    }
  };

  return { focus, live, handlers: { onPointerDown, onPointerMove, onPointerUp, onKeyDown } };
}
