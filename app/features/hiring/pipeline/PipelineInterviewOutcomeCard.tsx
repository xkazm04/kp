"use client";

// The candidate drawer's voice-interview outcome card: recommendation,
// coverage caveat, summary, ratings, read-back entities, telemetry strip, and
// the "view transcript" affordance. Split out of PipelineCandidateDrawer.tsx.

import { FileText, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { ReadbackEntitiesStrip } from "@/app/_components/results/interview/ReadbackEntitiesStrip";
import { rubricAnchorLine } from "@/app/_lib/interview-rubric";
import { useRubricStrings } from "@/app/_lib/use-rubric-strings";
import { RATING_MAX } from "@/app/_lib/format";
import { PipelineInterviewTelemetryStrip } from "./PipelineInterviewTelemetryStrip";
import type { InterviewOutcome } from "./usePipelineCandidateDrawerState";

const REC_STYLE: Record<string, string> = {
  advance: "bg-moss/15 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  reject: "bg-coral/10 text-coral",
};

export function PipelineInterviewOutcomeCard({
  ivOutcome,
  onShowTranscript,
}: {
  ivOutcome: InterviewOutcome;
  onShowTranscript: () => void;
}) {
  const t = useTranslations("pipeline.drawer");
  // Interview telemetry + coverage reuse the SAME localized catalog the transcript
  // modal renders, so the drawer's signals never fork their wording.
  const tTranscript = useTranslations("scheduleTab.transcript");
  const enumLabel = useEnumLabel();
  const rubricStrings = useRubricStrings();
  return (
    <div className="rounded-md border border-moss/40 bg-moss/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-moss">
          <Phone size={13} /> {t("interviewOutcome")}
        </p>
        {ivOutcome.recommendation ? (
          <span className={`rounded-full px-2 py-0.5 text-meta font-semibold uppercase ${REC_STYLE[ivOutcome.recommendation] ?? "bg-stone-100 text-steel"}`}>
            {enumLabel("recommendation", ivOutcome.recommendation)}
          </span>
        ) : null}
      </div>
      {/* Honest coverage caveat — only when head+tail sampling meant the
          scorer read less than the whole transcript (same wording + token
          as the transcript modal); nothing when coverage is complete. */}
      {ivOutcome.coverage ? (
        <p className="mt-2 rounded-md bg-dial-amber/15 px-2.5 py-1.5 text-sm text-ink">
          {tTranscript("coverageCaveat", { kept: ivOutcome.coverage.keptTurns, total: ivOutcome.coverage.totalTurns })}
        </p>
      ) : null}
      {ivOutcome.summary ? <p className="mt-1 text-sm text-ink">{ivOutcome.summary}</p> : null}
      {ivOutcome.ratings?.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {ivOutcome.ratings.slice(0, 6).map((r, i) => (
            <li key={i} className="text-sm text-ink">
              <span className="font-semibold nums text-coral">{r.rating}/{RATING_MAX}</span> {r.competency}
            </li>
          ))}
        </ul>
      ) : null}
      {ivOutcome.ratings?.length ? (
        <p className="mt-1 text-meta text-steel">{t("fixedRubric", { anchor: rubricAnchorLine(rubricStrings) })}</p>
      ) : null}
      {ivOutcome.entities ? <ReadbackEntitiesStrip entities={ivOutcome.entities} t={tTranscript} density="compact" /> : null}
      {ivOutcome.telemetry ? <PipelineInterviewTelemetryStrip telemetry={ivOutcome.telemetry} t={tTranscript} /> : null}
      {/* The full transcript was the interview chapter's only dead field —
          computed server-side, typed here, rendered nowhere. Surface it as
          an in-place action that opens the existing Schedule-tab modal
          stacked over the drawer (no tab trip). Only when one exists. */}
      {ivOutcome.hasTranscript ? (
        <button
          type="button"
          onClick={onShowTranscript}
          className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-semibold text-ink hover:border-coral/40"
        >
          <FileText size={13} className="text-coral" aria-hidden /> {t("viewTranscript")}
        </button>
      ) : null}
      <p className="mt-1.5 text-meta text-steel">{t("voiceFeedsNote")}</p>
    </div>
  );
}
