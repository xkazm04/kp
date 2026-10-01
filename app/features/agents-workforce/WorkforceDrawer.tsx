"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { ConditionMark, KeyHints, type Crumb, type KeyHint } from "@/app/_components/kit/scene";
import { Select } from "@/app/_components/Select";
import { needsYou as needsEntries, type AgentRosterEntry, type NextActionKind } from "./agentsWorkforceLogic";
import { WorkforceCard } from "./WorkforceCard";
import { NeedsMark, type Speak } from "./WorkforceBits";
import { WorkforceTrail } from "./WorkforceTrail";
import { cardSvg, needArcs } from "./WorkforceWheel";
import { R, arcPath, f1, pt } from "./wheelGeometry";
import { cardMin, packRacks, rowColumns } from "./rackPack";
import type { DrawerRef } from "./workforceNav";
import {
  EXIT_STEPS, LIFE_STEPS, SORTS, isLive, nameOf, needsYou, phaseCounts, sorter, totalsOf,
  type BridgeView, type Drawer, type Moves, type SortKey, type Wheel, type WheelDrawer,
} from "./workforceModel";

const STEP_CLS = "steprail__btn";
const CHIP_CLS = "k-chip";

type Rack = { status: (typeof LIFE_STEPS)[number] | (typeof EXIT_STEPS)[number]; n: number; cards: AgentRosterEntry[]; span: number };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(el.clientWidth || 900);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** One drawer's wedge, lifted out of the wheel: the same marks in the same order (decorative; the cards are the content). */
function Wedge({ drawer, wheel, moves, dead }: { drawer: WheelDrawer; wheel: Wheel; moves: Moves; dead: boolean }) {
  const half = Math.max((drawer.a1 - drawer.a0) / 2, 24);
  const k = (2 * half) / (drawer.a1 - drawer.a0);
  const g = { ...drawer, a0: -half, a1: half, pitch: drawer.pitch * k };
  const cards = wheel.cards.filter((c) => c.drawer.key === drawer.key).map((c) => ({ ...c, drawer: g, theta: -half + (c.theta - drawer.a0) * k, pitch: c.pitch * k }));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const d of [-half, 0, half]) for (const r of [R.clock * 0.7, R.outer]) { const p = pt(r, d); xs.push(p[0]); ys.push(p[1]); }
  const x0 = Math.min(...xs) - 14;
  const y0 = Math.min(...ys) - 14;
  const w = Math.max(...xs) - x0 + 14;
  const h = Math.max(...ys) - y0 + 8;
  const b0 = pt(R.budget, g.a0);
  const b1 = pt(R.budget, g.a1);
  const c0 = pt(R.clock, -half - 10);
  const c1 = pt(R.clock, half + 10);
  return (
    <svg className="wedge" viewBox={`${f1(x0)} ${f1(y0)} ${f1(w)} ${f1(h)}`} aria-hidden="true">
      <path className={`sec${drawer.kind === "appmaster" ? " is-am" : ""}`} d={arcPath(R.cardIn - 4, R.outer, g.a0, g.a1)} />
      <path className="budget-ring" d={`M${b0.map(f1).join(" ")}A${R.budget} ${R.budget} 0 0 1 ${b1.map(f1).join(" ")}`} />
      {cards.map((c) => cardSvg(c, moves, dead, false))}
      {needArcs({ drawers: [g], cards }, moves, null)}
      <g className={dead ? "is-stopped" : ""}><path className="wc-face" d={`M${c0.map(f1).join(" ")}A${R.clock} ${R.clock} 0 0 1 ${c1.map(f1).join(" ")}`} /></g>
    </svg>
  );
}

/**
 * Level 1, one drawer of the time-card rack (or every hire, from a needs queue's door): the drawer's label and its
 * wedge of the wheel, the bay (how many need you and which kinds; this month's spend, one segment per hire), the tools
 * (the lifecycle step rail as the status filter, a sort) and the racks: one pocket per lifecycle step, exits kept on
 * the rim as the record. Every card is a real <article>; filters dim nothing away, they hide cards (counted).
 */
export function WorkforceDrawer({ drawerRef, preset, agents, drawers, wheel, moves, bridge, speak, now, active, crumbs, position, onBack, onStep, onOpenCard, onIntegrations }: {
  drawerRef: DrawerRef;
  preset: NextActionKind | null;
  agents: readonly AgentRosterEntry[];
  drawers: readonly Drawer[];
  wheel: Wheel;
  moves: Moves;
  bridge: BridgeView;
  speak: Speak;
  now: Date;
  /** The top level: only then do the digit keys filter here. */
  active: boolean;
  crumbs: readonly Crumb[];
  position: { index: number; of: number } | null;
  onBack: () => void;
  onStep: (delta: 1 | -1) => void;
  onOpenCard: (id: string, walk: string[], el: HTMLElement) => void;
  onIntegrations: () => void;
}) {
  const t = useTranslations("agentsWorkforce");
  const { fmt, words } = speak;
  const drawer = drawerRef === "all" ? null : drawers.find((d) => d.key === drawerRef) ?? null;
  const scope = useMemo(() => (drawer ? drawer.agents : [...agents]), [drawer, agents]);
  const wd = drawer ? wheel.drawers.find((d) => d.key === drawer.key) ?? null : null;
  const [need, setNeed] = useState<NextActionKind | null>(preset);
  const [status, setStatus] = useState<Rack["status"] | "all">("all");
  const [sort, setSort] = useState<SortKey>("needs");
  const [spendSel, setSpendSel] = useState<string | null>(null);
  const dead = bridge.state === "down";
  const [wallRef, wallW] = useWidth();

  const kinds = useMemo(() => needsEntries(scope, bridge.state === "unknown" ? null : { paired: bridge.state === "paired" }, now), [scope, bridge.state, now]);
  const matches = (a: AgentRosterEntry) => (status === "all" || a.status === status) && (!need || (moves.get(a.id)?.kind ?? "none") === need);
  // A filter whose kind has emptied (the row moved on) stops filtering.
  const needLive = need && kinds.some((k) => k.kind === need) ? need : null;
  const shown = scope.filter((a) => (status === "all" || a.status === status) && (!needLive || (moves.get(a.id)?.kind ?? "none") === needLive));
  const filtered = needLive !== null || status !== "all";
  const needCount = scope.filter((a) => needsYou(moves.get(a.id) ?? { kind: "none" })).length;
  const byPhase = phaseCounts(scope, moves);
  const totals = totalsOf(scope);
  const cmp = useMemo(() => sorter(sort, moves), [sort, moves]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tg = e.target;
      if (tg instanceof HTMLElement && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.tagName === "SELECT" || tg.isContentEditable)) return;
      if (!/^[1-6]$/.test(e.key)) return;
      const k = kinds[Number(e.key) - 1];
      if (!k) return;
      e.preventDefault();
      setNeed((cur) => (cur === k.kind ? null : k.kind));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, kinds]);

  const racks = useMemo(() => {
    const mk = (st: Rack["status"]): Rack => {
      const cards = scope.filter((a) => a.status === st).sort(cmp);
      return { status: st, n: cards.length, cards, span: 1 };
    };
    return { life: LIFE_STEPS.map(mk), exits: EXIT_STEPS.map(mk) };
  }, [scope, cmp]);
  const cardW = cardMin(wallW);
  const lifeRows = useMemo(() => packRacks(racks.life, wallW, cardW), [racks.life, wallW, cardW]);
  const exitRows = useMemo(() => packRacks(racks.exits, Math.max(300, wallW - 28), cardW), [racks.exits, wallW, cardW]);
  const exitN = racks.exits.reduce((n, r) => n + r.n, 0);
  const walk = [...racks.life, ...racks.exits].flatMap((r) => r.cards).filter(matches).map((a) => a.id);
  const stepOf = (st: Rack["status"]) => LIFE_STEPS.indexOf(st as (typeof LIFE_STEPS)[number]) + 1;

  const counts: Record<string, number> = {};
  for (const a of scope) counts[a.status] = (counts[a.status] ?? 0) + 1;
  const measured = scope.filter((a) => a.aggregates.monthCostUsd > 0).sort((x, y) => y.aggregates.monthCostUsd - x.aggregates.monthCostUsd);
  const dense = measured.length > 40;
  const uncosted = scope.filter((a) => !(a.aggregates.costUsd > 0));
  const sel = spendSel ? scope.find((a) => a.id === spendSel) ?? null : null;
  const live = scope.filter(isLive).length;

  const title = drawerRef === "all" ? t("wk.drawer.all") : words.drawerNameOf(drawerRef, drawers);
  const keys: KeyHint[] = [
    { id: "esc", keys: ["Esc"], act: t("wk.keys.backToWheel") },
    { id: "arrows", keys: ["←", "→", "↑", "↓"], act: t("wk.keys.betweenCards") },
    { id: "enter", keys: ["Enter"], act: t("wk.keys.openCard") },
    { id: "digits", keys: ["1", "6"], act: t("wk.keys.needsFilters") },
    ...(drawer ? [{ id: "drawers", keys: ["[", "]"], act: t("wk.keys.drawers") }] : []),
  ];

  const lead = drawerRef === "all"
    ? t("wk.drawer.leadAll", { count: scope.length, spent: fmt.usd(totals.month), budget: fmt.usd(totals.budget) })
    : t("wk.drawer.lead", { count: scope.length, spent: fmt.usd(totals.month), budget: fmt.usd(totals.budget) });
  const waitingOnBridge = kinds.find((k) => k.kind === "repair_bridge")?.count ?? 0;
  const where = drawerRef === "all" ? t("wk.drawer.whereAll") : t("wk.drawer.whereDrawer");

  const renderRack = (r: Rack, exit: boolean) => {
    const dim = status !== "all" && status !== r.status;
    const lit = status === r.status;
    return (
      <section key={r.status} className={`rack${dim ? " is-dim" : ""}${lit ? " is-lit" : ""}`} data-rack={r.status} aria-labelledby={`wk-rk-${r.status}`}>
        <header className="rack__head" id={`wk-rk-${r.status}`} tabIndex={-1}>
          <span className="rack__step">{exit ? t("wk.rack.exit") : t("wk.rack.step", { n: stepOf(r.status) })}</span>
          <h3 className="rack__name">
            {words.status(r.status)}
            {r.status === "onboarding" ? <span className="quiet" style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 400 }}> ({t("wk.rack.probation")})</span> : null}
          </h3>
          <span className={`rack__n${r.n ? "" : " is-zero"}`}>{r.n}</span>
        </header>
        <div className="rack__slots" style={{ gridTemplateColumns: `repeat(${r.span}, minmax(0, 1fr))` }}>
          {r.cards.length === 0 ? (
            <div className="slot-empty"><span><b>{t("wk.rack.emptyPocket")}</b>{t(`wk.rack.empty.${r.status}`)}</span></div>
          ) : null}
          {r.cards.map((a) => (
            <div key={a.id} className="pocket">
              <WorkforceCard agent={a} move={moves.get(a.id) ?? { kind: "none" }} speak={speak} now={now} aside={!matches(a)} onOpen={(el) => onOpenCard(a.id, walk, el)} />
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <section className="k-lvl drawer" data-tone={dead ? "coral" : "stone"} aria-label={t("wk.drawer.aria", { name: title })}>
      <WorkforceTrail crumbs={crumbs} onBack={onBack} backLabel={t("wk.back.toWheel")} label={t("wk.crumbsLabel")}>
        <span className="lvl-pos">{drawerRef === "all" ? t("wk.drawer.wholeRack") : position ? t("wk.drawer.position", { index: position.index, of: position.of }) : ""}</span>
        {drawer && position && position.of > 1 ? (
          <span className="drawer__nav">
            <Button label={t("wk.drawer.prev")} variant="ghost" size="sm" onClick={() => onStep(-1)} data-level-key="prev" />
            <Button label={t("wk.drawer.next")} variant="ghost" size="sm" onClick={() => onStep(1)} data-level-key="next" />
          </span>
        ) : null}
      </WorkforceTrail>
      <div className="drawer__front">
        {wd ? <div className="drawer__art"><Wedge drawer={wd} wheel={wheel} moves={moves} dead={dead} /><span className="wedge__cap">{t("wk.drawer.itsWedge")}</span></div> : null}
        <div className={`holder${drawer?.kind === "appmaster" ? " holder--am" : ""}`}>
          <span className="holder__rivet" aria-hidden="true" />
          <div className="holder__card">
            <p className="k-lvl__kicker">{drawerRef === "all" ? t("wk.drawer.kickerAll") : t("wk.drawer.kicker", { n: position?.index ?? 1 })}</p>
            <h2 className="k-lvl__title" tabIndex={-1} data-level-heading="">{title}</h2>
          </div>
          <span className="holder__rivet" aria-hidden="true" />
        </div>
        <div className="drawer__lead">
          <p className="k-lvl__lead">{lead}</p>
          <ConditionMark condition={bridge.condition} label={bridge.state === "paired" ? t("wk.bridge.paired") : bridge.state === "down" ? t("wk.bridge.down") : t("wk.bridge.notPaired")} loud={dead} />
          {drawer?.kind === "appmaster" ? <p className="drawer__am"><NeedsMark tone="machine" />{t("wk.drawer.appMasterNote")}</p> : null}
        </div>
      </div>

      <section className="bay" aria-label={t("wk.drawer.bayLabel")}>
        <div className="bay__msg">
          {dead ? (
            <div className="alarm" role="alert">
              <div className="hl">
                <span className="hl__n">{waitingOnBridge}</span>
                <p className="hl__s">{t("wk.drawer.bridgeDown", { count: waitingOnBridge, where })}</p>
                <p className="alarm__detail">{t("wk.bridge.downDetail", { when: bridge.lastOkAt ? fmt.dateTime(bridge.lastOkAt) : "—", ago: bridge.lastOkAt ? fmt.ago(bridge.lastOkAt) : "—" })}</p>
              </div>
              <div className="alarm__row">
                <Button label={t("nextAction.control.integrations")} variant="primary" size="lg" onClick={onIntegrations} />
                <span className="quiet">{t("wk.drawer.stampClears")}</span>
              </div>
            </div>
          ) : null}
          <div className="hl">
            {!dead ? <span className={`hl__n${needCount ? "" : " is-calm"}`} aria-hidden="true">{needCount}</span> : null}
            <p className="hl__s">
              {t("wk.drawer.cards", { count: scope.length, where })}{" "}
              {needCount
                ? <><b>{t("wk.drawer.needYou", { count: needCount })}</b>: {kinds.map((k) => speak.words.chip(k.kind, k.count)).join(", ")}.</>
                : t("wk.drawer.nothingNeeds")}
            </p>
            <p className="hl__sub">{(["cutoff", "stuck", "waiting", "probation", "working", "out"] as const).filter((p) => byPhase[p]).map((p) => <span key={p}>{byPhase[p]} {words.phasePlural(p)}</span>)}</p>
          </div>
          {kinds.length ? (
            <div className="needs" role="group" aria-label={t("wk.drawer.needsFilter")}>
              <span className="needs__label">{t("nextAction.stripLabel")}</span>
              {kinds.map((k, i) => (
                <button key={k.kind} type="button" className={CHIP_CLS} aria-pressed={needLive === k.kind} aria-keyshortcuts={String(i + 1)} onClick={() => setNeed((c) => (c === k.kind ? null : k.kind))}>
                  <kbd className="kp-kbd">{i + 1}</kbd><NeedsMark /><span>{speak.words.chip(k.kind, k.count)}</span>
                  {k.kind === "approve_in_personas" && k.soonestHoursLeft != null ? <span className="k-chip__soon"> · {t("nextAction.soonest", { hours: k.soonestHoursLeft })}</span> : null}
                </button>
              ))}
              {filtered ? (
                <>
                  <Button label={t("nextAction.showAll")} variant="ghost" size="sm" onClick={() => { setNeed(null); setStatus("all"); }} />
                  <span className="needs__count">{t("wk.drawer.showing", { shown: shown.length, total: scope.length })}</span>
                </>
              ) : null}
            </div>
          ) : (
            <div className="needs"><span className="needs__label">{t("nextAction.stripLabel")}</span><span className="needs__none">{t("wk.drawer.nothingNeedsDrawer")}</span></div>
          )}
        </div>
        <div className="bay__spend">
          <div className="spend">
            <div className="spend__top">
              <span className="spend__label">{t("wk.spend.heading")}</span>
              <span className="spend__fig">{fmt.usd(totals.month)}</span>
              <span className="spend__of">{t("wk.spend.ofBudgets", { budget: fmt.usd(totals.budget), count: totals.budgeted })}{totals.frac == null ? "" : ` (${Math.round(totals.frac * 100)}%)`}</span>
            </div>
            <div className={`spend__bar${dense ? " is-dense" : ""}`} role="group" aria-label={t("wk.spend.barLabel")}>
              {measured.map((a) => {
                const sp = a.aggregates.monthCostUsd;
                const w = totals.budget ? (sp / totals.budget) * 100 : 0;
                const tone = (a.budgetUsd ?? 0) > 0 ? (sp / (a.budgetUsd as number) >= 1 ? "over" : sp / (a.budgetUsd as number) >= 0.8 ? "near" : "under") : "unknown";
                const segCls = `spend__seg tone-${tone}`;
                return dense ? (
                  <i key={a.id} className={segCls} style={{ width: `${w.toFixed(3)}%` }} />
                ) : (
                  <button key={a.id} type="button" className={segCls} style={{ width: `${w.toFixed(2)}%` }} aria-pressed={spendSel === a.id} aria-label={t("wk.spend.segLabel", { name: nameOf(a), spent: fmt.usd(sp) })} onClick={() => setSpendSel((c) => (c === a.id ? null : a.id))} />
                );
              })}
            </div>
            <div className="spend__line">
              <p className="spend__read" aria-live="polite">
                {dense ? <span className="quiet">{t("wk.spend.dense", { count: measured.length })}</span>
                  : sel ? <><b>{nameOf(sel)}</b><span>{t("wk.spend.thisMonth", { spent: fmt.usd(sel.aggregates.monthCostUsd) })}</span><Button label={t("wk.spend.openCard")} variant="link" onClick={(e) => onOpenCard(sel.id, walk, e.currentTarget)} /></>
                  : <span className="quiet">{t("wk.spend.hint")}</span>}
              </p>
              {uncosted.length ? (
                <p className="spend__absent">
                  <span>{t("wk.spend.nothingCosted")}</span>
                  {uncosted.length > 8 ? <span className="stub">{t("wk.spend.hiresCount", { count: uncosted.length })}</span> : uncosted.map((a) => <span key={a.id} className="stub">{nameOf(a)}</span>)}
                </p>
              ) : null}
              <p className="spend__note">{t("spendNote", { zero: fmt.usd(0) })} {t("wk.spend.neverInvoice")}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="tools" aria-label={t("wk.tools.label")}>
        <div className="tools__row">
          <div className="steprail" role="group" aria-label={t("wk.tools.statusFilter")}>
            <button type="button" className={STEP_CLS} aria-pressed={status === "all"} disabled={scope.length === 0} onClick={() => setStatus("all")}>{t("wk.tools.all")} <b>{scope.length}</b></button>
            <span className="steprail__gut" aria-hidden="true" />
            {LIFE_STEPS.map((st, i) => (
              <span key={st} style={{ display: "contents" }}>
                {i > 0 ? <span className="steprail__arrow" aria-hidden="true">→</span> : null}
                <button type="button" className={STEP_CLS} aria-pressed={status === st} disabled={!counts[st]} onClick={() => setStatus(st)}>{words.status(st)} <b>{counts[st] ?? 0}</b></button>
              </span>
            ))}
            <span className="steprail__gut" aria-hidden="true" />
            <span className="steprail__word">{t("wk.tools.exits")}</span>
            {EXIT_STEPS.map((st) => <button key={st} type="button" className={STEP_CLS} aria-pressed={status === st} disabled={!counts[st]} onClick={() => setStatus(st)}>{words.status(st)} <b>{counts[st] ?? 0}</b></button>)}
          </div>
          <div className="sortf">
            <span className="k-seg-lead__word" aria-hidden="true">{t("wk.tools.sort")}</span>
            <Select ariaLabel={t("wk.tools.sortLabel")} value={sort} onChange={(v) => setSort(v as SortKey)} sizeVariant="sm" options={SORTS.map((s) => ({ value: s, label: t(`wk.sort.${s}`) }))} />
          </div>
        </div>
      </section>

      <section className="wall" ref={wallRef} aria-labelledby="wk-wall-head">
        <h3 className="sr-only" id="wk-wall-head">{t("wk.wall.heading")}</h3>
        <div>
          {lifeRows.map((row, i) => (
            <div key={i} className="rackrow" style={{ gridTemplateColumns: rowColumns(row, cardW) }}>{row.map((r) => renderRack(r, false))}</div>
          ))}
        </div>
        <section className="rim" aria-label={t("wk.rack.exitsLabel")}>
          <div className="rim__head"><h3 className="rim__title">{t("wk.tools.exits")}</h3><span className="rim__sub">{t("wk.rack.exitsSub", { count: exitN })}</span></div>
          {exitRows.map((row, i) => (
            <div key={i} className="rackrow" style={{ gridTemplateColumns: rowColumns(row, cardW) }}>{row.map((r) => renderRack(r, true))}</div>
          ))}
        </section>
      </section>

      <div className="k-lvl__foot">
        <KeyHints hints={keys} label={t("wk.keys.drawerLabel")} />
        <span className="quiet" style={{ fontSize: 14 }}>{t("wk.liveOf", { live, total: scope.length })}</span>
      </div>
    </section>
  );
}
