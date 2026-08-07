"use client";

// The drawer's AI-actions grid (screen / prep / scorecard / offer / outreach /
// rejection / rematch), filtered to the entry's current stage and status. Split
// out of PipelineCandidateDrawer.tsx.

import { Ban, Banknote, ClipboardList, Mail, Shuffle, Sparkles, UserCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { SCREENING_STAGES } from "@/app/_lib/pipeline-stages";
// The drawer's narrow Pick of the board record — this helper only reads stage and
// status, and typing it against the full board Entry would reject its only caller.
import type { Entry, Result, TaskId } from "./PipelineCandidateDrawerTypes";

const ACTIONS: { id: TaskId; label: string; icon: typeof Mail; stages: string[] | "all"; note?: string }[] = [
  // Screening is the triage gate for both pre-interview stages (SCREENING_STAGES):
  // at Accepted it screens a fresh applicant into Screened (or into Screened held
  // for review); at Screened it advances to Interview or holds. So the top of the
  // funnel — where triage volume is highest — is now individually actionable.
  { id: "screen", label: "Screen with AI", icon: UserCheck, stages: [...SCREENING_STAGES], note: "A confident pass advances the candidate; otherwise it holds for your review in Decisions." },
  { id: "prep", label: "Interview prep", icon: ClipboardList, stages: ["Screened", "Interview"] },
  { id: "scorecard", label: "Synthesize scorecard", icon: ClipboardList, stages: ["Interview"], note: "From your notes → a structured scorecard in Decisions." },
  { id: "offer", label: "Draft offer", icon: Banknote, stages: ["Offer"], note: "Salary from the role band, scaled by fit → an offer to approve in Decisions." },
  { id: "outreach", label: "Draft outreach", icon: Mail, stages: "all" },
  { id: "rejection", label: "Draft rejection", icon: Ban, stages: ["Accepted", "Screened", "Interview", "Offer"] },
  { id: "rematch", label: "Explore alternatives", icon: Shuffle, stages: ["Screened", "Interview", "Offer"] },
];

export function pipelineDrawerActionsFor(entry: Entry) {
  return ACTIONS.filter((act) => act.stages === "all" || act.stages.includes(entry.stage)).filter(
    (act) => entry.status === "active" || act.id === "rematch"
  );
}

export function PipelineAiActionsGrid({
  actions,
  busy,
  result,
  onRun,
}: {
  actions: typeof ACTIONS;
  busy: TaskId | null;
  result: Result | null;
  onRun: (task: TaskId) => void;
}) {
  const t = useTranslations("pipeline.drawer");
  const tActions = useTranslations("pipeline.actions");
  return (
    <div>
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
        <Sparkles size={13} /> {t("aiActions")}
      </p>
      <p className="mt-1 text-sm text-steel">{t("aiActionsNote")}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {actions.map((act) => (
          <button
            key={act.id}
            type="button"
            onClick={() => onRun(act.id)}
            disabled={busy !== null}
            className={`focus-ring flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
              result?.task === act.id ? "border-coral bg-coral/5 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
            }`}
          >
            <act.icon size={14} className="shrink-0 text-coral" />
            {busy === act.id ? t("working") : tActions(act.id)}
          </button>
        ))}
      </div>
    </div>
  );
}
