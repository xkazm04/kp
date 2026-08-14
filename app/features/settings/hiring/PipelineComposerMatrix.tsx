"use client";

// The hiring-pipeline composer's "Matrix" control board (winner of the
// /prototype round, 2026-08-10) — one row per station (Screening / Round 1..n
// / Offer), columns for mode, approval gating and cohort. Reads like an audit
// table: every human touchpoint is a visible cell, which is exactly how a
// governance-minded org thinks about its process. Quick-apply org-complexity
// presets sit above the table.
import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { COMPOSER_STATIONS, MAX_ROUNDS, newRound, PRESETS, type PipelinePlan, type PlanRound, type PresetId } from "./pipelineComposerModel";
import { GateToggle, KindToggle, TopNControl } from "./PipelineComposerBits";

export function PipelineComposerMatrix({ plan, onChange }: { plan: PipelinePlan; onChange: (p: PipelinePlan) => void }) {
  const t = useTranslations("hiringPlan");
  // Station rows name the BOARD's columns (enums.stage.*), not private words. The
  // fixed rows had their own copy — "Screening" / "Offer" — while the board drew
  // "Screened" / "Offer", so the two tables never looked like the same pipeline.
  const enumLabel = useEnumLabel();
  const stationLabel = (stageId: string | null, fallback: string) => (stageId ? enumLabel("stage", stageId) : fallback);
  const patchRound = (id: string, patch: Partial<PlanRound>) =>
    onChange({ ...plan, rounds: plan.rounds.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const presetLabel: Record<PresetId, string> = {
    lean: t("presetLean"),
    hybrid: t("presetHybrid"),
    enterprise: t("presetEnterprise"),
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-meta uppercase tracking-wide text-steel">{t("startFrom")}</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.plan())}
            className="focus-ring rounded-full border border-stone-200 px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
          >
            {presetLabel[p.id]}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-panel">
        <table className="w-full min-w-[44rem] border-collapse text-base">
          <thead>
            <tr className="border-b border-stone-200 bg-paper text-left text-meta uppercase text-steel">
              <th className="px-3 py-2 font-semibold">{t("colStation")}</th>
              <th className="px-3 py-2 font-semibold">{t("colMode")}</th>
              <th className="px-3 py-2 font-semibold">{t("colApproval")}</th>
              <th className="px-3 py-2 font-semibold">{t("colCohort")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-stone-100">
              <td className="px-3 py-2 font-semibold text-ink">
                {stationLabel(COMPOSER_STATIONS.screening, t("stationScreening"))}
              </td>
              <td className="px-3 py-2 text-sm text-steel">{t("modeAiAlways")}</td>
              <td className="px-3 py-2">
                <GateToggle compact value={plan.screeningGate} onChange={(v) => onChange({ ...plan, screeningGate: v })} />
              </td>
              <td className="px-3 py-2 text-sm text-steel">{t("cohortAllApplicants")}</td>
              <td />
            </tr>
            {plan.rounds.map((r, i) => (
              <tr key={r.id} className="border-b border-stone-100">
                {/* A round runs AT a board column; name it so the reader can find
                    the card there. Until P3 makes rounds and interview stages 1:1,
                    several rounds can share one column — the label says which. */}
                <td className="px-3 py-2 font-semibold text-ink">
                  {t("stationRound", { n: i + 1 })}
                  <span className="ml-1.5 font-normal text-sm text-steel">
                    {stationLabel(COMPOSER_STATIONS.interview[Math.min(i, COMPOSER_STATIONS.interview.length - 1)] ?? null, "")}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <KindToggle value={r.kind} onChange={(kind) => patchRound(r.id, { kind })} />
                </td>
                <td className="px-3 py-2">
                  {r.kind === "human" ? (
                    <span className="text-sm text-steel">{t("approvalScorecard")}</span>
                  ) : (
                    <GateToggle compact value={r.gate} onChange={(gate) => patchRound(r.id, { gate })} />
                  )}
                </td>
                <td className="px-3 py-2">
                  {i === 0 ? (
                    <span className="text-sm text-steel">{t("cohortScreenedIn")}</span>
                  ) : (
                    <TopNControl value={r.topN} onChange={(topN) => patchRound(r.id, { topN })} />
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onChange({ ...plan, rounds: plan.rounds.filter((x) => x.id !== r.id) })}
                    aria-label={t("removeRound", { n: i + 1 })}
                    className="focus-ring rounded-md p-1 text-steel hover:text-coral"
                  >
                    <X size={14} />
                  </button>
                </td>
              </tr>
            ))}
            <tr className="border-b border-stone-100">
              <td className="px-3 py-2 font-semibold text-ink">{stationLabel(COMPOSER_STATIONS.offer, t("stationOffer"))}</td>
              <td className="px-3 py-2 text-sm text-steel">{t("modeDraftedByAi")}</td>
              <td className="px-3 py-2">
                <GateToggle compact value={plan.offerGate} onChange={(v) => onChange({ ...plan, offerGate: v })} />
              </td>
              <td className="px-3 py-2 text-sm text-steel">{t("cohortFinalists")}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {plan.rounds.length < MAX_ROUNDS ? (
        <button
          type="button"
          onClick={() => onChange({ ...plan, rounds: [...plan.rounds, newRound(plan.rounds.length === 0 ? "ai" : "human")] })}
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-ink hover:border-coral/40"
        >
          <Plus size={13} className="text-coral" /> {t("addRound")}
        </button>
      ) : null}
    </div>
  );
}
