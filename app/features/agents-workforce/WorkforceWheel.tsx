"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";
import { ConditionMark, NamePlate } from "@/app/_components/kit/scene";
import { NeedsMark } from "./WorkforceBits";
import type { AgentRosterEntry, NextActionKind } from "./agentsWorkforceLogic";
import { R, VB, arcPath, f1, halfArc, hitTest, pt, stageLayout, type StageLayout } from "./wheelGeometry";
import {
  PHASES, STATUS_CONDITION, nameOf, needsYou, phaseCounts, phaseOf, spendOf,
  type BridgeView, type Moves, type Phase, type Wheel, type WheelCard, type WheelDrawer,
} from "./workforceModel";
import type { Speak } from "./WorkforceBits";

export type WheelFilter = { need: NextActionKind | null; phase: Phase | null };

const LEGEND: readonly Phase[] = ["working", "probation", "waiting", "stuck", "cutoff", "out"];
const PLATE_CLS = "plate";
const LG_CLS = "lg";

function predicate(filter: WheelFilter, moves: Moves): ((a: AgentRosterEntry) => boolean) | null {
  if (filter.need) return (a) => (moves.get(a.id)?.kind ?? "none") === filter.need;
  if (filter.phase) return (a) => phaseOf(a, moves.get(a.id) ?? { kind: "none" }) === filter.phase;
  return null;
}

export function cardSvg(c: WheelCard, moves: Moves, dead: boolean, dim: boolean) {
  const a = c.agent;
  const move = moves.get(a.id) ?? { kind: "none" as const };
  const ph = phaseOf(a, move);
  const needs = needsYou(move);
  const arcW = (2 * Math.PI * R.cardIn * c.pitch) / 360;
  const w = Math.max(1.2, Math.min(arcW * 0.74, 20));
  const sw = Math.max(1.2, Math.min(w * 0.62, 11));
  const inner = dead && ph === "cutoff" ? R.cardCut : R.cardIn;
  const sp = spendOf(a);
  let spend;
  if (sp.unmeasured) {
    spend = <line className="sp-none" x1={0} y1={-R.spendIn} x2={0} y2={-(R.spendIn + 26)} />;
  } else {
    const frac = sp.frac ?? 0;
    const len = Math.max(3, Math.min(frac, (R.spendMax - R.spendIn) / (R.budget - R.spendIn)) * (R.budget - R.spendIn));
    spend = <rect className={`sp sp--${sp.tone}`} x={f1(-sw / 2)} y={f1(-(R.spendIn + len))} width={f1(sw)} height={f1(len)} rx={f1(Math.min(2, sw / 2))} />;
  }
  const am = a.appMaster ? <rect className="am-cap" x={f1(-Math.max(w, 6) / 2 - 1)} y={f1(-R.cardOut - 8)} width={f1(Math.max(w, 6) + 2)} height={8} rx={1} /> : null;
  const nd = needs && c.pitch >= 2.6 ? <path className="nd" d={`M0 ${f1(-R.needs - 9)} L9 ${-R.needs} L0 ${f1(-R.needs + 9)} L-9 ${-R.needs}Z`} /> : null;
  return (
    <g key={a.id} className={`cd cd--${ph}${needs ? " is-needs" : ""}${dim ? " is-dim" : ""}`} transform={`rotate(${f1(c.theta)})`} data-id={a.id}>
      <g className="cd__in" style={{ ["--i" as string]: Math.round((c.theta / 360) * 420) }}>
        <rect className="st" x={f1(-w / 2)} y={-R.cardOut} width={f1(w)} height={R.cardOut - inner} rx={f1(Math.min(3, w / 3))} />
        {am}
        {spend}
        {nd}
      </g>
    </g>
  );
}

/** Where cards stand too close for a diamond each, the run of cards that need you wears one coral arc per kind. */
export function needArcs(wheel: Wheel, moves: Moves, pred: ((a: AgentRosterEntry) => boolean) | null) {
  const out: React.ReactElement[] = [];
  for (const d of wheel.drawers) {
    if (d.pitch >= 2.6) continue;
    const runs: { kind: string; t0: number; t1: number; a: AgentRosterEntry }[] = [];
    let cur: (typeof runs)[number] | null = null;
    for (const c of wheel.cards) {
      if (c.drawer.key !== d.key) continue;
      const k = (moves.get(c.agent.id) ?? { kind: "none" }).kind;
      if (k === "none") {
        cur = null;
        continue;
      }
      if (cur && cur.kind === k) cur.t1 = c.theta;
      else {
        cur = { kind: k, t0: c.theta, t1: c.theta, a: c.agent };
        runs.push(cur);
      }
    }
    runs.forEach((r, i) => {
      let a0 = r.t0 - d.pitch * 0.45;
      let a1 = r.t1 + d.pitch * 0.45;
      if (a1 - a0 < 1.2) {
        const m = (a0 + a1) / 2;
        a0 = m - 0.6;
        a1 = m + 0.6;
      }
      const p0 = pt(R.needs, a0);
      const p1 = pt(R.needs, a1);
      out.push(<path key={`${d.key}-${i}`} className={`nd-arc${pred && !pred(r.a) ? " is-dim" : ""}`} d={`M${f1(p0[0])} ${f1(p0[1])}A${R.needs} ${R.needs} 0 0 1 ${f1(p1[0])} ${f1(p1[1])}`} />);
    });
  }
  return out;
}

function Clock({ bridge }: { bridge: BridgeView }) {
  if (bridge.state === "never") {
    return (
      <g className="wclock is-never">
        <circle className="wc-mount" r={R.clock} />
        {[[-70, -70], [70, -70], [-70, 70], [70, 70]].map(([x, y]) => <circle key={`${x}${y}`} className="wc-screw" cx={x} cy={y} r={7} />)}
      </g>
    );
  }
  const d = bridge.lastOkAt ? new Date(bridge.lastOkAt) : new Date(0);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const major = i % 3 === 0;
    const p0 = pt(major ? 86 : 94, i * 30);
    const p1 = pt(104, i * 30);
    return <line key={i} className={`wc-tick${major ? " is-major" : ""}`} x1={f1(p0[0])} y1={f1(p0[1])} x2={f1(p1[0])} y2={f1(p1[1])} />;
  });
  const hp = pt(54, ((h % 12) + m / 60) * 30);
  const mp = pt(80, m * 6);
  const dead = bridge.state === "down";
  return (
    <g className={`wclock${dead ? " is-stopped" : ""}`}>
      <circle className="wc-face" r={R.clock} />
      {ticks}
      {dead ? <path className="wc-crack" d="M-62 -78 L-34 -46 L-46 -28 L-8 -6 L-18 16 L22 40 L12 60 L44 88" /> : null}
      <line className="wc-hand wc-hand--h" x1={0} y1={0} x2={f1(hp[0])} y2={f1(hp[1])} />
      <line className="wc-hand wc-hand--m" x1={0} y1={0} x2={f1(mp[0])} y2={f1(mp[1])} />
      <circle className="wc-pin" r={9} />
    </g>
  );
}

function Tether({ bridge }: { bridge: BridgeView }) {
  if (bridge.state === "never") return <circle className="tether is-never" r={R.tether} />;
  if (bridge.state === "down") {
    return (
      <>
        <circle className="tether is-cut" r={R.tether} />
        {Array.from({ length: 8 }, (_, i) => {
          const c = pt(R.tether, i * 45 + 22.5);
          return <path key={i} className="tether-cut" d={`M${f1(c[0] - 7)} ${f1(c[1] - 7)}l14 14m0 -14l-14 14`} />;
        })}
      </>
    );
  }
  return <circle className="tether" r={R.tether} />;
}

/**
 * Level 0's stage, "the Clock Wheel": the Personas bridge is the time clock at the centre; every hire is a time card
 * standing on its drawer's sector of the rim. A card's block is its state, the bar beyond it is this month's spend against
 * ITS OWN budget (the dashed ring is 100%, provider-reported), a coral diamond on the outer ring means it needs you. The
 * wheel's size never grows with the roster: the drawers keep their places, only how closely the cards stand changes.
 * Every hover reveal is also on focus (a plate) and in the line under the wheel, and every card is also in its drawer.
 */
export function WorkforceWheel({ wheel, agents, moves, bridge, filter, onPhase, onOpenDrawer, onOpenCard, speak, lastOkAgo }: {
  wheel: Wheel;
  agents: readonly AgentRosterEntry[];
  moves: Moves;
  bridge: BridgeView;
  filter: WheelFilter;
  onPhase: (p: Phase | null) => void;
  onOpenDrawer: (key: WheelDrawer["key"], el: HTMLElement | null) => void;
  onOpenCard: (id: string, el: HTMLElement | null) => void;
  speak: Speak;
  lastOkAgo: string | null;
}) {
  const t = useTranslations("agentsWorkforce");
  const { fmt, words } = speak;
  const wheelRef = useRef<HTMLDivElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLParagraphElement>(null);
  const plateRefs = useRef(new Map<string, HTMLButtonElement>());
  const [layout, setLayout] = useState<StageLayout | null>(null);
  const [width, setWidth] = useState(0);
  const [hot, setHot] = useState<string | null>(null);
  const [reading, setReading] = useState<{ kind: "card"; id: string } | { kind: "drawer"; key: string; cards: boolean } | null>(null);
  const dead = bridge.state === "down";
  const empty = agents.length === 0;
  const pred = useMemo(() => predicate(filter, moves), [filter, moves]);
  const phases = useMemo(() => phaseCounts(agents, moves), [agents, moves]);

  // Measure the stage's width and the plates' heights, then place everything (one pure function).
  const place = useCallback(() => {
    const wheelEl = wheelRef.current;
    const dial = dialRef.current;
    if (!wheelEl || !dial) return;
    const W = wheelEl.clientWidth;
    setWidth(W);
    const top = dial.getBoundingClientRect().top;
    const plates = wheel.drawers.map((d) => ({ key: d.key as string, mid: d.mid, height: plateRefs.current.get(d.key)?.offsetHeight ?? 64 }));
    setLayout(stageLayout({ width: W, heightBudget: window.innerHeight - top - 56, plates, headHeight: headRef.current?.offsetHeight ?? 0 }));
  }, [wheel]);
  useLayoutEffect(() => {
    place();
    const el = wheelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
  }, [place, filter, agents.length]);

  const onMove = (ev: ReactPointerEvent<HTMLDivElement>) => {
    const svg = dialRef.current?.querySelector(".wheel__svg");
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const h = hitTest({ left: r.left, top: r.top, width: r.width, height: r.height }, { x: ev.clientX, y: ev.clientY }, wheel.drawers, wheel.cards.map((c) => ({ id: c.agent.id, drawerKey: c.drawer.key, theta: c.theta, pitch: c.pitch })));
    if (!h) {
      setHot(null);
      setReading(null);
      return;
    }
    setHot(h.drawerKey);
    setReading(h.cardId ? { kind: "card", id: h.cardId } : { kind: "drawer", key: h.drawerKey, cards: false });
  };
  const onClickDial = (ev: React.MouseEvent<HTMLDivElement>) => {
    if ((ev.target as Element).closest(`.${PLATE_CLS}`)) return;
    const svg = dialRef.current?.querySelector(".wheel__svg");
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const h = hitTest({ left: r.left, top: r.top, width: r.width, height: r.height }, { x: ev.clientX, y: ev.clientY }, wheel.drawers, wheel.cards.map((c) => ({ id: c.agent.id, drawerKey: c.drawer.key, theta: c.theta, pitch: c.pitch })));
    if (!h) return;
    if (h.cardId) onOpenCard(h.cardId, dialRef.current);
    else onOpenDrawer(h.drawerKey as WheelDrawer["key"], dialRef.current);
  };

  const readLine = () => {
    if (empty) return <span className="quiet">{t("wk.reading.empty")}</span>;
    if (!reading) return <span className="quiet">{layout?.wide ? t("wk.reading.defaultWide") : t("wk.reading.defaultNarrow")}</span>;
    if (reading.kind === "card") {
      const a = agents.find((x) => x.id === reading.id);
      if (!a) return null;
      const sp = spendOf(a);
      const move = moves.get(a.id) ?? { kind: "none" as const };
      return (
        <>
          <b>{nameOf(a)}</b>
          <span>{a.jobTitle}</span>
          <ConditionMark condition={STATUS_CONDITION[a.status]} label={words.status(a.status)} />
          <span>{sp.unmeasured ? t("wk.reading.uncosted", { budget: sp.budget != null ? fmt.usd(sp.budget) : "—" }) : t("wk.reading.spend", { spend: sp.budget != null ? t("spendOfBudget", { spent: fmt.usd(sp.month), budget: fmt.usd(sp.budget) }) : fmt.usd(sp.month) })}</span>
          {needsYou(move) ? <span className="reading__move"><NeedsMark />{words.moveLine(move)}</span> : null}
          <span className="quiet">{t("wk.reading.clickCard")}</span>
        </>
      );
    }
    const d = wheel.drawers.find((x) => x.key === reading.key);
    if (!d) return null;
    if (reading.cards) {
      const by = PHASES.filter((p) => d.byPhase[p]).map((p) => `${d.byPhase[p]} ${words.phasePlural(p)}`);
      return (
        <>
          <b>{words.drawerName(d)}</b>
          <span>{by.join(", ")}</span>
          <span>{d.unmeasured ? t("wk.reading.someUncosted", { count: d.unmeasured }) : t("wk.reading.allCosted")}</span>
          <span className="quiet">{t("wk.reading.enterOpens")}</span>
        </>
      );
    }
    return (
      <>
        <b>{words.drawerName(d)}</b>
        <span>{t("wk.reading.tooClose", { count: d.count })}</span>
      </>
    );
  };

  const dial = (
    <svg className="wheel__svg" viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} role="img" aria-labelledby="wk-wheel-title wk-wheel-desc"
      style={layout ? { width: layout.svgW, height: layout.svgH, position: empty ? "absolute" : undefined, left: empty ? layout.svgLeft : undefined, ["--u" as string]: (1 / layout.scale).toFixed(3) } : undefined}>
      <title id="wk-wheel-title">{empty ? t("wk.wheel.titleEmpty") : t("wk.wheel.title", { hires: agents.length, drawers: wheel.drawers.length })}</title>
      <desc id="wk-wheel-desc">
        {empty
          ? bridge.state === "paired" ? t("wk.wheel.descIdle") : t("wk.wheel.descNever")
          : wheel.drawers.map((d) => t("wk.wheel.descDrawer", { name: words.drawerName(d), count: d.count, need: d.need })).join("; ")}
      </desc>
      {wheel.drawers.length === 0 ? (
        <>
          <path className="track-empty" d={arcPath(R.cardIn, R.outer, 5, 175)} />
          <path className="ring-empty" d={halfArc(R.budget)} />
          <text className="ring-tag" x={-16} y={-R.budget} textAnchor="end" dominantBaseline="middle">{t("wk.ring.budgetLine")}</text>
        </>
      ) : (
        <>
          {wheel.drawers.map((d, i) => (
            <path key={d.key} className={`sec${i % 2 ? " is-alt" : ""}${d.kind === "appmaster" ? " is-am" : ""}${hot === d.key ? " is-on is-hot" : ""}`} data-fam={d.key} d={arcPath(R.cardIn - 4, R.outer, d.a0, d.a1)} />
          ))}
          <path className="budget-ring" d={halfArc(R.budget)} />
          <text className="ring-tag is-needs" x={-30} y={-R.needs} textAnchor="end" dominantBaseline="middle">{t("wk.ring.needs")}</text>
          <path className="nd ring-nd" d={`M-14 ${-R.needs - 9} l9 9 -9 9 -9 -9Z`} />
          <text className="ring-tag" x={-16} y={-R.budget} textAnchor="end" dominantBaseline="middle">{t("wk.ring.budget")}</text>
          <line className="ring-tick" x1={-10} y1={-R.budget} x2={0} y2={-R.budget} />
          <text className="ring-tag" x={-16} y={(R.spendIn + R.budget) / 2} textAnchor="end" dominantBaseline="middle">{t("wk.ring.spend")}</text>
          <line className="ring-tick" x1={-10} y1={(R.spendIn + R.budget) / 2} x2={0} y2={(R.spendIn + R.budget) / 2} />
          <text className="ring-tag" x={-16} y={(R.cardIn + R.cardOut) / 2 + 40} textAnchor="end" dominantBaseline="middle">{t("wk.ring.state")}</text>
          <line className="ring-tick" x1={-10} y1={(R.cardIn + R.cardOut) / 2 + 40} x2={0} y2={(R.cardIn + R.cardOut) / 2 + 40} />
          <g className="cards">
            {wheel.cards.map((c) => cardSvg(c, moves, dead, !!pred && !pred(c.agent)))}
            {needArcs(wheel, moves, pred)}
          </g>
        </>
      )}
      <Tether bridge={bridge} />
      <Clock bridge={bridge} />
    </svg>
  );

  return (
    <div ref={wheelRef} className={`wheel${empty ? " is-empty" : ""}${dead ? " is-dead" : ""}${layout?.wide ? " is-wide" : ""}`} id="wk-wheel">
      <div ref={dialRef} className="wheel__dial k-lit" style={layout ? { height: layout.stageH } : undefined} onPointerMove={onMove} onPointerLeave={() => { setHot(null); setReading(null); }} onClick={onClickDial}>
        {dial}
        {layout?.wide ? (
          <svg className="k-wires wheel__wires" aria-hidden="true" viewBox={`0 0 ${width} ${layout.stageH}`}>
            {layout.plates.map((p) => (
              <g key={p.key} className={`k-wire${hot === p.key ? " is-on is-hot" : ""}`} data-fam={p.key}>
                <path d={`M${p.wire.ex} ${f1(p.wire.ey)} L${p.wire.ex - 8} ${f1(p.wire.ey)} L${f1(p.wire.ax)} ${f1(p.wire.ay)}`} />
                <circle cx={f1(p.wire.ax)} cy={f1(p.wire.ay)} r={3.5} />
              </g>
            ))}
          </svg>
        ) : null}
        {empty ? <p className="wheel__empty" style={layout ? { left: Math.round(layout.svgLeft + (-VB.x + 275) * layout.scale), top: Math.round(layout.svgH / 2), width: Math.round(Math.min(220, 230 * layout.scale)) } : undefined}>{bridge.state === "paired" ? t("wk.wheel.emptyPaired") : t("wk.wheel.emptyUnpaired")}</p> : null}
        {wheel.drawers.length ? (
          <p ref={headRef} className="plates-head" id="wk-plates-head" style={layout?.wide && layout.head ? { left: layout.head.x, top: layout.head.y, width: layout.plateW } : undefined}>
            <b>{t("wk.plates.head")}</b> · {t("wk.plates.providerReported")}
          </p>
        ) : null}
        {wheel.drawers.map((d, i) => {
          const place = layout?.plates.find((p) => p.key === d.key);
          const sel = pred ? d.agents.filter(pred).length : null;
          const noun = d.kind === "appmaster" ? t("wk.plates.appMasters", { count: d.count }) : t("wk.plates.hires", { count: d.count });
          const spend = d.budget ? t("spendOfBudget", { spent: fmt.whole(d.month), budget: fmt.whole(d.budget) }) : d.month ? t("wk.plates.noLiveBudgetSpent", { spent: fmt.whole(d.month) }) : t("wk.plates.noLiveBudget");
          const cls = `${PLATE_CLS}${d.kind === "appmaster" ? " plate--am" : ""}${d.need ? " has-need" : ""}${pred && !sel ? " is-dim" : ""}${hot === d.key ? " is-on" : ""}`;
          return (
            <button
              key={d.key}
              type="button"
              ref={(el) => { if (el) plateRefs.current.set(d.key, el); else plateRefs.current.delete(d.key); }}
              className={cls}
              data-wk-nav=""
              data-fam={d.key}
              data-index={i}
              style={{ ["--tilt" as string]: `${i % 2 ? 0.7 : -0.8}deg`, ...(place ? { left: place.x, top: place.y, width: layout?.plateW } : {}) }}
              onClick={(e) => onOpenDrawer(d.key, e.currentTarget)}
              onPointerEnter={() => { setHot(d.key); setReading({ kind: "drawer", key: d.key, cards: true }); }}
              onFocus={() => { setHot(d.key); setReading({ kind: "drawer", key: d.key, cards: true }); }}
              onPointerLeave={() => { setHot(null); setReading(null); }}
              onBlur={() => { setHot(null); setReading(null); }}
            >
              <span className="plate__name">
                <span className="plate__no" aria-hidden="true">{i + 1}</span>
                {d.kind === "appmaster" ? <NeedsMark tone="machine" /> : null}
                <span>{words.drawerName(d)}</span>
                <span className="plate__n">{d.count}<span className="sr-only"> {noun}</span></span>
              </span>
              <span className="plate__fact">
                {pred ? <b className="plate__sel">{t("wk.plates.shown", { count: sel ?? 0 })} · </b> : null}
                {d.need ? <span className="plate__need"><NeedsMark />{t("wk.plates.needs", { count: d.need })}</span> : <span className="plate__calm">{t("wk.plates.noneNeed")}</span>}
                {" · "}
                <span className="plate__spend">{spend}</span>
              </span>
              <span className="sr-only">. {t("wk.plates.opens")}</span>
            </button>
          );
        })}
        <span className="wheel__nums" aria-hidden="true">
          {!layout?.wide && layout ? wheel.drawers.map((d, i) => {
            const cx = layout.svgLeft + -VB.x * layout.scale;
            const p = pt(R.outer + 14, d.mid);
            return <i key={d.key} data-fam={d.key} style={{ left: Math.round(cx + p[0] * layout.scale), top: Math.round((-VB.y + p[1]) * layout.scale) }}>{i + 1}</i>;
          }) : null}
        </span>
      </div>
      <div className="wheel__under">
        <NamePlate
          align="centre"
          title={t("wk.bridge.title")}
          condition={bridge.condition}
          chip={bridge.state === "paired" ? t("wk.bridge.paired") : bridge.state === "down" ? t("wk.bridge.downClock") : bridge.state === "never" ? t("wk.bridge.notPaired") : t("wk.bridge.unknown")}
          alert={dead}
          fact={
            bridge.state === "paired" ? t("wk.bridge.handsPaired", { when: bridge.lastOkAt ? fmt.dateTime(bridge.lastOkAt) : "—", ago: lastOkAgo ?? "—" })
              : bridge.state === "down" ? t("wk.bridge.handsDown", { when: bridge.lastOkAt ? fmt.dateTime(bridge.lastOkAt) : "—" })
              : bridge.state === "never" ? t("wk.bridge.mount") : null
          }
        />
        <p className="reading" aria-live="polite">{readLine()}</p>
      </div>
      {!empty ? (
        <div className="legend">
          <div className="legend__row" role="group" aria-label={t("wk.legend.label")}>
            <span className="legend__word">{t("wk.legend.show")}</span>
            <button type="button" className={LG_CLS} aria-pressed={!filter.phase && !filter.need} onClick={() => onPhase(null)}>{t("wk.legend.all")} <b>{agents.length}</b></button>
            {LEGEND.filter((p) => phases[p]).map((p) => (
              <button key={p} type="button" className={LG_CLS} aria-pressed={filter.phase === p} onClick={() => onPhase(filter.phase === p ? null : p)}>
                <svg className={`lg__sw lg__sw--${p}`} viewBox="0 0 14 20" aria-hidden="true"><rect x="2" y="1" width="10" height="18" rx="2" /></svg>
                {words.phase(p)} <b>{phases[p]}</b>
              </button>
            ))}
          </div>
          <ul className="legend__key" aria-label={t("wk.legend.keyLabel")}>
            <li>
              <svg viewBox="0 0 64 20" aria-hidden="true"><rect className="k-st" x="1" y="5" width="16" height="10" rx="2" /><rect className="k-sp" x="21" y="7" width="30" height="6" rx="2" /><line className="k-bud" x1="44" y1="1" x2="44" y2="19" /></svg>
              {t("wk.legend.block")}
            </li>
            <li>
              <svg viewBox="0 0 64 20" aria-hidden="true"><rect className="k-st" x="1" y="5" width="16" height="10" rx="2" /><line className="k-none" x1="21" y1="10" x2="40" y2="10" /></svg>
              {t("wk.legend.stub")}
            </li>
            <li>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path className="k-nd" d="M10 2 18 10 10 18 2 10Z" /></svg>
              {t("wk.legend.needs")}
            </li>
            <li>
              <svg viewBox="0 0 20 20" aria-hidden="true"><rect className="k-am" x="3" y="3" width="14" height="14" rx="1.5" /></svg>
              {t("wk.legend.appMaster")}
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
