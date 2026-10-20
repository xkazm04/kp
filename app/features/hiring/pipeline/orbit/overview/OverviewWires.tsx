"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { Wires, nearest, wireFor, type Pt, type SceneWire } from "@/app/_components/kit/scene";
import type { OrbitGeo } from "../orbitLayout";
import type { OverviewDialHandle } from "./OverviewDial";
import type { QueueView } from "./overviewParts";

type Props = {
  scene: RefObject<HTMLDivElement | null>;
  dial: RefObject<OverviewDialHandle | null>;
  cards: RefObject<Map<string, HTMLElement>>;
  note: RefObject<HTMLElement | null>;
  queues: readonly QueueView[];
  geo: OrbitGeo;
  /** The queue being pointed at: its wire lights and threads run to each of its people. */
  hot: string | null;
};

type Measured = {
  center: Pt;
  /** The canvas's top-left in scene coordinates: a dot's scene point is this plus its own. */
  off: Pt;
  wires: SceneWire[];
  arrow: { from: Pt; to: Pt } | null;
};

/**
 * The Overview's measure of the kit's wire layer (`Wires`, `wireFor`, `nearest`): from each queue card
 * to the ring its people stand on, meeting it at the angle that faces the card (so no wire crosses
 * the dial). The queue being pointed at lights its wire, and threads run from the wire's end to each
 * of its people. The hand note under "needs you" points at the nearest person waiting on a human.
 * Measured after layout and again whenever the scene or a card changes size; a stacked scene draws
 * no wires (orbitOverview.css hides the layer).
 */
export function OverviewWires({ scene, dial, cards, note, queues, geo, hot }: Props) {
  const [m, setM] = useState<Measured | null>(null);

  useLayoutEffect(() => {
    const el = scene.current;
    if (!el) return;
    const measure = () => {
      const s = el.getBoundingClientRect();
      const c = dial.current?.box();
      if (!c) return;
      const off = { x: c.left - s.left, y: c.top - s.top };
      const center = { x: off.x + geo.cx, y: off.y + geo.cy };
      const hub = geo.rings.length - 1;
      const wires: Measured["wires"] = [];
      for (const q of queues) {
        const card = cards.current.get(q.key)?.getBoundingClientRect();
        if (!card) continue;
        const band = geo.rings[q.si ?? hub] ?? geo.rings[hub];
        const box = { left: card.left - s.left, right: card.right - s.left, top: card.top - s.top, bottom: card.bottom - s.top };
        const w = wireFor(box, center, [band[0] * geo.R, band[1] * geo.R], geo.R);
        if (w) wires.push({ key: q.key, calm: !q.needs, w });
      }
      let arrow: Measured["arrow"] = null;
      const n = note.current?.getBoundingClientRect();
      if (n && n.width && wires.length) {
        const from = { x: n.right - s.left + 6, y: n.top - s.top + n.height / 2 };
        const waiting = geo.dots.filter((d) => d.k === "w" && d.x + off.x < center.x).map((d) => ({ x: d.x + off.x, y: d.y + off.y }));
        const to = nearest(from, waiting);
        if (to) arrow = { from, to };
      }
      setM({ center, off, wires, arrow });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const card of cards.current.values()) ro.observe(card);
    return () => ro.disconnect();
  }, [scene, dial, cards, note, queues, geo]);

  if (!m) return null;
  const lit = hot ? queues.find((q) => q.key === hot) ?? null : null;
  const off = m.off;
  const threads = lit
    ? { center: m.center, to: geo.dots.filter((d) => lit.ids.has(d.p.id)).map((d) => ({ key: d.p.id, pt: { x: off.x + d.x, y: off.y + d.y } })) }
    : null;
  return <Wires className="ov-wires" wires={m.wires} hot={lit ? lit.key : null} threads={threads} arrow={m.arrow} />;
}
