"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardCheck, Loader2, Quote, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { InterviewRecommendationBadge } from "@/app/_components/Badge";
import { Meter } from "@/app/_components/Meter";
import { RATING_MAX, ratingToPercent, ratingTone } from "@/app/_lib/format";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import type { Scorecard } from "@/app/_lib/interview-scorecard";
import type { VoiceTurn } from "@/app/_lib/voice/types";
import type { SchedEntry } from "./ScheduleTypes";

// Mirrors the /api/interview/by-entry response (a serialized InterviewSession):
// the transcript is the same canonical VoiceTurn[] the server persists and the
// browser produces, so the modal's row type can't drift from what it renders.
type Session = {
  provider?: string;
  status?: string;
  endedAt?: string | null;
  transcript?: VoiceTurn[] | null;
  scorecard?: Scorecard | null;
};

// Defense-in-depth at the trust boundary: latestInterviewByEntry returns the stored
// scorecard JSON verbatim (no per-rating validation), so a legacy row, a partial/
// failed synthesis, or a non-Python provider can carry a rating that is a string,
// null, or out of range. Coerce to a finite int clamped to [1, RATING_MAX]; return
// null ("Not assessed") for anything non-numeric so the meter and N/RATING_MAX label
// never render NaN. Mirrors the clamp already enforced on the Python path.
const cleanRating = (raw: unknown): number | null => {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(RATING_MAX, Math.max(1, Math.round(n)));
};

const normText = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

// Anchor a scorecard evidence quote to the transcript turn it came from (VOX3).
// The quote is usually a verbatim (or near-verbatim) candidate line, so prefer
// containment either way; otherwise fall back to the turn sharing the most
// distinctive words. Returns -1 when nothing matches well enough, so a
// paraphrased / synthesized quote isn't mis-anchored to an unrelated turn.
function findEvidenceTurn(evidence: string, turns: VoiceTurn[]): number {
  const e = normText(evidence);
  if (e.length < 8) return -1;
  for (let i = 0; i < turns.length; i++) {
    const t = normText(turns[i].text ?? "");
    if (t.length >= 8 && (t.includes(e) || e.includes(t))) return i;
  }
  const eWords = new Set(e.split(" ").filter((w) => w.length >= 4));
  if (eWords.size === 0) return -1;
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < turns.length; i++) {
    const tWords = normText(turns[i].text ?? "").split(" ").filter((w) => w.length >= 4);
    let shared = 0;
    for (const w of tWords) if (eWords.has(w)) shared += 1;
    const score = shared / eWords.size;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 0.5 ? best : -1; // require a majority of distinctive words to overlap
}

// A recruiter's human scorecard (PREP1), styled to read as the human counterpart
// to the AI one — same rubric layout (rating meters + evidence), coral-tinted so
// the two are never confused. Used both alongside an AI screen and on its own.
function HumanScorecardSection({ sc }: { sc: Scorecard }) {
  const t = useTranslations("scheduleTab.transcript");
  return (
    <section className="rounded-md border border-coral/30 bg-coral/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
          <ClipboardCheck size={13} className="text-coral" /> {t("humanScorecard")}
        </p>
        {sc.recommendation ? <InterviewRecommendationBadge rec={sc.recommendation} /> : null}
      </div>
      {sc.summary ? <p className="mt-1.5 text-base text-ink">{sc.summary}</p> : null}
      {sc.ratings && sc.ratings.length ? (
        <ul className="mt-2.5 space-y-2.5">
          {sc.ratings.map((r, i) => {
            const rating = cleanRating(r.rating);
            return (
              <li key={i} className="text-sm text-ink">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{r.competency}</span>
                  <span className="shrink-0 nums text-steel">{rating != null ? `${rating}/${RATING_MAX}` : t("notAssessed")}</span>
                </div>
                {rating != null ? (
                  <Meter value={ratingToPercent(rating)} tone={ratingTone(rating)} className="mt-1" aria-label={t("ratingAria", { competency: r.competency, rating, max: RATING_MAX })} />
                ) : null}
                {r.evidence ? <p className="mt-1 text-meta text-steel">{r.evidence}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="mt-2 text-meta text-steel">{t("humanScorecardNote")}</p>
    </section>
  );
}

export function InterviewTranscriptModal({ entry, onClose }: { entry: SchedEntry; onClose: () => void }) {
  const t = useTranslations("scheduleTab.transcript");
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
            <section className="rounded-md border border-stone-200 bg-paper p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-meta uppercase tracking-wide text-steel">{t("aiScorecard")}</p>
                {sc.recommendation ? <InterviewRecommendationBadge rec={sc.recommendation} /> : null}
              </div>
              {sc.summary ? <p className="mt-1.5 text-base text-ink">{sc.summary}</p> : null}
              {sc.ratings && sc.ratings.length ? (
                <ul className="mt-2.5 space-y-2.5">
                  {sc.ratings.map((r, i) => {
                    const rating = cleanRating(r.rating);
                    return (
                      <li key={i} className="text-sm text-ink">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold">{r.competency}</span>
                          <span className="shrink-0 nums text-steel">{rating != null ? `${rating}/${RATING_MAX}` : t("notAssessed")}</span>
                        </div>
                        {rating != null ? (
                          <Meter
                            value={ratingToPercent(rating)}
                            tone={ratingTone(rating)}
                            className="mt-1"
                            aria-label={t("ratingAria", { competency: r.competency, rating, max: RATING_MAX })}
                          />
                        ) : null}
                        {r.evidence ? (
                          evidenceTurns[i] >= 0 ? (
                            // Clickable: jump to the transcript turn this quote came
                            // from — "verify the AI in one click" at the Offer gate.
                            <button
                              type="button"
                              onClick={() => jumpToTurn(evidenceTurns[i])}
                              className="focus-ring mt-1 inline-flex items-start gap-1 rounded text-left text-meta text-steel hover:text-coral"
                              title={t("jumpToMoment")}
                            >
                              <Quote size={11} className="mt-0.5 shrink-0 text-coral/70" aria-hidden />
                              <span className="underline decoration-dotted underline-offset-2">{r.evidence}</span>
                            </button>
                          ) : (
                            <p className="mt-1 text-meta text-steel">{r.evidence}</p>
                          )
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <p className="mt-2 text-meta text-steel">{t("feedsReview")}</p>
            </section>
          ) : null}

          {humanSc ? <HumanScorecardSection sc={humanSc} /> : null}

          <section>
            <p className="text-meta uppercase tracking-wide text-steel">
              {t("transcriptHeading")} {session.provider ? `· ${session.provider}` : ""}
            </p>
            {transcript.length === 0 ? (
              <p className="mt-2 text-sm text-steel">{t("noTranscript")}</p>
            ) : (
              <div className="mt-2 space-y-2.5">
                {transcript.map((turn, i) => {
                  const highlighted = highlightIdx === i;
                  return (
                    <div key={i} id={`iv-turn-${i}`} className={turn.role === "candidate" ? "text-right" : ""}>
                      <p className="text-meta uppercase text-steel">
                        {turn.role === "candidate" ? t("roleCandidate") : turn.role === "interviewer" ? t("roleInterviewer") : t("roleSystem")}
                        {citedTurns.has(i) ? <span className="ml-1.5 text-coral" title={t("citedTitle")}>{t("cited")}</span> : null}
                      </p>
                      <p
                        className={`mt-0.5 inline-block max-w-[85%] rounded-lg px-3 py-2 text-base leading-6 transition-shadow ${
                          turn.role === "candidate" ? "bg-limewash text-ink" : "bg-paper text-ink"
                        } ${highlighted ? "ring-2 ring-coral" : ""}`}
                      >
                        {turn.text}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
