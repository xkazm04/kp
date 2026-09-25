/*
 * The pour, run on the dots the Sieve already drew: one requestAnimationFrame loop moves every node and
 * ticks each layer's counter as its dots land. Returns a cancel that settles everything at its final
 * frame (used when the data or the width changes mid-pour, and on unmount).
 */
import { fallEase, pourPlan, popScale, type SieveDot } from "./sieveLayout";

export function runPour(
  svg: SVGSVGElement,
  dots: readonly SieveDot[],
  pourY: number,
  counters: ReadonlyMap<string, HTMLElement>,
  finalCounts: Readonly<Record<string, number>>,
  format: (n: number) => string
): () => void {
  const nodes = svg.querySelectorAll<SVGGElement>("g.k-dot");
  const counts: Record<string, number> = {};
  for (const [layer, el] of counters) {
    counts[layer] = 0;
    el.textContent = format(0);
  }
  const plan = pourPlan(dots).map((p) => ({ ...p, done: false }));
  for (const p of plan) nodes[p.index]?.style.setProperty("opacity", "0");
  const place = (i: number) => `translate(${dots[i].x.toFixed(1)} ${dots[i].y.toFixed(1)})`;

  const settle = () => {
    for (const p of plan) {
      const g = nodes[p.index];
      if (!g) continue;
      g.style.removeProperty("opacity");
      g.setAttribute("transform", place(p.index));
    }
    for (const [layer, el] of counters) el.textContent = format(finalCounts[layer] ?? 0);
  };

  const t0 = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    let live = false;
    for (const p of plan) {
      if (p.done) continue;
      const g = nodes[p.index];
      const d = dots[p.index];
      const t = (now - t0 - p.delay) / p.dur;
      if (!g) {
        p.done = true; // the field was redrawn under the pour: nothing left to move
        continue;
      }
      if (t < 0) {
        live = true;
        continue;
      }
      if (t >= 1) {
        p.done = true;
        g.style.removeProperty("opacity");
        g.setAttribute("transform", place(p.index));
        const layer = d.item.layer;
        counts[layer] = (counts[layer] ?? 0) + d.item.n;
        const el = counters.get(layer);
        if (el) el.textContent = format(counts[layer]);
        continue;
      }
      live = true;
      if (p.kind === "fall") {
        const y = pourY + (d.y - pourY) * fallEase(t);
        g.style.opacity = String(Math.min(1, t * 4));
        g.setAttribute("transform", `translate(${d.x.toFixed(1)} ${y.toFixed(1)})`);
      } else if (p.kind === "pop") {
        g.style.opacity = "1";
        g.setAttribute("transform", `${place(p.index)} scale(${popScale(t).toFixed(3)})`);
      } else g.style.opacity = String(t);
    }
    if (live) raf = requestAnimationFrame(frame);
    else {
      raf = 0;
      settle();
    }
  };
  raf = requestAnimationFrame(frame);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    settle();
  };
}
