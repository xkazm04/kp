"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { cssSafeId, fieldMarkup } from "./sieveDots";
import { countByLayer, fieldColumns, fieldHeight, groupByLayer, itemsPerDot, placeDots, PITCH, type FieldBox, type SieveDot, type SieveItem } from "./sieveLayout";
import { claimPlay, prefersReducedMotionNow } from "./playOnce";
import { runPour } from "./sievePour";

/*
 * The Sieve's DOM half: measure each layer's field, size it to its dots, draw the dots into the one
 * svg, and pour them once per replay key. Everything it computes comes from sieveLayout.ts; this hook
 * only reads boxes and writes nodes. It redraws (without replaying) when the sheet's width changes -
 * a reading pane opening folds the field away and closing it brings the dots back.
 */
export function useSieveField({
  id, layerIds, items, dim, picked, replayKey, budget, reduced, format, enabled,
}: {
  id: string;
  layerIds: readonly string[];
  items: readonly SieveItem[];
  dim?: ReadonlySet<string>;
  picked?: string;
  replayKey: string;
  budget: number;
  reduced: boolean;
  format: (n: number) => string;
  enabled: boolean;
}): { boxRef: RefObject<HTMLDivElement | null>; svgRef: RefObject<SVGSVGElement | null> } {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const drawn = useRef("");
  const [width, setWidth] = useState(0);
  // The caller's arrays are rebuilt every render; the drawing only cares about their content.
  const sig = `${layerIds.join("|")}#${items.map((i) => `${i.id}:${i.layer}:${i.shape}:${i.tone ?? ""}:${i.needs ? 1 : 0}`).join(",")}`;
  const live = useRef({ dim, picked, items, layerIds, format });
  useLayoutEffect(() => {
    live.current = { dim, picked, items, layerIds, format };
  });

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(box);
    return () => ro.disconnect();
  }, [enabled]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const svg = svgRef.current;
    if (!enabled || !box || !svg) return;
    const { items: its, layerIds: ids, dim: d, picked: p, format: fmt } = live.current;
    // The layer fields and counters are found by their data hooks, as the winner's hydrate() did.
    const fields = new Map<string, HTMLElement>();
    box.querySelectorAll<HTMLElement>("[data-sv-field]").forEach((f) => fields.set(f.dataset.svField ?? "", f));
    const counters = new Map<string, HTMLElement>();
    box.querySelectorAll<HTMLElement>("[data-sv-count]").forEach((c) => counters.set(c.dataset.svCount ?? "", c));
    const first = fields.get(ids[0]);
    const W = first?.clientWidth ?? 0;
    // The observer's first report repeats the width this effect already drew at: skip it, or it would
    // cancel the pour it just started.
    const key = `${sig}@${W}@${replayKey}@${budget}`;
    if (key === drawn.current) return;
    drawn.current = key;
    cancel.current?.();
    cancel.current = null;
    if (!W) {
      svg.innerHTML = ""; // folded away (a reading pane is open): nothing to draw until it has room
      return;
    }
    const per = itemsPerDot(its.length, budget);
    const cols = fieldColumns(W);
    const groups = groupByLayer(ids, its, per);
    for (const [k, g] of Object.entries(groups)) {
      const f = fields.get(k);
      if (f) f.style.height = `${fieldHeight(g.length, cols)}px`;
    }
    const bb = box.getBoundingClientRect();
    const boxes: Record<string, FieldBox> = {};
    for (const [k, f] of fields) {
      const r = f.getBoundingClientRect();
      boxes[k] = { left: r.left - bb.left, top: r.top - bb.top, height: r.height };
    }
    const dots: SieveDot[] = placeDots(groups, boxes, cols, PITCH);
    svg.setAttribute("width", String(bb.width));
    svg.setAttribute("height", String(bb.height));
    svg.setAttribute("viewBox", `0 0 ${bb.width} ${bb.height}`);
    svg.innerHTML = fieldMarkup(dots, d, p);
    if (!claimPlay(id, replayKey, reduced || prefersReducedMotionNow())) return;
    const pour = box.querySelector<HTMLElement>(".k-sieve__pour");
    cancel.current = runPour(svg, dots, (pour?.offsetHeight ?? 44) / 2, counters, countByLayer(ids, its), fmt);
    // `sig` stands for items/layerIds, which the effect reads through `live`.
  }, [enabled, sig, width, replayKey, budget, id, reduced]);

  // No cancel on unmount: StrictMode's rehearsal unmount would freeze a running pour at opacity 0 on
  // nodes that stay in the page. A real unmount lets the loop run out (< 1 s) on detached nodes.

  // Linked dimming and the picked dot change classes only: no redraw, no replay, a pour keeps running.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const pickedId = picked ? cssSafeId(picked) : null;
    const dimmed = new Set([...(dim ?? [])].map(cssSafeId));
    svg.querySelectorAll<SVGGElement>("g.k-dot").forEach((g) => {
      const key = g.dataset.id ?? "";
      g.classList.toggle("is-dim", dimmed.has(key));
      g.classList.toggle("is-picked", key === pickedId);
    });
  }, [dim, picked]);

  return { boxRef, svgRef };
}
