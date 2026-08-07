"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Send, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { buildTabSwitchUrl } from "@/app/features/shell/tabs";
import { LIVE_AGENT_STATUSES } from "./jobsAgentFitModel";
import { useAgentFitLogic } from "./jobsAgentFitLogic";
import { JobsAgentFitCoverage } from "./JobsAgentFitCoverage";
import { JobsAgentFitSpecPanel } from "./JobsAgentFitSpecPanel";
import { JobsAgentFitStatus } from "./JobsAgentFitStatus";

// The Agent fit tab of the job detail modal: assess which responsibilities of
// this role an AI agent could own (backgrounded transform → verdict + coverage),
// edit the resulting spec, dispatch it to Personas, and track the hire's status.

export function JobsAgentFitTab({ jobId }: { jobId: string }) {
  const t = useTranslations("agentFit");
  const router = useRouter();
  const search = useSearchParams();
  const logic = useAgentFitLogic(jobId);
  const { bridge, record, specLoading, specError, reloadSpec, agent, running, form } = logic;
  const paired = bridge?.paired === true;
  const agentLive = agent != null && LIVE_AGENT_STATUSES.includes(agent.status);

  return (
    <div className="space-y-4">
      {bridge && !paired ? (
        <div className={`${PANEL_SUNKEN} flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3`}>
          <p className="text-sm text-steel">{t("notConnected")}</p>
          <button
            type="button"
            onClick={() => router.push(buildTabSwitchUrl("integrations", search.toString()))}
            className="focus-ring text-sm font-semibold text-coral hover:underline"
          >
            {t("goToIntegrations")}
          </button>
        </div>
      ) : null}

      {agent ? (
        <JobsAgentFitStatus
          agent={agent}
          refreshing={logic.refreshing}
          refreshNote={logic.refreshNote}
          onRefresh={() => void logic.refresh()}
        />
      ) : null}

      {specLoading ? <div className="reveal-quiet min-h-[12rem]" aria-hidden /> : null}

      {specError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-base text-coral">{specError}</p>
          <button type="button" onClick={reloadSpec} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {running ? (
        <div className={`${PANEL_SUNKEN} p-4`}>
          <p className="flex items-center gap-2 text-base font-semibold text-ink">
            <Sparkles size={15} className="animate-pulse text-coral" aria-hidden /> {t("running")}
          </p>
          <p className="mt-1 text-sm text-steel">{logic.progressMsg ?? t("runningHint")}</p>
        </div>
      ) : null}

      {!specLoading && !specError && !record && !running ? (
        <div className={`${PANEL_SUNKEN} p-6 text-center`}>
          <Bot className="mx-auto text-moss" size={28} aria-hidden />
          <p className="mt-2 text-base font-semibold text-ink">{t("emptyTitle")}</p>
          <p className="mx-auto mt-1 max-w-lg text-sm text-steel">{t("emptyBody")}</p>
          <button type="button" onClick={() => void logic.run()} className={`${BTN_PRIMARY} mt-3 h-9 px-4 text-sm`}>
            <Sparkles size={14} aria-hidden /> {t("runCta")}
          </button>
        </div>
      ) : null}

      {(logic.startError || logic.taskError) && !running ? (
        <p role="alert" className="text-sm text-coral">
          {logic.startError ?? logic.taskError}
        </p>
      ) : null}

      {record && !running ? (
        <>
          <JobsAgentFitCoverage record={record} />
          {form ? (
            <JobsAgentFitSpecPanel
              form={form}
              record={record}
              catalog={logic.catalog}
              onPatch={logic.patchForm}
              onToggleConnector={logic.toggleFormConnector}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void logic.dispatch()}
              disabled={logic.dispatching || !paired || agentLive}
              className={`${BTN_PRIMARY} h-9 px-4 text-sm`}
            >
              <Send size={14} aria-hidden /> {logic.dispatching ? t("dispatching") : t("dispatchCta")}
            </button>
            <button type="button" onClick={() => void logic.run()} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
              {t("rerunCta")}
            </button>
            {!paired ? <p className="text-sm text-steel">{t("dispatchNeedsPairing")}</p> : null}
            {agentLive ? <p className="text-sm text-steel">{t("existingAgent")}</p> : null}
          </div>
          {logic.dispatchError ? (
            <p role="alert" className="text-sm text-coral">
              {logic.dispatchError}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
