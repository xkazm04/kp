"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { BTN_SECONDARY, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import { STATUS_BADGE, type AgentRosterEntry } from "@/app/features/agents-workforce/agentsWorkforceLogic";
import { timeline } from "./jobsAgentFitModel";

// The hiring-status half of the Agent fit tab: the dispatched → pending approval
// (in Personas) → onboarding → active ladder, terminal errors called out, and
// the pull-fallback Refresh (POST /api/agents/[id]/refresh).

export function JobsAgentFitStatus({
  agent,
  refreshing,
  refreshNote,
  onRefresh,
}: {
  agent: AgentRosterEntry;
  refreshing: boolean;
  refreshNote: string | null;
  onRefresh: () => void;
}) {
  const t = useTranslations("agentFit.status");
  const ta = useTranslations("agentsWorkforce.status");
  const { steps, terminal } = timeline(agent.status);
  const badge = STATUS_BADGE[agent.status];

  return (
    <div className={`${PANEL} p-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <p className={META_LABEL}>{t("heading")}</p>
        <Badge tone={badge.tone} label={ta(badge.key as Parameters<typeof ta>[0])} />
        {agent.personaName ? <span className="text-sm text-steel">{agent.personaName}</span> : null}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className={`${BTN_SECONDARY} ml-auto h-8 px-3 text-sm`}
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} aria-hidden />
          {refreshing ? t("refreshing") : t("refresh")}
        </button>
      </div>

      <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-center gap-2">
            {i > 0 ? <span aria-hidden className="h-px w-4 bg-stone-300" /> : null}
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm ${
                step.state === "current"
                  ? "border-coral bg-coral/10 font-semibold text-coral"
                  : step.state === "done"
                    ? "border-moss/40 bg-moss/10 text-moss"
                    : "border-stone-200 text-steel"
              }`}
            >
              {step.state === "done" ? <span aria-hidden>{"✓"}</span> : null}
              {t(`step.${step.key}` as Parameters<typeof t>[0])}
            </span>
          </li>
        ))}
      </ol>

      {agent.status === "pending_approval" ? <p className="mt-2 text-sm text-steel">{t("approveHint")}</p> : null}

      {terminal ? (
        <p
          role="status"
          className={`mt-2 rounded-lg border p-3 text-sm ${
            terminal === "retired"
              ? "border-stone-200 bg-stone-50 text-steel"
              : "border-red-300 bg-red-50 text-red-700"
          }`}
        >
          {t(`terminal.${terminal}` as Parameters<typeof t>[0])}
        </p>
      ) : null}

      {refreshNote ? (
        <p role="status" className="mt-2 text-sm text-steel">
          {refreshNote}
        </p>
      ) : null}
    </div>
  );
}
