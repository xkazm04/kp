"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { normalizeScorecardEntities, type Scorecard } from "@/app/_lib/interview-scorecard";
import type { InterviewTelemetry } from "@/app/_lib/interview-telemetry";
import type { ScorecardCoverage } from "@/app/_lib/interview-transcript";
import type { SchedEntry } from "./ScheduleTypes";
import { findEvidenceTurn, type Session } from "./scheduleInterviewTranscriptHelpers";
import { AiScorecardSection } from "./ScheduleInterviewAiScorecardSection";
import { HumanScorecardSection } from "./ScheduleInterviewHumanScorecardSection";
import { TranscriptTurns } from "./ScheduleInterviewTranscriptTurns";

export function InterviewTranscriptModal({ entry, onClose }: { entry: SchedEntry; onClose: () => void }) {
  const t = useTranslations("scheduleTab.transcript");
  const locale = useLocale(); // PREP3 — localize stored competency display
  // The shared hook captures a non-OK status / {error} body that the old bare
  // .then(r => r.json()) swallowed — a 500 now reads as an error rather than an
  // empty "no interview recorded" — and ignores results after unmount.
  const { data, error, reload } = useJsonFetch<{ session?: Session }>(
    `/api/interview/by-entry?entry=${encodeURIComponent(entry.id)}`,
    t("loadFailed")
  );
  const loading = data === null && error === null;
  const session = data?.session ?? null;

  // The recruiter's human scorecard (PREP1), if one was filled from the prep
  // rubric — shown beside the AI screen so a human-led round isn't invisible here.
  const { data: prepData } = useJsonFetch<{ prep?: { payload?: { humanScorecard?: Scorecard } } }>(
    `/api/interview-prep?entry=${encodeURIComponent(entry.id)}`,
    t("scorecardLoadFailed")
  );
  const humanSc = prepData?.prep?.payload?.humanScorecard ?? null;

  const sc = session?.scorecard ?? null;
  const transcript = session?.transcript ?? [];
  // Telemetry + scoring-coverage ride the AI scorecard object at runtime (see
  // interview-run.ts) but aren't in the pure Scorecard type — read them through a
  // narrow guard so absence degrades to nothing rather than empty chrome.
  const telemetry = (sc as { telemetry?: InterviewTelemetry } | null)?.telemetry ?? null;
  const coverage = (sc as { coverage?: ScorecardCoverage } | null)?.coverage ?? null;
  // The structured read-back (scorecard-v5) also rides the scorecard object; narrow
  // it through the shared guard so a malformed/legacy blob degrades to null (no chrome).
  const entities = normalizeScorecardEntities((sc as { entities?: unknown } | null)?.entities);

  // The transcript turn each rating's evidence quote came from (VOX3) + which turn
  // is currently highlighted by a click. Memoized on the loaded session so the
  // matching doesn't re-run every render.
  const [highlightIdx, setHighlightIdx] = useState<number | null>(null);
  const evidenceTurns = useMemo(() => {
    const ratings = session?.scorecard?.ratings ?? [];
    const turns = session?.transcript ?? [];
    return ratings.map((r) => (r.evidence ? findEvidenceTurn(r.evidence, turns) : -1));
  }, [session]);
  const citedTurns = useMemo(() => new Set(evidenceTurns.filter((i) => i >= 0)), [evidenceTurns]);
  const jumpToTurn = (idx: number) => {
    setHighlightIdx(idx);
    document.getElementById(`iv-turn-${idx}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <Modal title={t("title", { name: entry.candidateLabel })} subtitle={entry.jobTitle ?? undefined} onClose={onClose} size="3xl">
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-steel">
          <Loader2 size={16} className="animate-spin text-coral" /> {t("loading")}
        </p>
      ) : error ? (
        // Distinct failure state with a retry: a 500 / DB lock / parse error must
        // never read as the reassuring "no interview recorded" empty state below.
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-coral">
            <AlertTriangle size={15} /> {error}
          </p>
          <button
            type="button"
            onClick={reload}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 px-3 text-sm font-semibold text-ink hover:border-coral/40"
          >
            <RefreshCw size={14} /> {t("retry")}
          </button>
        </div>
      ) : !session ? (
        // No voice screen — but a recruiter may still have filed a human scorecard
        // (a human-led round), so show that rather than a bare empty state.
        humanSc ? (
          <div className="space-y-3">
            <HumanScorecardSection sc={humanSc} />
            <p className="text-sm text-steel">{t("noVoiceShowScorecard")}</p>
          </div>
        ) : (
          <p className="text-sm text-steel">{t("noInterview")}</p>
        )
      ) : (
        <div className="space-y-5">
          {sc ? (
            <AiScorecardSection
              sc={sc}
              coverage={coverage}
              entities={entities}
              telemetry={telemetry}
              evidenceTurns={evidenceTurns}
              jumpToTurn={jumpToTurn}
              t={t}
              locale={locale}
            />
          ) : null}

          {humanSc ? <HumanScorecardSection sc={humanSc} /> : null}

          <TranscriptTurns provider={session.provider} transcript={transcript} citedTurns={citedTurns} highlightIdx={highlightIdx} t={t} />
        </div>
      )}
    </Modal>
  );
}
