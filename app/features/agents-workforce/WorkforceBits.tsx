"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Mark } from "@/app/_components/kit/Mark";
import { ConditionMark } from "@/app/_components/kit/scene";
import {
  specConnectors, topConnectors,
  type AgentRosterEntry, type MetricRow, type NextAction, type ProbationCountdown,
} from "./agentsWorkforceLogic";
import { STATUS_CONDITION, controlOf, spendOf } from "./workforceModel";
import type { HireControl } from "./useHireControl";
import type { WorkforceFormat } from "./useWorkforceFormat";
import type { WorkforceWords } from "./useWorkforceWords";

/** What every card and level needs to speak: the reader's formatting and words, the one control instance, the moves. */
export type Speak = {
  fmt: WorkforceFormat;
  words: WorkforceWords;
  control: HireControl;
  /** Runs the one control a move names (refresh / re-dispatch; the bridge link navigates). */
  run: (agent: AgentRosterEntry, move: NextAction) => void;
};

const GLYPH = {
  check: <path d="M3.4 8.6 6.6 11.6 12.6 4.6" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />,
  dash: <path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  cross: <path d="m4 4 8 8m0-8-8 8" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />,
} as const;

/** A metric's state as a box: the glyph says it (met / missed / no data), the colour is second. */
export function Xbox({ state, label }: { state: MetricRow["state"]; label?: string }) {
  const g = state === "met" ? GLYPH.check : state === "missed" ? GLYPH.cross : GLYPH.dash;
  return (
    <span className={`xbox xbox--${state}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 16 16" aria-hidden="true">{g}</svg>
    </span>
  );
}

/** A verdict as a round mark: pass = check, fail = cross, unknown = a DASH (never a soft pass). */
export function Vmark({ mark }: { mark: "pass" | "fail" | "unknown" }) {
  const g = mark === "pass" ? GLYPH.check : mark === "fail" ? GLYPH.cross : GLYPH.dash;
  return (
    <span className={`vmark vmark--${mark}`} aria-hidden="true">
      <svg viewBox="0 0 16 16">{g}</svg>
    </span>
  );
}

export function StatusMark({ agent, words, loud = false }: { agent: AgentRosterEntry; words: WorkforceWords; loud?: boolean }) {
  return <ConditionMark condition={STATUS_CONDITION[agent.status]} label={words.status(agent.status)} loud={loud} />;
}

/** Spend as a bar against the hire's OWN budget; an uncosted hire is a dashed empty bar, never a zero-length "0". */
export function SpendBlock({ agent, speak }: { agent: AgentRosterEntry; speak: Speak }) {
  const t = useTranslations("agentsWorkforce");
  const sp = spendOf(agent);
  const { fmt } = speak;
  const budget = sp.budget != null ? fmt.usd(sp.budget) : null;
  const pct = sp.frac == null ? 0 : Math.min(1, sp.frac) * 100;
  if (sp.unmeasured) {
    return (
      <>
        <div className="sbar is-unmeasured" role="img" aria-label={t("wk.spend.unmeasuredLabel")} />
        <p className="sline">
          <b>{budget ? t("spendOfBudget", { spent: "—", budget }) : "—"}</b> <span className="quiet">· {t("wk.spend.nothingReported")}</span>
        </p>
      </>
    );
  }
  const text = budget ? t("spendOfBudget", { spent: fmt.usd(sp.month), budget }) : fmt.usd(sp.month);
  const note = sp.frac == null ? t("wk.spend.noBudget") : sp.month === 0 ? t("wk.spend.nothingThisMonth") : t("wk.spend.ofBudget", { pct: Math.round(sp.frac * 100) });
  return (
    <>
      <div className={`sbar tone-${sp.tone}`} role="img" aria-label={`${text}, ${note}`}>
        <i style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
      <p className="sline">
        <b>{text}</b> <span className="quiet">· {t("wk.spend.providerReported")}{sp.month === 0 ? `, ${note}` : ""}</span>
      </p>
    </>
  );
}

/** "Last punched" = the last report heard (accepted or not); a hire never heard from is "never punched", not idle. */
export function PunchBlock({ agent, speak }: { agent: AgentRosterEntry; speak: Speak }) {
  const t = useTranslations("agentsWorkforce");
  const { fmt } = speak;
  if (!agent.lastReportAt) {
    return (
      <div className="punch is-blank">
        <span className="punch__hole" aria-hidden="true" />
        <span>{t("wk.punch.never")}</span>
      </div>
    );
  }
  const act = agent.aggregates.lastActivityAt;
  let sub: ReactNode = null;
  if (!act) sub = <span className="punch__sub">· {t("wk.punch.noneAccepted")}</span>;
  else if (Date.parse(agent.lastReportAt) - Date.parse(act) > 24 * 3600e3) sub = <span className="punch__sub">· {t("wk.punch.lastAccepted", { when: fmt.ago(act) })}</span>;
  return (
    <div className="punch">
      <span className="punch__hole" aria-hidden="true" />
      <span>
        {t("wk.punch.last", { when: fmt.ago(agent.lastReportAt) })} {sub}
      </span>
    </div>
  );
}

export function RunsFact({ agent, speak }: { agent: AgentRosterEntry; speak: Speak }) {
  const t = useTranslations("agentsWorkforce");
  const g = agent.aggregates;
  if (!g.runs) {
    return (
      <div>
        <p className="fact__k">{t("wk.runs")}</p>
        <p className="fact__v is-absent">{t("noRuns")}</p>
      </div>
    );
  }
  return (
    <div>
      <p className="fact__k">{t("wk.runs")}</p>
      <p className="fact__v">{t("runsCount", { count: g.runs })}</p>
      {g.successRate != null ? <p className="fact__v" style={{ fontWeight: 400 }}>{t("successRate", { rate: Math.round(g.successRate * 100) })}</p> : null}
      <span className="sr-only">{speak.fmt.num(g.runs)}</span>
    </div>
  );
}

/** Connector stamps: calls per connector the hire reported, else the spec's list ("no calls": none reported, not none made). */
export function Stamps({ agent, speak, max = 3 }: { agent: AgentRosterEntry; speak: Speak; max?: number }) {
  const t = useTranslations("agentsWorkforce");
  const reported = topConnectors(agent.aggregates.connectors, 99).top;
  const spec = specConnectors(agent.spec);
  const list = [...reported.map((c) => ({ name: c.name, calls: c.calls as number | null })), ...spec.filter((n) => !reported.some((c) => c.name === n)).map((n) => ({ name: n, calls: null as number | null }))];
  if (list.length === 0) return <p className="quiet" style={{ fontSize: 14 }}>{t("wk.connectors.none")}</p>;
  return (
    <div className="stamps" role="group" aria-label={t("wk.connectors.label")}>
      {list.slice(0, max).map((c) => (
        <span key={c.name} className={`stamp${c.calls == null ? " is-none" : ""}`}>
          {c.name} <b>{c.calls == null ? t("wk.connectors.noCalls") : speak.fmt.num(c.calls)}</b>
        </span>
      ))}
      {list.length > max ? <span className="stamp is-none">{t("moreConnectors", { count: list.length - max })}</span> : null}
    </div>
  );
}

/** One bar per connector, by calls; a connector in the spec with nothing reported is a dashed bar and "no calls recorded". */
export function ConnectorBars({ agent, speak }: { agent: AgentRosterEntry; speak: Speak }) {
  const t = useTranslations("agentsWorkforce");
  const reported = topConnectors(agent.aggregates.connectors, 99).top;
  const spec = specConnectors(agent.spec);
  const rows = [
    ...reported.map((c) => ({ name: c.name, calls: c.calls as number | null, inSpec: spec.includes(c.name) })),
    ...spec.filter((n) => !reported.some((c) => c.name === n)).map((n) => ({ name: n, calls: null as number | null, inSpec: true })),
  ];
  if (rows.length === 0) return <p className="quiet">{t("wk.connectors.noneInSpec")}</p>;
  const max = Math.max(1, ...rows.map((r) => r.calls ?? 0));
  return (
    <ul className="cbars">
      {rows.map((r) => (
        <li key={r.name}>
          <span>
            {r.name}
            {r.inSpec ? "" : <span className="quiet"> ({t("wk.connectors.notInSpec")})</span>}
          </span>
          {r.calls == null ? (
            <>
              <span className="cbar is-none" aria-hidden="true" />
              <span className="quiet">{t("wk.connectors.noneRecorded")}</span>
            </>
          ) : (
            <>
              <span className="cbar" aria-hidden="true"><i style={{ width: `${((r.calls / max) * 100).toFixed(1)}%` }} /></span>
              <b>{speak.fmt.num(r.calls)}</b>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One box per day of the probation window, punched as it passes; the countdown never says no review happened. */
export function ProbStrip({ prob, large = false }: { prob: ProbationCountdown | null; large?: boolean }) {
  const t = useTranslations("agentsWorkforce");
  if (!prob) return null;
  const text = prob.due ? t("appMaster.probationDue", { total: prob.totalDays }) : t("appMaster.probationLeft", { left: prob.daysLeft, total: prob.totalDays });
  const boxes = Array.from({ length: Math.min(prob.totalDays, 120) }, (_, i) => (
    <i key={i} className={`${i < prob.elapsedDays ? "is-punched" : ""}${i === prob.elapsedDays && !prob.due ? " is-today" : ""}`} />
  ));
  return (
    <>
      <div className={`prob${large ? " probbig" : ""}`} role="img" aria-label={`${text}: ${t("wk.prob.punched", { done: Math.min(prob.elapsedDays, prob.totalDays), total: prob.totalDays })}`}>
        <div className="prob__days" style={{ gridTemplateColumns: `repeat(${Math.min(prob.totalDays, 120)}, minmax(0, 1fr))` }}>{boxes}</div>
      </div>
      <p className={`prob__text${prob.due ? " is-due" : ""}`} style={large ? { fontSize: 16 } : undefined}>{text}</p>
    </>
  );
}

/** The ONE control a move puts on a card; a reporter to check has none (it is checked in the Personas app). */
export function ControlButton({ agent, move, speak, size }: { agent: AgentRosterEntry; move: NextAction; speak: Speak; size: "sm" | "md" | "lg" }) {
  const t = useTranslations("agentsWorkforce");
  const ctl = controlOf(move);
  if (!ctl) return null;
  if (ctl === "explain") return <p className="tc__explain">{t("wk.noControl")}</p>;
  const busy = speak.control.busy.has(agent.id);
  const label = busy && ctl !== "integrations" ? speak.words.controlBusy(ctl) : speak.words.controlLabel(ctl);
  const cls = `k-btn k-btn--primary${size === "md" ? "" : ` k-btn--${size}`}${busy ? " is-loading has-loading-label" : ""}`;
  return (
    <button type="button" className={cls} data-ctl={ctl} data-id={agent.id} data-level-key="control" aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => !busy && speak.run(agent, move)}>
      {label}
    </button>
  );
}

/** The answer a control gave, beside it (role=status: its implicit live region is already polite). */
export function HireNoteView({ id, speak }: { id: string; speak: Speak }) {
  const n = speak.control.notes[id];
  if (!n) return null;
  return (
    <p className={`tc__note ${n.tone === "ok" ? "is-good" : n.tone === "bad" ? "is-bad" : ""}`} role="status">
      {n.text}
    </p>
  );
}

/** A kit mark whose words sit beside it (the mark itself is silent). */
export function NeedsMark({ tone = "needs" }: { tone?: "needs" | "caution" | "ok" | "machine" | "unknown" }) {
  return (
    <span aria-hidden="true" style={{ display: "inline-flex" }}>
      <Mark kind={tone} />
    </span>
  );
}
