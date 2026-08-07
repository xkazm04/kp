"use client";

// The AI-review card shell: header (tag + amount), CandidateHead, staleness +
// confidence chips, the per-kind body (DecisionsAiReviewCardBody) and the
// accept/reject actions. Parsing + derived flags live in
// decisionsAiReviewCardLogic.ts so this file stays under the 200-line cap.
import { useState } from "react";
import { Check, CheckSquare, CircleDollarSign, History, Search, Sparkles, Square, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { defaultOfferTtlDays } from "@/app/_lib/offer-policy";
import { CandidateHead, RecBadge } from "./DecisionsShared";
import { AiReviewCardBody } from "./DecisionsAiReviewCardBody";
import { useAiReviewCardLogic } from "./decisionsAiReviewCardLogic";
import type { Entry } from "@/app/features/shared/decisionsTypes";

export function AiReviewCard({
  entry,
  onAccept,
  onReject,
  // Batch multi-select (Direction 1): when the queue is in select mode AND this
  // card is eligible (offer_review is excluded — see DecisionsTab), the card
  // becomes a checkbox target and its per-card accept/reject buttons are
  // suppressed; the batch bar in the section header decides the cohort. Mirrors
  // the board's CandidateRow selectMode grammar (role=checkbox, glyph, coral wash).
  selectMode = false,
  selected = false,
  onToggleSelect,
  // Direction 1 (signals-at-the-click): open the SAME AnalysisSummaryModal the key
  // decisions use — the confidence band, weight-aware score breakdown and the
  // claimed-but-unproven bucket live there and were unreachable from these cards.
  // Absent (no candidate to inspect) → the affordance doesn't render.
  onInspect,
  // Direction 2 (queue-staleness) — the JD's last content-edit date when this
  // card's score predates it (server-derived in DecisionsTab via the shared
  // isScoreStale rule). Informs, never blocks; null → no chip.
  staleSince,
}: {
  entry: Entry;
  onAccept: (ttlDays?: number) => void;
  onReject: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onInspect?: () => void;
  staleSince?: string | null;
}) {
  const t = useTranslations("decisions.aiReview");
  const locale = useLocale();
  // Selectable exactly when the parent enabled select mode AND passed a toggle
  // (offer_review cards get no toggle, so they stay one-by-one even in select mode).
  const selecting = selectMode && Boolean(onToggleSelect);
  // The recruiter's deadline lever (offers-onboarding #3): a per-offer window in
  // whole days, defaulting to the deployment default. Sent with the accept that
  // extends the offer; the candidate's countdown then reflects it.
  const [ttlDays, setTtlDays] = useState<number>(defaultOfferTtlDays());
  // `unpriced` / `hasBand` — the honest-unpriced-offer state, derived in the logic
  // module (see the UNPRICED DRAFTS note there): an offer draft whose fail-safe
  // proposed no figure must show no figure, and no band meter without a band.
  const { parsed, isScorecard, isOffer, unpriced, hasBand, pricingBasis, isQueuedReject, isHumanScorecard, screeningConfidence, confidenceTone } =
    useAiReviewCardLogic(entry);
  const tag = isOffer
    ? t("tagOffer")
    : isQueuedReject
      ? t("tagQueuedReject")
      : isHumanScorecard
        ? t("tagHumanScorecard")
        : isScorecard
          ? t("tagScorecard")
          : t("tagScreening");
  const acceptLabel = isOffer ? t("acceptSendOffer") : isScorecard ? t("acceptToOffer") : t("acceptAdvance");

  return (
    <article
      className={`animate-fade-in rounded-lg border bg-white p-3 shadow-panel ${
        selecting && selected ? "border-coral ring-1 ring-coral/40" : "border-stone-200"
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        {selecting ? (
          <button
            type="button"
            onClick={onToggleSelect}
            role="checkbox"
            aria-checked={selected}
            title={t("select", { name: entry.candidateLabel })}
            className="focus-ring inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-coral"
          >
            {selected ? (
              <CheckSquare size={13} className="text-coral" aria-hidden />
            ) : (
              <Square size={13} className="text-steel" aria-hidden />
            )}{" "}
            {tag}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-coral">
            <Sparkles size={11} /> {tag}
          </span>
        )}
        {isOffer ? (
          unpriced ? (
            // No figure was proposed — say so, in the amber "needs your attention"
            // grammar this card already uses for the JD-staleness cue. The rationale
            // in the body carries the server's reason verbatim.
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-meta font-semibold text-amber-800"
              title={t("unpricedTitle")}
            >
              <CircleDollarSign size={11} aria-hidden /> {t("unpricedAmount")}
            </span>
          ) : (
            // P2-1 / Direction 2c — render only the unit the draft actually carries.
            // The server path deliberately refuses to fabricate a currency
            // (pipeline-entry-action.ts extendOffer), so the card must not invent
            // "CZK" either: an absent currency shows the bare amount, not a wrong unit.
            <span className="font-serif text-base text-ink">
              {Number(parsed?.recommended ?? 0).toLocaleString()}
              {parsed?.currency ? ` ${parsed.currency}` : ""}
            </span>
          )
        ) : (
          <RecBadge rec={parsed?.recommendation} confidence={isScorecard ? undefined : parsed?.confidence} />
        )}
      </div>
      <CandidateHead entry={entry} />

      {/* Direction 2 — "JD edited since this score" cue. Same amber History chip as
          the library roster + wave rows; informs, never blocks the decision. */}
      {staleSince ? (
        <span
          className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-meta font-semibold text-amber-800"
          title={t("jdEditedTitle", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(staleSince)) })}
        >
          <History size={11} aria-hidden /> {t("jdEditedBadge", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(staleSince)) })}
        </span>
      ) : null}

      {/* Direction 1 — compact confidence band. A thin meter + the number, colored
          by how sure the AI is of the verdict this card is about to commit. */}
      {screeningConfidence != null ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-meta uppercase tracking-wide text-steel">{t("confidenceLabel")}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200" role="img" aria-label={t("confidenceAria", { pct: screeningConfidence })}>
            <span className={`block h-full rounded-full ${confidenceTone}`} style={{ width: `${screeningConfidence}%` }} />
          </span>
          <span className="nums text-sm font-semibold text-ink">{t("confidencePct", { pct: screeningConfidence })}</span>
        </div>
      ) : null}

      {parsed ? (
        <AiReviewCardBody parsed={parsed} isOffer={isOffer} isScorecard={isScorecard} hasBand={hasBand} pricingBasis={pricingBasis} ttlDays={ttlDays} setTtlDays={setTtlDays} t={t} />
      ) : null}

      {/* Direction 1 — reach the full analysis (confidence band, score breakdown,
          claimed-but-unproven skills) before deciding. Available in select mode too,
          so a recruiter can inspect a card before adding it to a batch. */}
      {onInspect ? (
        <button
          type="button"
          onClick={onInspect}
          className="focus-ring mt-2 inline-flex items-center gap-1 text-sm font-semibold text-steel hover:text-coral"
        >
          <Search size={13} aria-hidden /> {t("viewAnalysis")}
        </button>
      ) : null}

      {/* In select mode the batch bar decides the cohort — the per-card buttons
          would be a second, conflicting path, so they're suppressed here. */}
      {selecting ? null : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            data-sim-click="accept"
            onClick={() => onAccept(isOffer ? ttlDays : undefined)}
            className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-moss text-base font-semibold text-white hover:opacity-90"
          >
            <Check size={16} /> {acceptLabel}
          </button>
          <button
            type="button"
            onClick={onReject}
            className="focus-ring inline-flex h-9 items-center justify-center gap-1 rounded-md border border-stone-200 px-3 text-base font-semibold text-coral hover:bg-coral/5"
          >
            <X size={16} /> {t("reject")}
          </button>
        </div>
      )}
    </article>
  );
}
