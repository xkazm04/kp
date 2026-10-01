"use client";

import { useTranslations } from "next-intl";
import type { AgentRosterEntry } from "./agentsWorkforceLogic";
import { needing, totalsOf, type Moves } from "./workforceModel";
import { useWorkforceFormat } from "./useWorkforceFormat";

/** The totals under the floor: hires, who needs you, spend against budget (provider-reported, never an invoice), what was never
 *  costed (nothing reported, not $0) and the App masters. With no hires every figure is an absence with its reason. */
export function WorkforceStats({ agents, moves }: { agents: readonly AgentRosterEntry[]; moves: Moves }) {
  const t = useTranslations("agentsWorkforce");
  const fmt = useWorkforceFormat();
  if (agents.length === 0) {
    return (
      <div className="k-stats wstats">
        <div className="k-fig k-fig--absent"><span className="k-fig__value">—</span><span className="k-fig__label">{t("wk.stats.noHires")}</span></div>
        <div className="k-fig k-fig--absent"><span className="k-fig__value">—</span><span className="k-fig__label">{t("wk.stats.noSpend")}</span></div>
        <div className="k-fig k-fig--absent"><span className="k-fig__value">—</span><span className="k-fig__label">{t("wk.stats.noAppMasters")}</span></div>
      </div>
    );
  }
  const totals = totalsOf(agents);
  const need = needing(agents, moves).length;
  const ams = agents.filter((a) => a.appMaster);
  const onProbation = ams.filter((a) => a.status === "onboarding").length;
  const pct = totals.frac == null ? 0 : Math.min(1, totals.frac) * 100;
  return (
    <div className="k-stats wstats">
      <div className="k-fig"><span className="k-fig__value">{agents.length}</span><span className="k-fig__label">{t("wk.stats.hires", { live: totals.live, gone: agents.length - totals.live })}</span></div>
      <div className={`k-fig${need ? " k-fig--needs" : ""}`}><span className="k-fig__value">{need}</span><span className="k-fig__label">{t("wk.stats.needYou", { count: need })}</span></div>
      <div className="k-fig wstats__spend">
        <span className="k-fig__value">{fmt.usd(totals.month)} <span className="k-fig__of">{t("wk.stats.of", { budget: fmt.usd(totals.budget) })}</span></span>
        <span className="k-fig__label">{t("wk.stats.spent")}</span>
        <span className="k-fig__bar" aria-hidden="true"><i style={{ width: `${pct.toFixed(1)}%` }} /></span>
      </div>
      <div className="k-fig"><span className="k-fig__value">{totals.unmeasured}</span><span className="k-fig__label">{t("wk.stats.uncosted")}</span></div>
      <div className="k-fig"><span className="k-fig__value">{ams.length}</span><span className="k-fig__label">{t("wk.stats.appMasters", { count: ams.length })}{ams.length ? ` · ${t("wk.stats.onProbation", { count: onProbation })}` : ""}</span></div>
    </div>
  );
}
