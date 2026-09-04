"use client";

// The "interviewed" section of ScheduleTab's aside: candidates who've moved
// past scheduling (voice transcript or human scorecard). Split out of
// ScheduleTab.tsx to keep the tab file under the 200-line cap.

import { useRouter, useSearchParams } from "next/navigation";
import { PANEL } from "@/app/_components/ui/recipes";
import { ArrowRight, ClipboardList, FileText, UserRound } from "lucide-react";
import type { useTranslations } from "next-intl";
import { buildUrl, clearedTabScopedParams } from "@/app/features/shell/tabs";
import { CandidateCardHeader } from "./ScheduleCandidateCardHeader";
import type { SchedEntry } from "./ScheduleTypes";
import type { IvStatus } from "./useScheduleTab";

export function ScheduleTabInterviewedList({
  t,
  interviewedEntries,
  interviews,
  prepared,
  onPrep,
  onTranscript,
}: {
  t: ReturnType<typeof useTranslations<"scheduleTab">>;
  interviewedEntries: SchedEntry[];
  interviews: Record<string, IvStatus>;
  prepared: Record<string, { createdAt: string; interviewer: string | null; hasHumanScorecard: boolean; stale: boolean }>;
  onPrep: (e: SchedEntry) => void;
  onTranscript: (e: SchedEntry) => void;
}) {
  const router = useRouter();
  const search = useSearchParams();

  if (!interviewedEntries.length) return null;

  return (
    <div className="mt-3 space-y-2">
      <h3 className="text-meta uppercase tracking-wide text-steel">
        {t("interviewed")} <span className="text-moss">· {interviewedEntries.length}</span>
      </h3>
      {interviewedEntries.map((e) => {
        // No voice transcript → the round was run by a recruiter (the saved
        // human scorecard is what admitted the card to this list).
        const humanLed = !interviews[e.id]?.hasTranscript;
        return (
          <div key={e.id} className={`${PANEL} p-2.5`}>
            <div className="flex w-full items-start gap-2">
              <CandidateCardHeader
                entry={e}
                trailing={
                  humanLed ? (
                    <span className="rounded bg-paper px-1.5 py-0.5 text-meta font-semibold uppercase tracking-wide text-steel">
                      {t("humanLedChip")}
                    </span>
                  ) : undefined
                }
              />
            </div>
            {prepared[e.id]?.interviewer ? (
              <p className="mt-1.5 flex items-center gap-1 truncate text-meta text-steel" title={t("interviewerTitle", { name: prepared[e.id]!.interviewer! })}>
                <UserRound size={11} className="shrink-0 text-coral" /> {prepared[e.id]!.interviewer}
              </p>
            ) : null}
            {humanLed ? null : (
              <button
                type="button"
                onClick={() => onTranscript(e)}
                className="focus-ring mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-moss/40 bg-moss/5 text-sm font-semibold text-moss hover:bg-moss/10"
              >
                <FileText size={14} /> {t("viewTranscriptScorecard")}
              </button>
            )}
            {/* The prep modal stays reachable after the round completes — it is
                the ONLY surface for the interviewer's notes and the human
                scorecard (interview-prep-rubric #2). */}
            <button
              type="button"
              onClick={() => onPrep(e)}
              className={`focus-ring ${humanLed ? "mt-2" : "mt-1.5"} inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 text-sm font-semibold text-ink hover:border-coral/40`}
            >
              <ClipboardList size={14} className="text-coral" /> {t("prepScorecard")}
            </button>
            {/* Reverse handoff (Schedule → Decisions): the finished
                interview's scorecard_review gate lives on Decisions —
                pull the recruiter there, scoped to this role. */}
            <button
              type="button"
              onClick={() =>
                router.push(
                  buildUrl({ tab: "decisions", ...clearedTabScopedParams(), job: e.jobId }, search.toString())
                )
              }
              className="focus-ring mt-1.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-stone-200 text-sm font-semibold text-ink hover:border-coral/40"
            >
              {t("reviewScorecard")} <ArrowRight size={13} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
