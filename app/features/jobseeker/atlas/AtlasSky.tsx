"use client";

import { useCallback, useMemo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { FitTier, KoReasonKey, PostingStatus } from "@/app/_lib/jobseeker/types";
import type { SieveFacts, SievePosting } from "../sieve/sieveModel";
import { TierGlyph } from "./AtlasArt";
import { aperture, arcPath, bandWidth, clamp, polar, rotFor, rOf, SK, type Lock, type RimLayout, type SkyLayout } from "./atlasModel";
import { Button } from "@/app/_components/kit";
import { AT_ARC, AT_CHIP, AT_PLATE, AT_SECTOR } from "./atlasRecipes";

// THE SKY (contest winner me-hub A/3): every posting is a mark in one chart. Radius = 100 minus
// the score (the rings read 75 / 50 / 25), the sector is the posting's source, the place inside
// the sector comes from its id, so nothing moves between visits. What never reached a score sits
// on the RIM, never plotted at 0: hollow rings grouped by gate, then held at the door, then
// waiting for a score. Until the dome opens (a CV and the five wants) an iris covers the sky and
// the marks are an unlit scatter. Pointing at a mark (hover, focus, arrows, tap) sets its name at
// the centre in display type; the words are real HTML over the drawing, never below 14px.

export type Pointed = { kind: "star"; id: string } | { kind: "gate"; key: string } | { kind: "sector"; key: string } | null;
export type PointSource = "hover" | "focus" | "tap" | "card";
export type Headline = { hero: string; text: string; sub: string };

const TIERS: FitTier[] = ["strong", "promising", "partial"];
const CORE: Record<FitTier, number> = { strong: 6.4, promising: 5.2, partial: 4.2 };
const BLADES = 6;
const pc = (v: number) => `${((v / SK.VB) * 100).toFixed(3)}%`;
const f1 = (n: number) => +n.toFixed(1);
const tierOf = (r: Pick<SievePosting, "fitTier">): FitTier => r.fitTier ?? "partial";
const css = (v: Record<string, string | number>) => v as unknown as CSSProperties;

type MarkState = "scatter" | "star" | "gated" | "held" | "wait";
type Target = { kind: "star" | "gate"; id: string; key: string | null; x: number; y: number };

function DecGlyph({ status }: { status: PostingStatus }) {
  if (status === "applied") return <rect className="dg-fill" x="6" y="6" width="7" height="7" rx="1" />;
  if (status === "shortlisted") return <circle className="dg-fill" cx="9.5" cy="9.5" r="3.6" />;
  if (status === "dismissed") return <path className="dg-x" d="M6.4 6.4l6.4 6.4M12.8 6.4l-6.4 6.4" />;
  if (status === "gone") return <circle className="dg-dash" cx="9.5" cy="9.5" r="4" />;
  return null;
}

export function AtlasSky({
  rows, facts, layout, rim, lock, pointed, focusId, headline, sectorLabel, ceremony, reduced,
  onPoint, onFocusMark, onOpenStar, onOpenGate, onLocked, onSkipCeremony, gateLabel, plateActions, children,
}: {
  rows: readonly SievePosting[];
  facts: SieveFacts | null;
  layout: SkyLayout | null;
  rim: RimLayout | null;
  lock: Lock;
  pointed: Pointed;
  focusId: string | null;
  headline: Headline;
  sectorLabel: (key: string) => string;
  ceremony: boolean;
  reduced: boolean;
  onPoint: (p: Pointed, src: PointSource) => void;
  onFocusMark: (id: string) => void;
  onOpenStar: (id: string, opener: HTMLElement | null) => void;
  onOpenGate: (key: KoReasonKey | "held" | "wait", opener: HTMLElement | null) => void;
  onLocked: (opener: HTMLElement | null) => void;
  onSkipCeremony: () => void;
  gateLabel: (key: KoReasonKey) => string;
  plateActions: { openStar: string; openSieve: string };
  children?: ReactNode;
}) {
  const t = useTranslations("me.atlas");
  const tTier = useTranslations("me.sieve.tier");
  const svgRef = useRef<SVGSVGElement>(null);
  const lastType = useRef<string>("mouse");
  const ready = lock.gate === "ready" && facts !== null && layout !== null && rim !== null;
  const closed = lock.gate === "no-cv";

  // The fixed ground: discs, zones, rings, spokes, sector lines, the engraved tick ring.
  const ground = useMemo(() => {
    const secs = layout?.sectors ?? [];
    const zone = (a: number, b: number, cls: string) => (
      <path key={cls} className={`g-zone ${cls}`} fillRule="evenodd" d={`M${SK.C + b} ${SK.C}A${b} ${b} 0 1 1 ${SK.C - b} ${SK.C}A${b} ${b} 0 1 1 ${SK.C + b} ${SK.C}ZM${SK.C + a} ${SK.C}A${a} ${a} 0 1 0 ${SK.C - a} ${SK.C}A${a} ${a} 0 1 0 ${SK.C + a} ${SK.C}Z`} />
    );
    const spokes: string[] = [];
    for (let d = 0; d < 360; d += 10) {
      const [x0, y0] = polar(SK.RHOLE, d);
      const [x1, y1] = polar(SK.RH * 0.9, d);
      spokes.push(`M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`);
    }
    let ticks = "";
    for (let d = 0; d < 360; d += 2.5) {
      const maj = d % 10 === 0;
      const sec = secs.some((s) => Math.abs((((s.start - d + 540) % 360) + 360) % 360 - 180) < 1.3);
      const len = sec ? 17 : maj ? 10 : 5;
      const [x0, y0] = polar(SK.RH + 4, d);
      const [x1, y1] = polar(SK.RH + 4 + len, d);
      ticks += `M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`;
    }
    return (
      <g className="sk-ground">
        <circle className="g-disc" cx={SK.C} cy={SK.C} r={SK.RH} />
        {zone(rOf(100), rOf(70), "z-strong")}
        {zone(rOf(70), rOf(55), "z-promising")}
        {zone(rOf(55), rOf(0), "z-partial")}
        {[87.5, 62.5, 37.5, 12.5].map((v) => <circle key={v} className="g-fine" cx={SK.C} cy={SK.C} r={f1(rOf(v))} />)}
        {[75, 50, 25].map((v) => <circle key={v} className="g-ring" cx={SK.C} cy={SK.C} r={f1(rOf(v))} />)}
        <path className="g-spoke" d={spokes.join("")} />
        {secs.map((s) => {
          const [x0, y0] = polar(SK.RHOLE, s.start);
          const [x1, y1] = polar(SK.RH, s.start);
          return <path key={s.key} className="g-sect" d={`M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`} />;
        })}
        <circle className="g-band" cx={SK.C} cy={SK.C} r={f1(SK.RH * 0.905)} />
        <path className="g-tick" d={ticks} />
        <circle className="g-horizon" cx={SK.C} cy={SK.C} r={SK.RH + 2} />
        <circle className="g-horizon2" cx={SK.C} cy={SK.C} r={SK.RH + 22} />
        <circle className="g-hole" cx={SK.C} cy={SK.C} r={SK.RHOLE} />
        <circle className="g-hole2" cx={SK.C} cy={SK.C} r={SK.RHOLE - 7} />
      </g>
    );
  }, [layout]);

  const engrave = useMemo(() => {
    const secs = layout?.sectors ?? [];
    return (
      <g className="sk-engrave" clipPath="url(#sk-clip)">
        {[100, 75, 50, 25, 0].map((v) => <circle key={v} className="g-eng" cx={SK.C} cy={SK.C} r={f1(rOf(v))} />)}
        {secs.map((s) => {
          const [x0, y0] = polar(SK.RHOLE, s.start);
          const [x1, y1] = polar(SK.RH, s.start);
          return <path key={s.key} className="g-eng" d={`M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`} />;
        })}
      </g>
    );
  }, [layout]);

  // Where every mark stands NOW and what it is, derived from the facts on every render.
  const placed = useMemo(() => {
    const out: { r: SievePosting; state: MarkState; p: [number, number]; order: number }[] = [];
    if (!layout) return out;
    const held = new Set((facts?.held ?? []).map((r) => r.id));
    const gated = new Set((facts?.gated ?? []).map((r) => r.id));
    const scored = new Map((facts?.scored ?? []).map((r, i) => [r.id, i]));
    // The same job listed again (one per place) is ONE star: its copies are folded into the
    // best-scored one (sieveModel twinKey), so once the dome is open they are not drawn again.
    const twins = new Set(Object.values(facts?.twins ?? {}).flat());
    for (const r of rows) {
      const mk = layout.marks[r.id];
      if (!mk) continue;
      if (ready && twins.has(r.id)) continue;
      let state: MarkState = "scatter";
      let p = mk.scatter;
      if (ready && rim) {
        if (held.has(r.id)) {
          state = "held";
          p = rim.pos[r.id] ?? p;
        } else if (scored.has(r.id) && mk.star) {
          state = "star";
          p = mk.star;
        } else if (gated.has(r.id)) {
          state = "gated";
          p = rim.pos[r.id] ?? p;
        } else {
          state = "wait";
          p = rim.pos[r.id] ?? p;
        }
      }
      out.push({ r, state, p, order: scored.get(r.id) ?? 0 });
    }
    return out;
  }, [rows, layout, facts, rim, ready]);

  const targets = useMemo<Target[]>(() => {
    if (!ready || !rim) return [];
    return placed
      .filter((m) => m.state !== "scatter")
      .map((m) => ({
        kind: m.state === "star" ? ("star" as const) : ("gate" as const),
        id: m.r.id,
        key: m.state === "star" ? null : (rim.groups.find((g) => g.rows.some((x) => x.id === m.r.id))?.key ?? null),
        x: m.p[0],
        y: m.p[1],
      }));
  }, [placed, rim, ready]);

  const hit = useCallback(
    (cx: number, cy: number, tol: number): Target | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const b = svg.getBoundingClientRect();
      const k = b.width / SK.VB;
      let best: Target | null = null;
      let bd = Infinity;
      for (const tg of targets) {
        const d = Math.hypot(b.left + tg.x * k - cx, b.top + tg.y * k - cy);
        if (d < bd) {
          bd = d;
          best = tg;
        }
      }
      return best && bd <= tol ? best : null;
    },
    [targets],
  );
  const pointOf = (tg: Target): Pointed => (tg.kind === "star" ? { kind: "star", id: tg.id } : { kind: "gate", key: tg.key ?? "wait" });
  const samePoint = (a: Pointed, b: Pointed) => !!a && !!b && a.kind === b.kind && ("id" in a ? a.id === (b as { id?: string }).id : "key" in a ? a.key === (b as { key?: string }).key : false);

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || !ready) return;
    const tg = hit(e.clientX, e.clientY, 22);
    if (tg) onPoint(pointOf(tg), "hover");
  };
  const onClick = (e: React.MouseEvent) => {
    if (!ready) return;
    const tg = hit(e.clientX, e.clientY, lastType.current === "touch" ? 26 : 20);
    if (!tg) return;
    const p = pointOf(tg);
    if (lastType.current === "touch" && !samePoint(pointed, p)) {
      onPoint(p, "tap");
      return;
    }
    const opener = (e.target as Element).closest?.("g.m") as HTMLElement | null;
    if (tg.kind === "star") onOpenStar(tg.id, opener ?? (e.currentTarget as HTMLElement));
    else onOpenGate((tg.key ?? "wait") as KoReasonKey | "held" | "wait", opener ?? (e.currentTarget as HTMLElement));
  };
  const stars = targets.filter((x) => x.kind === "star");
  const onKeyDown = (e: KeyboardEvent) => {
    if (!ready) return;
    const m = (e.target as Element).closest?.("g.m") as SVGGElement | null;
    if ((e.key === "Enter" || e.key === " ") && m) {
      e.preventDefault();
      const id = m.dataset.id!;
      const tg = targets.find((x) => x.id === id);
      if (tg?.kind === "star") onOpenStar(id, m as unknown as HTMLElement);
      else if (tg) onOpenGate((tg.key ?? "wait") as KoReasonKey | "held" | "wait", m as unknown as HTMLElement);
      return;
    }
    if (!e.key.startsWith("Arrow") || stars.length === 0) return;
    e.preventDefault();
    const cur = focusId ? stars.find((s) => s.id === focusId) : null;
    if (!cur) {
      onFocusMark(stars[0]!.id);
      return;
    }
    const v = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key as "ArrowLeft"] ?? [0, 0];
    let best: Target | null = null;
    let bs = Infinity;
    for (const s of stars) {
      if (s === cur) continue;
      const dx = s.x - cur.x;
      const dy = s.y - cur.y;
      const d = Math.hypot(dx, dy);
      const dot = (dx * v[0]! + dy * v[1]!) / (d || 1);
      if (dot < 0.35) continue;
      const sc = d * (1.6 - dot);
      if (sc < bs) {
        bs = sc;
        best = s;
      }
    }
    if (best) onFocusMark(best.id);
  };

  const a = aperture(lock);
  const nScored = Math.max(1, facts?.scored.length ?? 1);
  const pos = useMemo(() => Object.fromEntries(placed.map((m) => [m.r.id, m.p])), [placed]);

  const markLabel = (m: (typeof placed)[number]): string => {
    const r = m.r;
    const who = r.company ? `${r.title}, ${r.company}` : r.title;
    if (m.state === "star") return t("aria.star", { rank: facts?.rank[r.id] ?? 0, who, score: r.matchTotal ?? 0, tier: tTier(tierOf(r)) });
    if (m.state === "held") return t("aria.held", { who });
    if (m.state === "wait") return t("aria.wait", { who });
    return t("aria.gated", { who, gates: r.blockedBy.map((k) => gateLabel(k)).join(", ") });
  };

  const rimGroupLabel = (g: RimLayout["groups"][number]): string => {
    const n = g.kind === "gate" ? g.total : g.rows.length;
    if (g.kind === "gate") return `${gateLabel(g.key as KoReasonKey)} ${n}`;
    if (g.kind === "held") return n ? t("rim.held", { n }) : t("rim.heldNone");
    return n ? t("rim.wait", { n }) : t("rim.waitNone");
  };

  return (
    <section className="stage" id="stage" aria-label={t("frame.skyLabel")} data-role="sky-stage">
      <div className={`sky${ready ? "" : " is-locked"}${closed ? " is-closed" : ""}${ceremony ? " is-ceremony" : ""}${ceremony && reduced ? " no-anim" : ""}`} id="sky" data-gate={lock.gate} data-role="sky">
        <svg
          ref={svgRef}
          className="sky-svg"
          viewBox={`0 0 ${SK.VB} ${SK.VB}`}
          focusable="false"
          role="group"
          aria-label={t("frame.skyLabel")}
          onPointerMove={onPointerMove}
          onPointerDown={(e) => (lastType.current = e.pointerType)}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse" && pointed) onPoint(null, "hover");
          }}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            if (!ready) return;
            const m = (e.target as Element).closest?.("g.m") as SVGGElement | null;
            if (!m) return;
            const tg = targets.find((x) => x.id === m.dataset.id);
            if (tg) onPoint(pointOf(tg), "focus");
          }}
          onBlur={(e) => {
            const next = e.relatedTarget as Element | null;
            if (pointed && !(next && (e.currentTarget.contains(next) || next.closest?.("[data-role=top5-card]")))) onPoint(null, "focus");
          }}
        >
          <defs>
            {TIERS.map((tier) => (
              <radialGradient key={tier} id={`sk-h-${tier}`}>
                <stop offset="0" style={{ stopColor: `var(--c-${tier})`, stopOpacity: 0.6 }} />
                <stop offset=".55" style={{ stopColor: `var(--c-${tier})`, stopOpacity: 0.18 }} />
                <stop offset="1" style={{ stopColor: `var(--c-${tier})`, stopOpacity: 0 }} />
              </radialGradient>
            ))}
            <clipPath id="sk-clip">
              <circle cx={SK.C} cy={SK.C} r={SK.RH} />
            </clipPath>
            <radialGradient id="sk-disc" cx=".5" cy=".5" r=".5">
              <stop offset="0" className="sd0" />
              <stop offset="1" className="sd1" />
            </radialGradient>
            <linearGradient id="sk-leaf" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={SK.RH} y2="0">
              <stop offset="0" className="sl0" />
              <stop offset="1" className="sl1" />
            </linearGradient>
          </defs>
          {ground}
          <g className="sk-rim">
            {ready && rim ? (
              <>
                <circle className="rim-guide" cx={SK.C} cy={SK.C} r={SK.RIM} />
                {rim.groups.map((g) => (
                  <path key={g.key} className={`rim-arc k-${g.kind}${g.rows.length ? "" : " is-empty"}`} d={arcPath(SK.RIM, g.start, g.end)} />
                ))}
              </>
            ) : null}
          </g>
          <g className="sk-marks">
            {placed.map((m) => {
              const { r, state, p } = m;
              const tier = tierOf(r);
              const bw = bandWidth(r);
              const hr = r.matchTotal !== null ? 9 + bw * 0.55 : 10;
              const br = r.matchTotal !== null ? 0.4 + 0.6 * clamp((r.matchTotal - 20) / 60, 0, 1) : 0.5;
              const pointedHere = pointed?.kind === "star" ? pointed.id === r.id : false;
              const hot = pointed?.kind === "gate" && rim ? rim.groups.find((g) => g.key === pointed.key)?.rows.some((x) => x.id === r.id) : false;
              const isStar = state === "star";
              const dl = ceremony && !reduced ? (isStar ? 520 + m.order * (1300 / nScored) : 700 + (r.id.charCodeAt(r.id.length - 1) % 9) * 100) : 0;
              const multi = state === "gated" && r.blockedBy.length > 1;
              const cls = `m t-${tier} is-${isStar ? "star" : state === "scatter" ? "scatter" : "rim"} st-${state}${multi ? " is-multi" : ""}${pointedHere ? " is-pointed" : ""}${hot ? " is-hot" : ""}`;
              return (
                <g
                  key={r.id}
                  className={cls}
                  data-id={r.id}
                  data-state={ready ? state : undefined}
                  style={css({ transform: `translate(${f1(p[0])}px,${f1(p[1])}px)`, "--br": br.toFixed(2), "--dl": `${dl}ms` })}
                  tabIndex={ready && ((isStar && focusId === r.id) || (!focusId && !isStar && false)) ? 0 : -1}
                  role={ready ? "button" : undefined}
                  aria-label={ready ? markLabel(m) : undefined}
                  aria-hidden={ready ? undefined : true}
                >
                  <circle className="m-hit" r="13" />
                  <circle className="m-halo" r={f1(hr)} fill={`url(#sk-h-${tier})`} />
                  <circle className="m-hring" r={f1(hr * 0.78)} />
                  {tier === "strong" ? <path className="m-ray" d="M0 -12V-8M0 8V12M-12 0H-8M8 0H12" /> : null}
                  <circle className="m-core" r={CORE[tier]} />
                  <circle className="m-ring2" r="10" />
                  <circle className="m-ring" r="6" />
                  <g className="m-dec">{ready && r.status !== "new" ? <DecGlyph status={r.status} /> : null}</g>
                </g>
              );
            })}
          </g>
          <g className="sk-ptr">
            {ready && pointed?.kind === "star" && pos[pointed.id] ? (() => {
              const [x, y] = pos[pointed.id]!;
              const ang = Math.atan2(y - SK.C, x - SK.C);
              const hx = SK.C + (SK.RHOLE + 1) * Math.cos(ang);
              const hy = SK.C + (SK.RHOLE + 1) * Math.sin(ang);
              return (
                <>
                  <path className="ptr-line" d={`M${f1(x)} ${f1(y)}L${f1(hx)} ${f1(hy)}`} />
                  <circle className="ptr-dot" cx={f1(hx)} cy={f1(hy)} r="4" />
                  <circle className="ptr-ring" cx={f1(x)} cy={f1(y)} r="17" />
                  <path className="ptr-cross" d={`M${f1(x - 26)} ${f1(y)}H${f1(x - 19)}M${f1(x + 19)} ${f1(y)}H${f1(x + 26)}M${f1(x)} ${f1(y - 26)}V${f1(y - 19)}M${f1(x)} ${f1(y + 19)}V${f1(y + 26)}`} />
                </>
              );
            })() : null}
            {ready && rim && pointed?.kind === "gate" ? (() => {
              const g = rim.groups.find((x) => x.key === pointed.key);
              return g ? <path className="ptr-arc" d={arcPath(SK.RIM + 15, g.start, g.end)} /> : null;
            })() : null}
          </g>
          <g className="sk-iris" clipPath="url(#sk-clip)">
            <g transform={`translate(${SK.C} ${SK.C})`}>
              {Array.from({ length: BLADES }, (_, i) => {
                const th = -90 + i * (360 / BLADES);
                return (
                  <g key={i} className={`blade${ready ? " is-gone" : ""}`} style={{ transform: `rotate(${th}deg) translate(${f1(a)}px,0px)` }}>
                    <path className="blade-leaf" d={`M0 -${SK.RH}A${SK.RH} ${SK.RH} 0 0 1 0 ${SK.RH}Z`} />
                    <path className="blade-rib" d={`M13 -${SK.RH - 5}V${SK.RH - 5}`} />
                    <path className="blade-edge" d={`M0 -${SK.RH}V${SK.RH}`} />
                  </g>
                );
              })}
            </g>
          </g>
          {engrave}
          <circle className={`sk-irisrim${ready ? " is-open" : ""}`} cx={SK.C} cy={SK.C} r={SK.RH} />
        </svg>
        <div className="sky-ov" id="sky-ov">
          {(layout?.sectors ?? []).map((s) => {
            const [x, y] = polar(SK.NAME, s.mid);
            const scored = (facts?.scored ?? []).filter((r) => r.sourceId === s.key).length;
            const style = css({ left: pc(x), top: pc(y), "--rot": `${rotFor(s.mid).toFixed(1)}deg` });
            const name = sectorLabel(s.key);
            return ready ? (
              <button key={s.key} type="button" className={AT_SECTOR} style={style} data-role="sector-label"
                aria-label={t("aria.sector", { name, n: s.count, scored })}
                onClick={() => onPoint({ kind: "sector", key: s.key }, "tap")}
                onFocus={() => onPoint({ kind: "sector", key: s.key }, "focus")}
                onMouseEnter={() => onPoint({ kind: "sector", key: s.key }, "hover")}
              >
                <span className="sec-t">{name}</span>
              </button>
            ) : (
              <span key={s.key} className="sec-lbl is-static" style={style}>
                <span className="sec-t">{name}</span>
              </span>
            );
          })}
          {[75, 50, 25].map((v) => {
            const [x, y] = polar(rOf(v), 273.5);
            return <span key={v} className="sc-lbl" style={{ left: pc(x), top: pc(y) }}>{v}</span>;
          })}
          {ready && rim
            ? rim.groups.map((g) => {
                const [x, y] = polar(SK.LBL, g.mid);
                const n = g.kind === "gate" ? g.total : g.rows.length;
                return (
                  <button key={g.key} type="button" className={`${AT_ARC} k-${g.kind}${n ? "" : " is-empty"}`} data-role="rim-label"
                    style={css({ left: pc(x), top: pc(y), "--rot": `${rotFor(g.mid).toFixed(1)}deg` })}
                    aria-label={t(g.kind === "gate" ? "aria.rimGate" : g.kind === "held" ? "aria.rimHeld" : "aria.rimWait", { name: g.kind === "gate" ? gateLabel(g.key as KoReasonKey) : "", n })}
                    onClick={(e) => onOpenGate(g.key, e.currentTarget)}
                    onFocus={() => onPoint({ kind: "gate", key: g.key }, "focus")}
                    onMouseEnter={() => onPoint({ kind: "gate", key: g.key }, "hover")}
                  >
                    {rimGroupLabel(g)}
                  </button>
                );
              })
            : null}
          {ready && facts
            ? facts.top5.map((r, i) => {
                const p = pos[r.id];
                return p ? <span key={r.id} className="n5" style={{ left: pc(p[0] + 19), top: pc(p[1] - 19) }} aria-hidden="true">{i + 1}</span> : null;
              })
            : null}
          <div className="plate" id="plate" aria-live="off" data-role="plate">
            <Plate {...{ ready, pointed, facts, rim, headline, lock, sectorLabel, gateLabel, onLocked, onOpenStar, onOpenGate, plateActions }} />
          </div>
        </div>
      </div>
      <div className="m-headline" data-role="m-headline">
        <Plate {...{ ready, pointed, facts, rim, headline, lock, sectorLabel, gateLabel, onLocked, onOpenStar, onOpenGate, plateActions }} mobile />
        {ready && rim ? (
          <div className="rim-chips" role="group" aria-label={t("rim.chipsLabel")}>
            <span className="rc-l">{t("rim.chipsIntro")}</span>
            {rim.groups.map((g) => {
              const n = g.kind === "gate" ? g.total : g.rows.length;
              return (
                <button key={g.key} type="button" className={`${AT_CHIP} k-${g.kind}${n ? "" : " is-empty"}`} onClick={(e) => onOpenGate(g.key, e.currentTarget)}>
                  {g.kind === "gate" ? gateLabel(g.key as KoReasonKey) : g.kind === "held" ? t("rim.heldShort") : t("rim.waitShort")} <b className="nums">{n || t("rim.none")}</b>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {children}
      {ceremony ? <Button className="skip-cer" variant="secondary" size="sm" label={t("ceremony.skip")} onClick={onSkipCeremony} /> : null}
    </section>
  );
}

function Plate({
  ready, pointed, facts, rim, headline, lock, sectorLabel, gateLabel, onLocked, onOpenStar, onOpenGate, plateActions, mobile = false,
}: {
  /** The phone's text block under the sky: the same words as the plate, with no button around a headline. */
  mobile?: boolean;
  ready: boolean;
  pointed: Pointed;
  facts: SieveFacts | null;
  rim: RimLayout | null;
  headline: Headline;
  lock: Lock;
  sectorLabel: (key: string) => string;
  gateLabel: (key: KoReasonKey) => string;
  onLocked: (opener: HTMLElement | null) => void;
  onOpenStar: (id: string, opener: HTMLElement | null) => void;
  onOpenGate: (key: KoReasonKey | "held" | "wait", opener: HTMLElement | null) => void;
  plateActions: { openStar: string; openSieve: string };
}) {
  const t = useTranslations("me.atlas");
  const tTier = useTranslations("me.sieve.tier");
  const tStatus = useTranslations("me.sieve.status");
  const row = ready && pointed?.kind === "star" ? facts?.all.find((r) => r.id === pointed.id) ?? null : null;
  if (row && facts) {
    const tier = tierOf(row);
    const len = row.title.length;
    const rank = facts.rank[row.id];
    const pos = facts.top5.findIndex((x) => x.id === row.id) + 1;
    return (
      <div className="plate-in" key={row.id}>
        <p className={`pl-eyebrow t-${tier}`}>
          <TierGlyph tier={tier} />
          <span>{pos ? `${pos}. ` : rank ? `${t("plate.rank", { n: rank })} · ` : ""}{tTier(tier)}{row.status !== "new" ? ` · ${tStatus(row.status)}` : ""}</span>
        </p>
        <h2 className={`pl-name ${len <= 24 ? "n-l" : len <= 42 ? "n-m" : "n-s"}`}>{row.title}</h2>
        {row.company ? <p className="pl-co">{row.company}</p> : null}
        <p className="pl-score">
          <b className="nums">{row.matchTotal}</b>{" "}
          <span>{row.confidence ? t("plate.band", { low: row.confidence.low, high: row.confidence.high }) : t("plate.noBand")}</span>
        </p>
        <Button size="sm" variant="primary" className="pl-open" label={plateActions.openStar} onClick={(e) => onOpenStar(row.id, e.currentTarget)} />
        <p className="pl-mini" aria-hidden="true">{row.matchTotal}</p>
      </div>
    );
  }
  if (ready && rim && pointed?.kind === "gate") {
    const g = rim.groups.find((x) => x.key === pointed.key);
    if (g) {
      const n = g.kind === "gate" ? g.total : g.rows.length;
      const name = g.kind === "gate" ? gateLabel(g.key as KoReasonKey) : g.kind === "held" ? t("plate.heldName") : t("plate.waitName");
      const why = g.kind === "gate" ? t("plate.gateWhy") : g.kind === "held" ? t("plate.heldWhy") : t("plate.waitWhy");
      return (
        <div className="plate-in" key={`g-${g.key}`}>
          <p className="pl-eyebrow"><span>{t("plate.rimEyebrow")}</span></p>
          <h2 className="pl-name n-m">{name}</h2>
          <p className="pl-co">{t("plate.rimCount", { n })} {why}</p>
          <Button size="sm" variant="primary" className="pl-open" label={plateActions.openSieve} onClick={(e) => onOpenGate(g.key, e.currentTarget)} />
          <p className="pl-mini" aria-hidden="true">{n}</p>
        </div>
      );
    }
  }
  if (ready && facts && pointed?.kind === "sector") {
    const rows = facts.all.filter((r) => r.sourceId === pointed.key);
    const sc = facts.scored.filter((r) => r.sourceId === pointed.key);
    const best = sc[0];
    return (
      <div className="plate-in" key={`s-${pointed.key}`}>
        <p className="pl-eyebrow"><span>{t("plate.sectorEyebrow")}</span></p>
        <h2 className="pl-name n-m">{sectorLabel(pointed.key)}</h2>
        <p className="pl-co">{t("plate.sectorCount", { n: rows.length, scored: sc.length })}</p>
        {best ? <p className="pl-score"><b className="nums">{best.matchTotal}</b> <span>{t("plate.bestHere")}</span></p> : null}
        <p className="pl-mini" aria-hidden="true">{rows.length}</p>
      </div>
    );
  }
  const hz = headline.hero.length >= 9 ? " h-s" : headline.hero.length >= 8 ? " h-m" : "";
  const inner = (
    <>
      <p className={`pl-hero${hz}${ready ? " is-ready" : ""}`}>{headline.hero}</p>
      <p className="pl-text">{headline.text}</p>
      {headline.sub ? <p className="pl-sub">{headline.sub}</p> : null}
    </>
  );
  if (!ready && mobile) return <div className="plate-in" key="lock-m">{inner}</div>;
  if (!ready) {
    return (
      <div className="plate-in" key="lock">
        <button className={AT_PLATE} type="button" data-role="plate-locked" aria-label={t("aria.plateLocked", { state: lock.gate === "no-cv" ? t("aria.shut") : t("aria.halfOpen"), text: headline.sub || headline.text })} onClick={(e) => onLocked(e.currentTarget)}>
          {inner}
        </button>
      </div>
    );
  }
  return <div className="plate-in" key="head">{inner}</div>;
}
