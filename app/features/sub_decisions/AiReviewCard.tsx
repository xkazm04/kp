"use client";

import { useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { RATING_MAX } from "@/app/_lib/format";
import { OFFER_TTL_DAYS_MIN, OFFER_TTL_DAYS_MAX, defaultOfferTtlDays } from "@/app/_lib/offer-policy";
import { CandidateHead, MiniList, RecBadge } from "./DecisionsShared";
import type { Entry, Offer, Scorecard, Screening } from "./DecisionsTypes";

// The 1..RATING_MAX rubric scale as an ascending array, for the per-competency
// dot strip — derived from the single source so re-gearing the rubric reshapes
// the dots too (no second [1,2,3,4,5] to chase).
const RATING_SCALE = Array.from({ length: RATING_MAX }, (_, i) => i + 1);

export function AiReviewCard({ entry, onAccept, onReject }: { entry: Entry; onAccept: (ttlDays?: number) => void; onReject: () => void }) {
  const t = useTranslations("decisions.aiReview");
  // The recruiter's deadline lever (offers-onboarding #3): a per-offer window in
  // whole days, defaulting to the deployment default. Sent with the accept that
  // extends the offer; the candidate's countdown then reflects it.
  const [ttlDays, setTtlDays] = useState<number>(defaultOfferTtlDays());
  let parsed: (Screening & Scorecard & Offer) | null = null;
  try {
    parsed = entry.approvalDetail ? (JSON.parse(entry.approvalDetail) as Screening & Scorecard & Offer) : null;
  } catch {
    parsed = null;
  }
  const kind = entry.approvalKind;
  const isScorecard = kind === "scorecard_review";
  const isOffer = kind === "offer_review";
  // ONE labeled pricing basis (OO-L2-10 / REC-01): the salary was priced by a
  // FRESH fit check at draft time — a different producer from the header's
  // canonical match score, so it renders under its own label, never as a second
  // bare "Match N/100". offer-v3 payloads carry it structured (matchBasis);
  // persisted offer-v2 drafts are recovered from their deterministic rationale
  // template ("Match N/100 places the offer…" — always template-generated, so
  // the parse is reliable); anything else falls back to the stored prose.
  const legacyBasis =
    isOffer && typeof parsed?.matchBasis !== "number" && typeof parsed?.rationale === "string"
      ? /^Match (\d+)\/100 /.exec(parsed.rationale)
      : null;
  const pricingBasis = isOffer
    ? typeof parsed?.matchBasis === "number"
      ? parsed.matchBasis
      : legacyBasis
        ? Number(legacyBasis[1])
        : null
    : null;
  // AUTO1 — a supervised-clock reject queued for ratification. Same screening
  // payload shape; the tag names what clicking Reject actually does (apply +
  // email the rejection) so the reviewer knows this card IS the adverse action.
  const isQueuedReject = kind === "rejection_review";
  // DEC1 — a human-conducted interview's scorecard reaches this queue too; the
  // tag names the source so the reviewer knows whose judgment they're ratifying.
  const isHumanScorecard = isScorecard && parsed?.source === "human";
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
    <article className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <div className="mb-1 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-coral">
          <Sparkles size={11} /> {tag}
        </span>
        {isOffer ? (
          <span className="font-serif text-base text-ink">
            {Number(parsed?.recommended ?? 0).toLocaleString()} {parsed?.currency ?? "CZK"}
          </span>
        ) : (
          <RecBadge rec={parsed?.recommendation} confidence={isScorecard ? undefined : parsed?.confidence} />
        )}
      </div>
      <CandidateHead entry={entry} />

      {parsed ? (
        <div className="mt-2 rounded-md border border-stone-200 bg-paper/50 p-2.5 text-sm text-ink">
          {isOffer ? (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-stone-200">
                <div
                  className="h-full rounded-full bg-moss"
                  style={{
                    width: `${Math.max(4, Math.min(100, ((Number(parsed.recommended) - Number(parsed.salaryMin)) / Math.max(1, Number(parsed.salaryMax) - Number(parsed.salaryMin))) * 100))}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-sm text-steel">
                {t("band", {
                  min: Number(parsed.salaryMin ?? 0).toLocaleString(),
                  max: Number(parsed.salaryMax ?? 0).toLocaleString(),
                  currency: String(parsed.currency ?? ""),
                })}
              </p>
              {/* See pricingBasis above — labeled, localized, one number with a named
                  producer. Only an unparseable payload falls back to raw prose. */}
              {pricingBasis != null ? (
                <p className="mt-1">
                  {t("pricingBasis", {
                    score: pricingBasis,
                    pct: Math.max(
                      0,
                      Math.min(
                        100,
                        Math.round(
                          ((Number(parsed.recommended) - Number(parsed.salaryMin)) /
                            Math.max(1, Number(parsed.salaryMax) - Number(parsed.salaryMin))) *
                            100
                        )
                      )
                    ),
                  })}
                </p>
              ) : (
                <p className="mt-1">{parsed.rationale}</p>
              )}
              <label className="mt-2 flex items-center gap-2 text-sm text-steel">
                <span>{t("deadlineLabel")}</span>
                <input
                  type="number"
                  min={OFFER_TTL_DAYS_MIN}
                  max={OFFER_TTL_DAYS_MAX}
                  value={ttlDays}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n)) setTtlDays(Math.min(OFFER_TTL_DAYS_MAX, Math.max(OFFER_TTL_DAYS_MIN, n)));
                  }}
                  aria-label={t("deadlineLabel")}
                  className="focus-ring w-16 rounded-md border border-stone-200 bg-white px-2 py-1 text-sm text-ink caret-coral"
                />
                <span>{t("deadlineDays")}</span>
              </label>
            </>
          ) : isScorecard ? (
            <>
              {parsed.summary ? <p className="mb-1.5">{parsed.summary}</p> : null}
              <ul className="space-y-1">
                {(parsed.ratings ?? []).slice(0, 4).map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <span className="truncate text-steel">{r.competency}</span>
                    <span className="flex shrink-0 gap-0.5">
                      {RATING_SCALE.map((n) => (
                        <span key={n} className={`h-1.5 w-1.5 rounded-full ${n <= r.rating ? "bg-moss" : "bg-stone-200"}`} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p>{parsed.rationale}</p>
              {parsed.strengths?.length || parsed.redFlags?.length ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <MiniList title={t("strengths")} items={parsed.strengths ?? []} tone="green" />
                  <MiniList title={t("redFlags")} items={parsed.redFlags ?? []} tone="red" />
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

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
    </article>
  );
}
