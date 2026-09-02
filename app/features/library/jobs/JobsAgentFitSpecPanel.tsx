"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { CHIP_QUIET, FIELD, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import type { AgentFitSpecRecord } from "@/app/_lib/db/agents";
import { metricsOf } from "@/app/features/agents-workforce/agentsWorkforceLogic";
import { budgetFromInput, type SpecForm } from "./jobsAgentFitModel";
import type { ConnectorCatalogView } from "./jobsAgentFitLogic";

// The editable spec half of the Agent fit tab: name, mission, connector chips
// (removable + re-addable from the bridge catalog), the monthly budget (null-safe
// against a band-less suggestion), and the success metrics. Metrics are shown
// read-only: POST /api/agents/dispatch always reads them from the stored spec, so
// offering an edit the server would drop would be a lie.

export function JobsAgentFitSpecPanel({
  form,
  record,
  catalog,
  onPatch,
  onToggleConnector,
}: {
  form: SpecForm;
  record: AgentFitSpecRecord;
  catalog: ConnectorCatalogView["connectors"];
  onPatch: (patch: Partial<SpecForm>) => void;
  onToggleConnector: (name: string) => void;
}) {
  const t = useTranslations("agentFit.spec");
  const ids = { name: useId(), mission: useId(), budget: useId(), addConnector: useId() };
  const [adding, setAdding] = useState(false);
  const budget = (record.budget ?? {}) as { suggestedMonthlyUsd?: number | null; rule?: string };
  const budgetInvalid = budgetFromInput(form.budget).invalid;
  const metrics = metricsOf(record.metrics);
  const addable = catalog.filter((c) => !form.connectors.includes(c.name));

  return (
    <div className={`${PANEL} p-4`}>
      <p className={META_LABEL}>{t("heading")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={ids.name} className={META_LABEL}>
            {t("nameLabel")}
          </label>
          <input
            id={ids.name}
            type="text"
            value={form.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            className={`${FIELD} mt-1 w-full`}
          />
        </div>
        <div>
          <label htmlFor={ids.budget} className={META_LABEL}>
            {t("budgetLabel")}
          </label>
          <input
            id={ids.budget}
            type="text"
            inputMode="decimal"
            value={form.budget}
            onChange={(e) => onPatch({ budget: e.target.value })}
            aria-invalid={budgetInvalid || undefined}
            className={`${FIELD} mt-1 w-full ${budgetInvalid ? "border-red-400" : ""}`}
          />
          <p className={`mt-1 text-sm ${budgetInvalid ? "text-red-500" : "text-steel"}`}>
            {budgetInvalid
              ? t("budgetInvalid")
              : typeof budget.suggestedMonthlyUsd === "number"
                ? t("budgetSuggested", { amount: budget.suggestedMonthlyUsd })
                : t("budgetNoSuggestion")}
            {budget.rule ? <span className="block text-stone-500">{budget.rule}</span> : null}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor={ids.mission} className={META_LABEL}>
          {t("missionLabel")}
        </label>
        <textarea
          id={ids.mission}
          value={form.mission}
          onChange={(e) => onPatch({ mission: e.target.value })}
          rows={3}
          className={`${FIELD} mt-1 w-full`}
        />
      </div>

      <div className="mt-3">
        <p className={META_LABEL}>{t("connectorsLabel")}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {form.connectors.map((name) => (
            <span key={name} className={`${CHIP_QUIET} inline-flex items-center gap-1`}>
              {name}
              <button
                type="button"
                onClick={() => onToggleConnector(name)}
                aria-label={t("removeConnector", { name })}
                className="focus-ring rounded-full text-steel hover:text-coral"
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
          {form.connectors.length === 0 ? <span className="text-sm text-steel">{t("noConnectors")}</span> : null}
          {addable.length > 0 ? (
            adding ? (
              <select
                id={ids.addConnector}
                aria-label={t("addConnector")}
                className={`${FIELD} py-1 text-sm`}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) onToggleConnector(e.target.value);
                  setAdding(false);
                }}
                onBlur={() => setAdding(false)}
              >
                <option value="" disabled>
                  {t("addConnector")}
                </option>
                {addable.map((c) => (
                  <option key={c.name} value={c.name} title={c.description}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="focus-ring inline-flex items-center gap-1 rounded-full border border-dashed border-stone-300 px-2.5 py-0.5 text-sm text-steel hover:border-coral/40 hover:text-ink"
              >
                <Plus size={12} aria-hidden /> {t("addConnector")}
              </button>
            )
          ) : null}
        </div>
      </div>

      {metrics.length > 0 ? (
        <div className="mt-3">
          <p className={META_LABEL}>{t("metricsLabel")}</p>
          <ul className="mt-1.5 space-y-1">
            {metrics.map((m) => (
              <li key={m.key} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink">{m.label}</span>
                <span className="shrink-0 text-steel nums">
                  {m.direction === "lte" ? "≤" : "≥"} {m.target} {m.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
