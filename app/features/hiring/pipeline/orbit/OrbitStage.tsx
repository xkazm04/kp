"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { labelWidths } from "@/app/_components/kit/scene";
import { useTheme } from "@/app/_components/ui/useTheme";
import type { StageDef } from "@/app/features/shared/pipelineTypes";
import { type LensId, type OrbitGroup } from "./orbitModel";
import { anchorOf, CALLOUT_W, layoutOrbit, placeCallouts, sectorAt, type Dot, type OrbitGeo } from "./orbitLayout";
import { drawOrbit, readPalette, ringGrowth, runFlight, type Part } from "./orbitPaint";
import { OrbitMark, Sep } from "./OrbitMarks";
import { OrbitLegend } from "./OrbitLegend";
import { cx } from "./orbitCx";
import type { OrbitWords } from "./orbitWords";

/** A dot where it sits on screen right now (viewport px). */
export type ScreenDot = { d: Dot; x: number; y: number; r: number };
export type Snapshot = { dots: ScreenDot[]; center: { x: number; y: number } };
/** Where the people are coming FROM when the orbit (re)appears: the lanes' beads, the previous lens, or
 *  the Overview's own orbit ("grow": the same dots, smaller; `origin` is that orbit's centre and radius). */
export type Arrival = {
  nonce: number;
  mode: "up" | "resector" | "grow";
  from: ReadonlyMap<string, { x: number; y: number; r: number }>;
  key: string | null;
  origin?: { cx: number; cy: number; R: number } | null;
};
export type OrbitStageHandle = { snapshot: () => Snapshot | null };

type Props = {
  groups: OrbitGroup[];
  lens: LensId;
  axis: readonly StageDef[];
  words: OrbitWords;
  /** A stage the page is focused on (Today, the ring key), as an axis index. */
  ring: number | null;
  /** Focus a ring from the ring key under the orbit (null = every stage). */
  onRing: (i: number | null) => void;
  /** People an Overview queue lit: drawn forward, everyone else dimmed. */
  focus: ReadonlySet<string> | null;
  onOpen: (key: string) => void;
  arrival: Arrival | null;
  /** Called before a grow arrival measures, so the page can bring the orbit into view first. */
  beforeGrow?: () => void;
  fly: RefObject<HTMLCanvasElement | null>;
  reduced: boolean;
  closedEmpty: number;
  jobsMissing: boolean;
};

const EASE = "cubic-bezier(.2,.8,.2,1)";

/**
 * Level 0: the orbit. Every active person is a dot; rings are stages (entry outside, hired at the hub),
 * sectors are groups under the picked lens, and the sector nearest 12 o'clock has the most people
 * waiting on a human. Empty roles sit on the rim, one mark per reason. The callouts beside it are the
 * keyboard path and the numbers (the canvas is decoration for assistive tech); on a narrow sheet they
 * fall back to a list under the orbit. A lens switch sends every dot to its new sector and brings each
 * callout out from its sector's edge; coming back up from a group flies the beads home.
 */
export const OrbitStage = forwardRef<OrbitStageHandle, Props>(function OrbitStage(
  { groups, lens, axis, words, ring, onRing, focus, onOpen, arrival, beforeGrow, fly, reduced, closedEmpty, jobsMissing },
  ref
) {
  const { t } = words;
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const coRefs = useRef(new Map<string, HTMLButtonElement>());
  const [width, setWidth] = useState(0);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [hot, setHot] = useState<string | null>(null);
  const [fontsTick, setFontsTick] = useState(0);
  const theme = useTheme();

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFontsTick((v) => v + 1)).catch(() => { /* fonts API absent: the first paint stands */ });
    return () => { live = false; };
  }, []);

  const ringLabels = useMemo(() => axis.map((s) => words.stage(s.id)), [axis, words]);
  // Each stage's people, across every group: the rings are cut so each band's area follows them.
  const counts = useMemo(() => axis.map((_, i) => groups.reduce((sum, g) => sum + (g.st[i]?.n ?? 0), 0)), [axis, groups]);
  const geo: OrbitGeo | null = useMemo(
    () => (width > 0 ? layoutOrbit(groups, axis.length, width, 900, { counts, labels: labelWidths(ringLabels) }) : null),
    [groups, axis.length, width, counts, ringLabels]
  );

  // Measure every callout's height once it is in the DOM, so the columns stack without overlap.
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const g of groups) {
      const el = coRefs.current.get(g.key);
      if (el) next.set(g.key, el.offsetHeight);
    }
    const same = next.size === heights.size && [...next].every(([k, v]) => heights.get(k) === v);
    if (!same) setHeights(next);
  }, [groups, geo, words, ring, fontsTick, heights]);

  const ready = geo != null && (!geo.side || groups.every((g) => heights.has(g.key)));
  const { places, height } = useMemo(() => (geo ? placeCallouts(geo, heights) : { places: [], height: 0 }), [geo, heights]);
  const placeOf = useMemo(() => new Map(places.map((p) => [p.key, p])), [places]);

  useEffect(() => {
    if (!geo || !cv.current) return;
    drawOrbit(cv.current, geo, readPalette(), { hot, ring, places, height, ringLabels, focus });
  }, [geo, places, height, hot, ring, ringLabels, focus, theme, fontsTick]);

  useImperativeHandle(ref, () => ({
    snapshot: () => {
      if (!geo || !cv.current) return null;
      const r = cv.current.getBoundingClientRect();
      return { dots: geo.dots.map((d) => ({ d, x: r.left + d.x, y: r.top + d.y, r: d.r })), center: { x: r.left + geo.cx, y: r.top + geo.cy } };
    },
  }), [geo]);

  // An arrival (back up from a group, or a new lens) flies once per nonce, after the callouts settled.
  const landed = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!arrival || !ready || !geo || !cv.current || landed.current === arrival.nonce) return;
    landed.current = arrival.nonce;
    // Back up from a group: focus lands on that group's callout (the keyboard path home).
    if (arrival.mode === "up" && arrival.key) coRefs.current.get(arrival.key)?.focus({ preventScroll: true });
    if (reduced) {
      wrap.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140 });
      return;
    }
    // The callouts come out of their sector's edge, most urgent first.
    places.forEach((p, i) => {
      const el = coRefs.current.get(p.key);
      const s = geo.sectors.find((x) => x.g.key === p.key);
      if (!el || !s) return;
      const a = anchorOf(geo, s);
      const dx = a.x - (p.right ? p.left : p.left + CALLOUT_W);
      const dy = a.y - p.top;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(.35)`, opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 820, delay: 140 + i * 30, easing: EASE, fill: "backwards" }
      );
    });
    const canvas = cv.current;
    const overlay = fly.current;
    if (!overlay) return;
    if (arrival.mode === "grow") beforeGrow?.();
    const r = canvas.getBoundingClientRect();
    const center = { x: r.left + geo.cx, y: r.top + geo.cy };
    const parts: Part[] = geo.dots.map((d) => {
      const tx = r.left + d.x;
      const ty = r.top + d.y;
      const f = arrival.from.get(d.p.id);
      if (f) return { d, fx: f.x, fy: f.y, tx, ty, fr: f.r, tr: d.r, fa: 1, ta: 1, delay: Math.min(0.28, d.p.si * 0.05) };
      const ox = tx - center.x;
      const oy = ty - center.y;
      const len = Math.hypot(ox, oy) || 1;
      const mine = d.g === arrival.key;
      return { d, fx: mine ? tx : tx + (ox / len) * 260, fy: mine ? ty + 40 : ty + (oy / len) * 260, tx, ty, fr: d.r, tr: d.r, fa: 0, ta: 1, delay: mine ? 0.2 : 0.1 };
    });
    canvas.style.visibility = "hidden";
    const pal = readPalette();
    // Growing out of the Overview: the rings widen from its centre and radius to ours while the dots fly.
    const o = arrival.mode === "grow" ? arrival.origin : null;
    const paint = o ? ringGrowth(pal, geo.rings, o, { cx: center.x, cy: center.y, R: geo.R }) : undefined;
    const dur = arrival.mode === "grow" ? 1150 : arrival.mode === "up" ? 1050 : 950;
    const stop = runFlight(overlay, pal, parts, dur, () => { canvas.style.visibility = ""; }, paint);
    return () => { if (landed.current !== arrival.nonce) stop(); };
  }, [arrival, ready, geo, places, reduced, fly, beforeGrow]);

  const pointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!geo) return null;
    const r = e.currentTarget.getBoundingClientRect();
    return sectorAt(geo, e.clientX - r.left, e.clientY - r.top);
  };

  const callout = (g: OrbitGroup, style: React.CSSProperties | undefined, side: "r" | "l" | "list") => {
    const st = ring != null ? g.st[ring] : null;
    const cls = cx("ob-co", `ob-co--${side}`, g.wait && "is-needs", hot === g.key && "is-hot");
    return (
      <button
        key={g.key}
        type="button"
        ref={side === "list" ? undefined : (el) => { if (el) coRefs.current.set(g.key, el); else coRefs.current.delete(g.key); }}
        className={cls}
        style={style}
        data-role="orbit-callout"
        data-key={g.key}
        onClick={() => onOpen(g.key)}
        onMouseEnter={() => setHot(g.key)}
        onMouseLeave={() => setHot(null)}
        onFocus={() => setHot(g.key)}
        onBlur={() => setHot(null)}
        aria-label={t("calloutAria", { group: words.group(lens, g.key), waiting: g.wait, late: g.aging, people: g.act, live: g.live, roles: g.roles.length })}
      >
        <b>{words.group(lens, g.key)}</b>
        {st ? (
          <span>
            {st.wait ? <em className="ob-w"><OrbitMark kind="needs" small />{t("waitingN", { count: st.wait })}</em> : null}{" "}
            <span>{t("inStage", { count: st.n, stage: ringLabels[ring ?? 0] })}</span>
          </span>
        ) : (
          <span>
            {g.wait ? <em className="ob-w"><OrbitMark kind="needs" small />{t("waitingN", { count: g.wait })}</em> : null}{" "}
            {g.aging ? <em className="ob-a"><OrbitMark kind="late" small />{t("lateN", { count: g.aging })}</em> : null}{" "}
            <span><Sep />{t("peopleN", { count: g.act })}</span>
          </span>
        )}
        {g.abs.vacant || g.abs.draft ? (
          <span className="ob-co__e">
            {t("liveOf", { live: g.live, roles: g.roles.length })}
            {g.abs.vacant ? ` · ${t("absVacantN", { count: g.abs.vacant })}` : ""}
            {g.abs.draft ? ` · ${t("absDraftN", { count: g.abs.draft })}` : ""}
          </span>
        ) : null}
      </button>
    );
  };

  const hidden: React.CSSProperties = { left: 0, top: 0, visibility: "hidden" };
  return (
    <section className="ob-orbit" aria-label={t("orbitAria")} data-role="orbit">
      <div ref={wrap} className="ob-orbit__plane" style={{ height: geo ? (geo.side ? height : geo.H) : undefined }}>
        <canvas
          ref={cv}
          aria-hidden
          onMouseMove={(e) => {
            const s = pointer(e);
            setHot(s ? s.g.key : null);
            e.currentTarget.style.cursor = s ? "pointer" : "default";
          }}
          onMouseLeave={() => setHot(null)}
          onClick={(e) => {
            const s = pointer(e);
            if (s) onOpen(s.g.key);
          }}
        />
        {geo?.side
          ? groups.map((g) => {
              const p = placeOf.get(g.key);
              return callout(g, p && ready ? { left: p.left, top: p.top } : hidden, p?.right === false ? "l" : "r");
            })
          : null}
      </div>
      {geo && !geo.side ? <div className="ob-colist">{groups.map((g) => callout(g, undefined, "list"))}</div> : null}
      <OrbitLegend axis={axis} words={words} ring={ring} onRing={onRing} counts={counts} ringLabels={ringLabels} people={groups.reduce((sum, g) => sum + g.act, 0)} closedEmpty={closedEmpty} jobsMissing={jobsMissing} />
    </section>
  );
});
