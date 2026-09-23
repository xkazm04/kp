"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CHIP_TOGGLE, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { fmtUsd, needsYou, nextAction, type AgentRosterEntry, type NextActionKind } from "./agentsWorkforceLogic";
import { AgentsWorkforceRow } from "./AgentsWorkforceRow";

// The roster table. One row per hired agent; a click expands the row into the
// metrics-vs-actuals detail (AgentsWorkforceRow renders both the summary <tr>
// and the expanded detail <tr>).
//
// Above it, the "needs you" strip: every row's derived next move
// (agentsWorkforceLogic.ts `nextAction`), counted per kind in the declared
// priority order. A chip filters the table to that kind; pressing it again (or
// "Show all") clears the filter. An all-quiet roster renders no strip at all.

export function AgentsWorkforceRoster({
  agents,
  paired,
  onChanged,
}: {
  agents: AgentRosterEntry[];
  /** null while the bridge status is still loading — not evidence of a dead one. */
  paired: boolean | null;
  onChanged: () => void;
}) {
  const t = useTranslations("agentsWorkforce");
  const locale = useLocale();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<NextActionKind | null>(null);

  // One clock per render so every row and the strip agree on "now".
  const { moves, strip } = useMemo(() => {
    const now = new Date();
    const bridge = paired == null ? null : { paired };
    return {
      moves: new Map(agents.map((a) => [a.id, nextAction(a, bridge, now)])),
      strip: needsYou(agents, bridge, now),
    };
  }, [agents, paired]);

  // A filter whose kind has emptied (the row moved on) stops filtering.
  const activeFilter = filter && strip.some((s) => s.kind === filter) ? filter : null;
  const shown = activeFilter ? agents.filter((a) => moves.get(a.id)?.kind === activeFilter) : agents;

  return (
    <div className="space-y-3">
      {strip.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("nextAction.stripLabel")}>
          <span className={META_LABEL}>{t("nextAction.stripLabel")}</span>
          {strip.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              aria-pressed={activeFilter === entry.kind}
              onClick={() => setFilter((f) => (f === entry.kind ? null : entry.kind))}
              className={`${CHIP_TOGGLE(activeFilter === entry.kind)} nums`}
            >
              {t(`nextAction.chip.${entry.kind}` as Parameters<typeof t>[0], { count: entry.count })}
              {entry.soonestHoursLeft != null ? (
                <span className="font-normal">· {t("nextAction.soonest", { hours: entry.soonestHoursLeft })}</span>
              ) : null}
            </button>
          ))}
          {activeFilter ? (
            <>
              <span className="text-sm text-steel nums" role="status">
                {t("nextAction.filtered", { shown: shown.length, total: agents.length })}
              </span>
              <button type="button" onClick={() => setFilter(null)} className="focus-ring text-sm text-steel underline-offset-2 hover:text-coral hover:underline">
                {t("nextAction.showAll")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <div className={`${PANEL} overflow-x-auto`}>
        <table className="w-full min-w-[52rem] text-left">
          <thead>
            <tr className="border-b border-stone-200 text-meta uppercase text-steel">
              <th scope="col" className="px-4 py-2.5 font-semibold">{t("col.agent")}</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">{t("col.role")}</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">
                {/* Cost is CLI-self-reported by the provider — flag it right in the header. */}
                <span title={t("spendNote", { zero: fmtUsd(0, locale) })} className="cursor-help underline decoration-dotted underline-offset-2">
                  {t("col.spend")}
                </span>
              </th>
              <th scope="col" className="px-4 py-2.5 font-semibold">{t("col.runs")}</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">{t("col.connectors")}</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">{t("col.expectations")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((agent) => (
              <AgentsWorkforceRow
                key={agent.id}
                agent={agent}
                move={moves.get(agent.id) ?? { kind: "none" }}
                expanded={expandedId === agent.id}
                onToggle={() => setExpandedId((id) => (id === agent.id ? null : agent.id))}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
