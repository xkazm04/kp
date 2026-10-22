"use client";

// ADR 0027 S3 - the evidence ladder on the candidate overview: how this candidate works
// with AI, rung by rung (watched in the case, defended in the debrief, quoted in the
// interview). Descriptive and read-only: no score, no total, nothing feeds the match, and
// it takes no action. The interview ratings come from the candidate bundle the modal has
// already loaded; the work-sample half is read through existing doors
// (useWorkSampleEvidence).

import { useTranslations } from "next-intl";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { defendedRung, quotedRung, watchedRung } from "@/app/_lib/evidence-ladder/ladder";
import type { HumanScorecardView } from "@/app/_lib/human-scorecard-set";
import type { InterviewOutcome } from "../state/useCandidateBundle";
import { DefendedRungView, QuotedRungView, RungFrame, WatchedRungView } from "./EvidenceLadderRungs";
import { useWorkSampleEvidence } from "./useWorkSampleEvidence";

export function EvidenceLadder({
  entryId,
  humanScorecards,
  aiInterview,
}: {
  entryId: string;
  humanScorecards: readonly HumanScorecardView[];
  aiInterview: InterviewOutcome | null;
}) {
  const t = useTranslations("evidenceLadder");
  const work = useWorkSampleEvidence(entryId);
  const quoted = quotedRung(humanScorecards, aiInterview);

  const workRung = (which: "watched" | "defended") => {
    if (work.status === "loading") return <LoadingGap className="h-12" label={t("loading")} />;
    if (work.status === "failed") return <p className="text-meta text-steel">{t("loadFailed")}</p>;
    const evaluated = work.evaluation !== null && typeof work.evaluation === "object";
    return which === "watched" ? (
      <WatchedRungView rung={watchedRung(work.submission, work.evaluation)} />
    ) : (
      <DefendedRungView rung={defendedRung(work.submission, evaluated, work.debrief)} />
    );
  };

  return (
    <section aria-labelledby={`evidence-ladder-${entryId}`} className="border-t border-stone-200 bg-white p-6">
      <h3 id={`evidence-ladder-${entryId}`} className="text-h3 font-semibold text-ink">
        {t("title")}
      </h3>
      <p className="mt-1 text-meta text-steel">{t("intro")}</p>
      <div className="mt-5 grid gap-6 md:grid-cols-3">
        <RungFrame rung="watched">{workRung("watched")}</RungFrame>
        <RungFrame rung="defended">{workRung("defended")}</RungFrame>
        <RungFrame rung="quoted">
          <QuotedRungView rung={quoted} />
        </RungFrame>
      </div>
      <p className="mt-5 text-micro text-steel">{t("gateNote")}</p>
    </section>
  );
}
