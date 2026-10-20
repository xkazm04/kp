"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { ConditionMark, KeyHints, type Crumb, type KeyHint } from "@/app/_components/kit/scene";
import { probationCountdown, type AgentRosterEntry, type NextAction } from "./agentsWorkforceLogic";
import { AppMasterBlock } from "./WorkforceCard";
import { ConnectorBars, ControlButton, HireNoteView, NeedsMark, ProbStrip, PunchBlock, SpendBlock, Vmark, Xbox, type Speak } from "./WorkforceBits";
import { WorkforceTrail } from "./WorkforceTrail";
import { autopilotKey, rungKey } from "./workforceCopy";
import {
  STATUS_CONDITION, cardNo, controlOf, ledgerOf, missionOf, parseEvent, nameOf, needsYou, noDataReason, spendOf, verdictOf,
  type Drawer,
} from "./workforceModel";
import { memoryChip } from "./agentsWorkforceLogic";

const MEM_CLS = "memchip membtn";

type Tone = "coral" | "moss" | "amber" | "stone";
function toneOf(agent: AgentRosterEntry, move: NextAction): Tone {
  if (needsYou(move)) return "coral";
  const c = STATUS_CONDITION[agent.status];
  return c === "live" ? "moss" : c === "reach" ? "amber" : c === "off" ? "stone" : c === "fail" ? "coral" : "stone";
}

/** "Hired to achieve vs achieved": a task agent's metrics (met / missed / no data, with the reason), or an App master's backbone. */
function Achievements({ agent, now }: { agent: AgentRosterEntry; now: Date }) {
  const t = useTranslations("agentsWorkforce");
  const v = verdictOf(agent, now);
  if (v.kind === "backbone") {
    const b = agent.backbone;
    if (!b) return <p className="quiet">{t("appMaster.backbone.none")}</p>;
    return (
      <>
        <div className="xrow" style={{ gap: 10 }}>
          <Vmark mark={v.mark} />
          <span className="ach__label">{t(`appMaster.backbone.verdict.${b.verdict}`)}</span>
        </div>
        <p className="quiet" style={{ fontSize: 14 }}>
          {b.score == null ? t("appMaster.backbone.noScore") : t("appMaster.backbone.scoreLine", { score: Math.round(b.score * 100), coverage: Math.round(b.coverage * 100) })}
        </p>
        <ul className="ach">
          {b.rules.map((r) => {
            const st = r.measured ? "met" : "nodata";
            return (
              <li key={r.rule}>
                <Xbox state={st} />
                <span className="ach__label">{r.label}</span>
                <span className={`ach__state is-${st}`}>{r.contribution == null ? t("appMaster.backbone.unmeasured") : t("appMaster.backbone.contribution", { earned: r.contribution, weight: r.weight })}</span>
                <span className="ach__vs">{r.reason}</span>
              </li>
            );
          })}
        </ul>
      </>
    );
  }
  if (v.v.rows.length === 0) return <p className="quiet">{t("detail.noMetrics")}</p>;
  const unit = (u: string) => (u ? ` ${u}` : "");
  return (
    <ul className="ach">
      {v.v.rows.map(({ metric, actual, state }) => (
        <li key={metric.key}>
          <Xbox state={state} />
          <span className="ach__label">{metric.label}</span>
          <span className={`ach__state is-${state}`}>{t(`wk.metricState.${state}`)}</span>
          <span className="ach__vs">
            {t("wk.ach.vs", { target: `${metric.direction === "lte" ? "≤" : "≥"} ${metric.target}${unit(metric.unit)}`, actual: actual == null ? "—" : `${actual}${unit(metric.unit)}` })}
          </span>
          {state === "nodata" ? <span className="ach__why">{t("wk.ach.noData", { why: t(`wk.noData.${noDataReason(agent, metric.key)}`) })}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** The next move at full size: the sentence, the ONE control, its answer. */
function MoveBig({ agent, move, speak }: { agent: AgentRosterEntry; move: NextAction; speak: Speak }) {
  const t = useTranslations("agentsWorkforce");
  if (!needsYou(move)) {
    return (
      <div className="move-big is-calm">
        <p className="blk__k">{t("wk.move.heading")}</p>
        <p className="move-big__line">{t("wk.move.nothing")}</p>
        <HireNoteView id={agent.id} speak={speak} />
      </div>
    );
  }
  return (
    <div className="move-big">
      <p className="blk__k" style={{ color: "var(--k-needs-ink)" }}>{t("wk.move.headingNeeds")}</p>
      <p className="move-big__line">{speak.words.moveLine(move)}</p>
      {move.kind === "repair_bridge" ? <span className="bridge-stamp"><NeedsMark />{t("wk.waitsOnBridge")}</span> : null}
      <div className="alarm__row"><ControlButton agent={agent} move={move} speak={speak} size="lg" /></div>
      <HireNoteView id={agent.id} speak={speak} />
    </div>
  );
}

/**
 * Level 2, the FRONT of a time card at full size: the mission, what it was hired to achieve against what it achieved,
 * (an App master's mandate and probation), the next move with its ONE control, its status and last punch, its monthly
 * spend (provider-reported, never an invoice), runs and connectors by calls. The back is one press away.
 */
export function WorkforceFront({ agent, move, drawer, speak, now, crumbs, walk, onBack, onStep, onFlip, onOpenRole }: {
  agent: AgentRosterEntry;
  move: NextAction;
  drawer: Drawer | null;
  speak: Speak;
  now: Date;
  crumbs: readonly Crumb[];
  walk: readonly string[];
  onBack: () => void;
  onStep: (delta: 1 | -1) => void;
  onFlip: (el: HTMLElement) => void;
  onOpenRole: (() => void) | null;
}) {
  const t = useTranslations("agentsWorkforce");
  const { fmt, words } = speak;
  const sp = spendOf(agent);
  const am = agent.appMaster != null;
  const mission = missionOf(agent);
  const i = walk.indexOf(agent.id);
  const walkOn = walk.length > 1;
  const g = agent.aggregates;
  const ctl = controlOf(move);
  const keys: KeyHint[] = [
    { id: "esc", keys: ["Esc"], act: t("wk.keys.backTo", { place: crumbs[crumbs.length - 2]?.label ?? "" }) },
    ...(walkOn ? [{ id: "walk", keys: ["←", "→"], act: t("wk.keys.prevNextCard") }] : []),
  ];
  const heard = agent.lastReportAt ? t("wk.status.heard", { ago: fmt.ago(agent.lastReportAt), at: fmt.dateTime(agent.lastReportAt) }) : t("neverHeardFrom");
  return (
    <section className="k-lvl" data-tone={toneOf(agent, move)} aria-label={nameOf(agent)}>
      <WorkforceTrail crumbs={crumbs} onBack={onBack} backLabel={t("wk.back.to", { place: crumbs[crumbs.length - 2]?.label ?? "" })} label={t("wk.crumbsLabel")}>
        <span className="lvl-pos">{t("wk.card.position", { index: Math.max(i, 0) + 1, of: walk.length })}</span>
        {walkOn ? (
          <span className="drawer__nav">
            <Button label={t("wk.card.prev")} variant="ghost" size="sm" onClick={() => onStep(-1)} data-level-key="prev" />
            <Button label={t("wk.card.next")} variant="ghost" size="sm" onClick={() => onStep(1)} data-level-key="next" />
          </span>
        ) : null}
      </WorkforceTrail>
      <div className="k-lvl__body">
        <div className="k-lvl__sheet sheet-card">
          <div className="k-lvl__head">
            <div className="k-lvl__titles">
              <p className="k-lvl__kicker">{am ? `${t("appMaster.label")} · ` : ""}{t("wk.card.kickerFront", { no: cardNo(agent) })}</p>
              <h2 className="k-lvl__title" tabIndex={-1} data-level-heading="">{nameOf(agent)}</h2>
              <p className="k-lvl__lead">
                {agent.jobTitle}{drawer && words.drawerName(drawer) !== agent.jobTitle ? ` · ${words.drawerName(drawer)}` : ""}
                {onOpenRole ? <> · <Button label={t("wk.card.openRole")} variant="link" onClick={onOpenRole} /></> : null}
              </p>
            </div>
            <ConditionMark condition={STATUS_CONDITION[agent.status]} label={words.status(agent.status)} />
          </div>
          <div className="front">
            <div className="front__col">
              {mission ? <div className="blk"><p className="blk__k">{t("detail.mission")}</p><p className="blk__mission">{mission}</p></div> : null}
              <div className="blk">
                <p className="blk__k">{am ? t("wk.ach.headingAm", { title: t("appMaster.backbone.title") }) : t("wk.ach.heading")}</p>
                <Achievements agent={agent} now={now} />
              </div>
              {am ? <div className="blk"><p className="blk__k">{t("appMaster.label")}</p><AppMasterBlock agent={agent} large /></div> : null}
            </div>
            <div className="front__col">
              <MoveBig agent={agent} move={move} speak={speak} />
              <div className="blk">
                <p className="blk__k">{t("wk.status.heading")}</p>
                <p className="xrow" style={{ gap: 12 }}><ConditionMark condition={STATUS_CONDITION[agent.status]} label={words.status(agent.status)} /><span>{heard}</span></p>
                <PunchBlock agent={agent} speak={speak} />
              </div>
              <div className="blk big-spend">
                <p className="blk__k">{t("wk.spend.monthly")}</p>
                <SpendBlock agent={agent} speak={speak} />
                <p className="quiet" style={{ fontSize: 14 }}>{t("wk.spend.lifetime", { value: sp.unmeasured ? t("wk.spend.nothingReported") : fmt.usd(sp.lifetime) })} {t("spendNote", { zero: fmt.usd(0) })}</p>
              </div>
              <div className="blk">
                <p className="blk__k">{t("wk.runs")}</p>
                <p className={g.runs ? "fact__v" : "fact__v is-absent"} style={{ fontSize: 16 }}>
                  {g.runs ? `${t("runsCount", { count: g.runs })}${g.successRate != null ? ` · ${t("successRate", { rate: Math.round(g.successRate * 100) })}` : ""}` : t("noRuns")}
                </p>
              </div>
              <div className="blk"><p className="blk__k">{t("wk.connectors.byCalls")}</p><ConnectorBars agent={agent} speak={speak} /></div>
            </div>
          </div>
          <div className="flipbar">
            <Button label={t("wk.card.flip")} variant="secondary" size="lg" onClick={(e) => onFlip(e.currentTarget)} data-level-key="flip" />
            <span className="quiet" style={{ fontSize: 14 }}>{am ? t("wk.card.flipHintAm") : t("wk.card.flipHint")}</span>
          </div>
        </div>
      </div>
      <div className="k-lvl__foot">
        <KeyHints hints={keys} label={t("wk.keys.cardLabel")} />
        {ctl && ctl !== "explain" ? <span className="quiet" style={{ fontSize: 14 }}>{words.controlLabel(ctl)}</span> : null}
      </div>
    </section>
  );
}

/**
 * Level 3, the BACK of a time card, the evidence: a task agent's metric table (target, actual, state with its reason), or an
 * App master's backbone (every rule's contribution, every gate), its probation countdown, the mandate ladder (rungs 3
 * and 4 are never grantable), autopilot and memory; connectors by calls; and the lifecycle ledger, newest first, in UTC,
 * with what was never recorded stated, not blank.
 */
export function WorkforceBack({ agent, speak, now, crumbs, onBack }: {
  agent: AgentRosterEntry;
  speak: Speak;
  now: Date;
  crumbs: readonly Crumb[];
  onBack: () => void;
}) {
  const t = useTranslations("agentsWorkforce");
  const { fmt, words } = speak;
  const am = agent.appMaster;
  const led = ledgerOf(agent);
  const v = verdictOf(agent, now);
  const [memOpen, setMemOpen] = useState(false);
  const prob = probationCountdown(agent, now);
  const mem = am ? memoryChip(am.memory) : null;
  const held = am?.scopeRung ?? null;
  const keys: KeyHint[] = [
    { id: "esc", keys: ["Esc"], act: t("wk.keys.backToFront") },
    { id: "tab", keys: ["Tab"], act: t("wk.keys.throughEvidence") },
  ];
  const b = agent.backbone;
  const left = (
    <>
      {am ? (
        <>
          <div>
            <h3 className="sec__h">{t("appMaster.backbone.title")}</h3>
            {!b ? <p className="quiet">{t("appMaster.backbone.none")}</p> : (
              <>
                <p className="xrow" style={{ gap: 10, marginBottom: 6 }}><Vmark mark={v.mark} /><b style={{ fontSize: 18 }}>{t(`appMaster.backbone.verdict.${b.verdict}`)}</b></p>
                <p className="quiet" style={{ fontSize: 14, marginBottom: 12 }}>
                  {b.score == null ? t("appMaster.backbone.noScore") : t("appMaster.backbone.scoreLine", { score: Math.round(b.score * 100), coverage: Math.round(b.coverage * 100) })}
                </p>
                <ul className="rules">
                  {b.rules.map((r) => (
                    <li key={r.rule}>
                      <span>{r.label}</span>
                      <span className={r.contribution == null ? "quiet" : undefined}>{r.contribution == null ? `${t("appMaster.backbone.unmeasured")} · ${t("wk.rule.weight", { weight: r.weight })}` : t("appMaster.backbone.contribution", { earned: r.contribution, weight: r.weight })}</span>
                      <span className={`rbar${r.contribution == null ? " is-none" : ""}`} aria-hidden="true">{r.contribution == null ? null : <i style={{ width: `${((r.contribution / r.weight) * 100).toFixed(1)}%` }} />}</span>
                      <span className="quiet" style={{ gridColumn: "1 / -1" }}>{r.reason}</span>
                    </li>
                  ))}
                </ul>
                <h4 className="blk__k" style={{ margin: "16px 0 6px" }}>{t("wk.gates")}</h4>
                <ul className="gates">
                  {b.gates.map((gt) => <li key={gt.gate}><Vmark mark={gt.passed ? "pass" : "fail"} /><span className="quiet">{gt.reason}</span></li>)}
                </ul>
              </>
            )}
          </div>
          <div>
            <h3 className="sec__h">{t("wk.probation")} <small>{t("wk.probationHint")}</small></h3>
            {prob ? <ProbStrip prob={prob} large /> : <p className="quiet">{t("wk.noProbation")}</p>}
          </div>
        </>
      ) : (
        <div>
          <h3 className="sec__h">{v.kind === "metrics" && v.v.source === "kpiDeltas" ? t("detail.objectivesHeading") : t("detail.metricsHeading")}</h3>
          {v.kind === "metrics" && v.v.rows.length === 0 ? <p className="quiet">{t("detail.noMetrics")}</p> : v.kind === "metrics" ? (
            <div className="mtab" role="table" aria-label={t("detail.metricsHeading")}>
              <div className="mtab__row mtab__head" role="row">
                <span role="columnheader">{t("wk.table.metric")}</span><span role="columnheader">{t("wk.table.target")}</span><span role="columnheader">{t("wk.table.actual")}</span><span role="columnheader">{t("wk.table.state")}</span>
              </div>
              {v.v.rows.map(({ metric, actual, state }) => (
                <div className="mtab__row" role="row" key={metric.key}>
                  <span role="cell">{metric.label}</span>
                  <span role="cell">{metric.direction === "lte" ? "≤" : "≥"} {metric.target} {metric.unit}</span>
                  <span role="cell">{actual == null ? "—" : `${actual} ${metric.unit}`.trim()}</span>
                  <span role="cell" className="state">
                    <span className="xrow"><Xbox state={state} />{t(`wk.metricState.${state}`)}</span>
                    {state === "nodata" ? <span className="why">{t(`wk.noData.${noDataReason(agent, metric.key)}`)}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
      <div><h3 className="sec__h">{t("wk.connectors.byCalls")}</h3><ConnectorBars agent={agent} speak={speak} /></div>
    </>
  );
  const right = (
    <>
      <div>
        <h3 className="sec__h">{t("wk.ledger.heading")} <small>{t("wk.ledger.hint")}</small></h3>
        <ol className="ledger">
          {led.events.map((ev) => {
            const parsed = ev.kind === "decision" ? parseEvent(ev.event) : null;
            return (
              <li key={`${ev.kind}-${ev.at}`}>
                <time dateTime={ev.at}>{fmt.dateTime(ev.at)}</time>
                <span>
                  {ev.kind !== "decision" ? t(`wk.ledger.${ev.kind}`)
                    : parsed?.kind === "known" ? t(`wk.event.${parsed.event}`)
                    : parsed?.kind === "poll" ? t("wk.event.poll", { status: words.status(parsed.status) })
                    : t("wk.event.other", { event: parsed?.kind === "other" ? parsed.event : "" })}
                </span>
              </li>
            );
          })}
          {led.absent.map((a) => <li key={a} className="is-blank"><time>{t("wk.ledger.noPunch")}</time><span>{t(`wk.ledger.absent.${a}`)}</span></li>)}
        </ol>
      </div>
      {am ? (
        <>
          <div>
            <h3 className="sec__h">{t("wk.ladder.heading")} <small>{t("wk.ladder.hint")}</small></h3>
            <ol className="ladder" aria-label={t("wk.ladder.label")}>
              {[4, 3, 2, 1, 0].map((n) => {
                const locked = n >= 3;
                const cls = locked ? "is-locked" : n === held ? "is-held" : held != null && n < held ? "is-below" : "";
                return (
                  <li key={n} className={cls}>
                    <span className="rung">{n}</span>
                    <span>{t(locked ? `wk.ladder.rung${n as 3 | 4}` : rungKey(n))}</span>
                    {locked ? <span className="lock">{t("wk.ladder.neverGrantable")}</span> : n === held ? <b>{t("wk.ladder.held")}</b> : <span className="quiet">{held != null && n < held ? t("wk.ladder.below") : t("wk.ladder.notGranted")}</span>}
                  </li>
                );
              })}
            </ol>
          </div>
          <div>
            <h3 className="sec__h">{t("wk.autopilotMemory")}</h3>
            <p style={{ marginBottom: 10 }}>{t(autopilotKey(am.autopilotMode))}</p>
            {mem ? (
              <div className="memwrap">
                <button type="button" className={MEM_CLS} aria-expanded={memOpen} onClick={() => setMemOpen((o) => !o)}>
                  {t("appMaster.memory.chip", { counts: mem })} <span className="quiet">· {t("wk.whatIsThis")}</span>
                </button>
                <p className="memtitle" style={memOpen ? { display: "block" } : undefined}>{t("appMaster.memory.title")}</p>
              </div>
            ) : <p className="quiet">{t("wk.noMemory")}</p>}
          </div>
        </>
      ) : null}
    </>
  );
  return (
    <section className="k-lvl" data-tone="stone" aria-label={t("wk.back.aria", { name: nameOf(agent) })}>
      <WorkforceTrail crumbs={crumbs} onBack={onBack} backLabel={t("wk.back.to", { place: crumbs[crumbs.length - 2]?.label ?? "" })} label={t("wk.crumbsLabel")} />
      <div className="k-lvl__body">
        <div className="k-lvl__sheet sheet-back">
          <div className="k-lvl__head">
            <div className="k-lvl__titles">
              <p className="k-lvl__kicker">{am ? `${t("appMaster.label")} · ` : ""}{t("wk.card.kickerBack", { no: cardNo(agent) })}</p>
              <h2 className="k-lvl__title" tabIndex={-1} data-level-heading="">{t("wk.back.title", { name: nameOf(agent) })}</h2>
              <p className="k-lvl__lead">{agent.jobTitle} · {words.status(agent.status)}</p>
            </div>
            <ConditionMark condition={STATUS_CONDITION[agent.status]} label={words.status(agent.status)} />
          </div>
          <div className="back"><div className="back__col">{left}</div><div className="back__col">{right}</div></div>
        </div>
      </div>
      <div className="k-lvl__foot"><KeyHints hints={keys} label={t("wk.keys.backLabel")} /></div>
    </section>
  );
}

