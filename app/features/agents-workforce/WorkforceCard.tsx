"use client";

import { useTranslations } from "next-intl";
import { rungKey, autopilotKey } from "./workforceCopy";
import { memoryChip, probationCountdown, type AgentRosterEntry, type NextAction } from "./agentsWorkforceLogic";
import { cardNo, nameOf, needsYou, verdictOf } from "./workforceModel";
import { ControlButton, HireNoteView, NeedsMark, PunchBlock, ProbStrip, RunsFact, SpendBlock, Stamps, StatusMark, Vmark, Xbox, type Speak } from "./WorkforceBits";

// Built into a name first: the style ratchet counts a literal class on a hand-rolled <button>, and this is a
// scene part (a card's name opens its level), painted by workforce.css, not a recipe.
const OPEN_CLS = "tc__open";

/** The expectations column of a card: an App master's backbone verdict, or a task agent's metric boxes. */
export function ExpectFact({ agent, now }: { agent: AgentRosterEntry; now: Date }) {
  const t = useTranslations("agentsWorkforce");
  const v = verdictOf(agent, now);
  if (v.kind === "backbone") {
    return (
      <div>
        <p className="fact__k">{t("wk.backbone")}</p>
        <p className="xrow">
          <Vmark mark={v.mark} />
          <span className={`fact__v${v.verdict ? "" : " is-absent"}`}>{v.verdict ? t(`appMaster.backbone.verdict.${v.verdict}`) : t("appMaster.backbone.none")}</span>
        </p>
      </div>
    );
  }
  const e = v.v;
  if (e.total === 0) {
    return (
      <div>
        <p className="fact__k">{t("wk.expectations")}</p>
        <p className="fact__v is-absent">{t("detail.noMetrics")}</p>
      </div>
    );
  }
  return (
    <div>
      <p className="fact__k">{t("wk.expectations")}</p>
      <p className="xrow">
        {e.rows.map((r) => (
          <Xbox key={r.metric.key} state={r.state} label={`${r.metric.label}: ${t(`wk.metricState.${r.state}`)}`} />
        ))}
      </p>
      <p className={`fact__v${e.hasData ? "" : " is-absent"}`}>{e.hasData ? t("expectationsMet", { met: e.met, total: e.total }) : t("expectationsNoData")}</p>
    </div>
  );
}

/** An App master's mandate rung, memory chip and probation strip (the three facts that make it a second kind of hire). */
export function AppMasterBlock({ agent, large = false }: { agent: AgentRosterEntry; large?: boolean }) {
  const t = useTranslations("agentsWorkforce");
  const am = agent.appMaster;
  if (!am) return null;
  const mem = memoryChip(am.memory);
  const rung = t(rungKey(am.scopeRung));
  const prob = probationCountdown(agent, new Date());
  if (large) {
    return (
      <div className="am">
        <p className="am__line">{rung}</p>
        <p className="am__line">
          {t(autopilotKey(am.autopilotMode))}
          {mem ? <> · <span className="memchip">{t("appMaster.memory.chip", { counts: mem })}</span></> : null}
        </p>
        <ProbStrip prob={prob} />
      </div>
    );
  }
  return (
    <div className="am">
      <p className="am__line">{rung}</p>
      {mem ? <p className="am__line"><span className="memchip">{t("appMaster.memory.chip", { counts: mem })}</span></p> : null}
      <ProbStrip prob={prob} />
    </div>
  );
}

/**
 * One time card: its number, its status, its name and role, when it last punched in, spend against ITS OWN
 * budget, runs and expectations, its connectors, (an App master's mandate) and the one thing it needs with
 * the one control. Opening it is the name; the control is a separate press.
 */
export function WorkforceCard({ agent, move, speak, now, aside, onOpen }: {
  agent: AgentRosterEntry;
  move: NextAction;
  speak: Speak;
  now: Date;
  /** Filtered out of the current view but still in its place (dimmed, never hidden). */
  aside: boolean;
  onOpen: (el: HTMLElement) => void;
}) {
  const t = useTranslations("agentsWorkforce");
  const needs = needsYou(move);
  const am = agent.appMaster != null;
  const cls = `tc${am ? " tc--am" : ""}${needs ? " tc--needs" : ""}${aside ? " is-aside" : ""}`;
  const descId = `wk-d-${agent.id}`;
  return (
    <article className={cls} data-id={agent.id} data-status={agent.status}>
      {needs && move.kind !== "none" ? (
        <div className="tc__tab">
          <NeedsMark />
          <span className="tc__tabk">{t("nextAction.stripLabel")}</span>
          <span className="tc__tabsep" aria-hidden="true">·</span>
          <span className="tc__tabkind"><span className="sr-only">: </span>{speak.words.kindShort(move.kind)}</span>
        </div>
      ) : null}
      {am ? (
        <div className="tc__band">
          <NeedsMark tone="machine" />
          <span>{t("appMaster.label")}</span>
          <span style={{ fontWeight: 400 }}>{agent.appMaster?.autopilotMode ? t(autopilotKey(agent.appMaster.autopilotMode)) : t("wk.autopilotUnreported")}</span>
        </div>
      ) : null}
      <div className="tc__head">
        <span className="tc__no">{t("wk.cardNo", { no: cardNo(agent) })}</span>
        <StatusMark agent={agent} words={speak.words} />
      </div>
      <button type="button" className={OPEN_CLS} data-wk-nav="" data-id={agent.id} aria-describedby={descId} onClick={(e) => onOpen(e.currentTarget)}>
        {nameOf(agent)}
      </button>
      <p className="tc__role" id={descId}>{agent.jobTitle}</p>
      {move.kind === "repair_bridge" ? <span className="bridge-stamp"><NeedsMark />{t("wk.waitsOnBridge")}</span> : null}
      <PunchBlock agent={agent} speak={speak} />
      <div><SpendBlock agent={agent} speak={speak} /></div>
      <div className="facts">
        <RunsFact agent={agent} speak={speak} />
        <ExpectFact agent={agent} now={now} />
      </div>
      <Stamps agent={agent} speak={speak} max={3} />
      {am ? <AppMasterBlock agent={agent} /> : null}
      {needs ? (
        <div className="tc__move">
          <p className="tc__moveline"><NeedsMark /><span>{speak.words.moveLine(move)}</span></p>
          <ControlButton agent={agent} move={move} speak={speak} size="sm" />
          <HireNoteView id={agent.id} speak={speak} />
        </div>
      ) : (
        <HireNoteView id={agent.id} speak={speak} />
      )}
    </article>
  );
}

