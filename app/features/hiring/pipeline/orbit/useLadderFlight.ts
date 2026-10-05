"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { kindOf } from "./orbitLayout";
import { readPalette, runFlight, type Part } from "./orbitPaint";
import type { OrbitModel } from "./orbitModel";

type Spot = { x: number; y: number; r: number };

/** Every bead under `root`, relative to `anchor` (an element both levels share), so a scroll in between is undone. */
function beadsIn(root: ParentNode | null | undefined, anchor: DOMRect): Map<string, Spot> {
  const out = new Map<string, Spot>();
  root?.querySelectorAll<HTMLElement>("[data-p]").forEach((b) => {
    const r = b.getBoundingClientRect();
    if (r.width) out.set(b.dataset.p ?? "", { x: r.left + r.width / 2 - anchor.left, y: r.top + r.height / 2 - anchor.top, r: r.width / 2 });
  });
  return out;
}

/**
 * The lanes -> bench leg of the one flight ("The Orbit, Lit"): opening a role's bench from its lane
 * flies each of its beads from its cell to its row on the ladder, the same mark all the way down.
 * `arm(roleKey)` is called just before the bench replaces the lanes; the flight runs once the bench
 * is in the DOM. Skipped under reduced motion (the bench simply appears).
 */
export function useLadderFlight(
  model: OrbitModel | null,
  roleKey: string | null,
  refs: { lanes: RefObject<HTMLDivElement | null>; fly: RefObject<HTMLCanvasElement | null>; anchor: RefObject<HTMLElement | null> },
  reduced: boolean
) {
  const pending = useRef<{ key: string; from: Map<string, Spot> } | null>(null);

  /** Remember where the role's beads are before the bench replaces the lanes; true when a flight is armed. */
  const arm = (key: string): boolean => {
    const anchor = refs.anchor.current?.getBoundingClientRect();
    if (reduced || roleKey || !anchor) return false;
    const row = refs.lanes.current?.querySelector(`[data-role-key="${CSS.escape(key)}"]`);
    const from = beadsIn(row, anchor);
    pending.current = from.size ? { key, from } : null;
    return from.size > 0;
  };

  useLayoutEffect(() => {
    const pend = pending.current;
    if (!pend || pend.key !== roleKey) return;
    pending.current = null;
    const bench = document.querySelector<HTMLElement>('[data-role="orbit-ladder"]');
    const overlay = refs.fly.current;
    const a = refs.anchor.current?.getBoundingClientRect();
    if (!bench || !overlay || !model || !a) return;
    const to = beadsIn(bench.querySelector(".ob-rungs"), a);
    const parts: Part[] = [];
    for (const [id, f] of pend.from) {
      const t = to.get(id);
      const p = model.byId.get(id);
      if (!t || !p) continue;
      parts.push({ d: { p, k: kindOf(p) }, fx: f.x + a.left, fy: f.y + a.top, tx: t.x + a.left, ty: t.y + a.top, fr: f.r, tr: t.r, fa: 1, ta: 1, delay: Math.min(0.3, parts.length * 0.012) });
    }
    if (!parts.length) return;
    bench.classList.add("is-flying");
    runFlight(overlay, readPalette(), parts, 820, () => bench.classList.remove("is-flying"));
  }, [roleKey, model, refs]);

  return arm;
}
