"use client";

import { Bot, FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { BTN_SECONDARY, EYEBROW, INTRO, SECTION } from "@/app/_components/ui/recipes";
import { SectionTitle } from "@/app/_components/ui/SectionTitle";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { BridgeConfigPublic } from "@/app/_lib/agent-hire/bridge-store";
import type { AgentRosterEntry } from "./agentsWorkforceLogic";
import { AgentsWorkforceRoster } from "./AgentsWorkforceRoster";

// Agent-candidate bridge — the workforce module: every AI agent hired through a
// role, with live aggregates (runs, success, spend vs budget, connector use) and
// a client-computed "expectations met" verdict. Empty states are chain-aware:
// unconnected points at Settings → Integrations, connected-but-empty points at a
// job's Agent fit tab.

export function AgentsWorkforceTab() {
  const t = useTranslations("agentsWorkforce");
  const { data, error, reload } = useJsonFetch<{ agents: AgentRosterEntry[] }>("/api/agents", t("loadFailed"));
  const { data: bridgeData } = useJsonFetch<{ bridge: BridgeConfigPublic }>("/api/agents/bridge", t("loadFailed"));
  const paired = bridgeData?.bridge.paired === true;

  return (
    <section className={`stagger-children ${SECTION}`}>
      <header>
        <p className={EYEBROW}>{t("eyebrow")}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <SectionTitle>{t("title")}</SectionTitle>
          {/* This module is unfinished and reachable only behind
              NEXT_PUBLIC_KP_AGENT_HIRING (tabs.ts). The tag says so ON the surface,
              so a session that turned the flag on months ago cannot mistake it for
              a shipped feature — amber is the app's "attention / not settled" tone. */}
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-meta font-semibold text-amber-800">
            <FlaskConical size={11} aria-hidden /> {t("inDevelopment")}
          </span>
        </div>
        <p className={`mt-2 max-w-2xl ${INTRO}`}>{t("intro")}</p>
      </header>

      {error ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-base text-coral">{error}</p>
          <button type="button" onClick={reload} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {!data && !error ? <div className="reveal-quiet min-h-[16rem]" aria-hidden /> : null}

      {data && data.agents.length === 0 ? (
        bridgeData && !paired ? (
          <ChainEmptyState
            icon={Bot}
            title={t("emptyUnpairedTitle")}
            body={t("emptyUnpairedBody")}
            links={[{ tab: "integrations", label: t("emptyUnpairedLink") }]}
          />
        ) : (
          <ChainEmptyState
            icon={Bot}
            title={t("emptyNoneTitle")}
            body={t("emptyNoneBody")}
            links={[{ tab: "jobs", label: t("emptyNoneLink") }]}
          />
        )
      ) : null}

      {data && data.agents.length > 0 ? <AgentsWorkforceRoster agents={data.agents} onChanged={reload} /> : null}
    </section>
  );
}
