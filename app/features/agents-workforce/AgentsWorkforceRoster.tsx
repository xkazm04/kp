"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PANEL } from "@/app/_components/ui/recipes";
import type { AgentRosterEntry } from "./agentsWorkforceLogic";
import { AgentsWorkforceRow } from "./AgentsWorkforceRow";

// The roster table. One row per hired agent; a click expands the row into the
// metrics-vs-actuals detail (AgentsWorkforceRow renders both the summary <tr>
// and the expanded detail <tr>).

export function AgentsWorkforceRoster({
  agents,
  onChanged,
}: {
  agents: AgentRosterEntry[];
  onChanged: () => void;
}) {
  const t = useTranslations("agentsWorkforce");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className={`${PANEL} overflow-x-auto`}>
      <table className="w-full min-w-[52rem] text-left">
        <thead>
          <tr className="border-b border-stone-200 text-meta uppercase text-steel">
            <th scope="col" className="px-4 py-2.5 font-semibold">{t("col.agent")}</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">{t("col.role")}</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              {/* Cost is CLI-self-reported by the provider — flag it right in the header. */}
              <span title={t("spendNote")} className="cursor-help underline decoration-dotted underline-offset-2">
                {t("col.spend")}
              </span>
            </th>
            <th scope="col" className="px-4 py-2.5 font-semibold">{t("col.runs")}</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">{t("col.connectors")}</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">{t("col.expectations")}</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <AgentsWorkforceRow
              key={agent.id}
              agent={agent}
              expanded={expandedId === agent.id}
              onToggle={() => setExpandedId((id) => (id === agent.id ? null : agent.id))}
              onChanged={onChanged}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
