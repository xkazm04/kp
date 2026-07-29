"use client";

// The AI review card's per-kind detail block (offer salary band + deadline
// lever / scorecard rating dots / screening rationale + strengths-redFlags).
// Split out of DecisionsAiReviewCard so the card shell stays under 200 lines.
import { useTranslations } from "next-intl";
import { RATING_MAX } from "@/app/_lib/format";
import { OFFER_TTL_DAYS_MIN, OFFER_TTL_DAYS_MAX } from "@/app/_lib/offer-policy";
import { MiniList } from "./DecisionsShared";
import type { ParsedApproval } from "./decisionsAiReviewCardLogic";

// The 1..RATING_MAX rubric scale as an ascending array, for the per-competency
// dot strip — derived from the single source so re-gearing the rubric reshapes
// the dots too (no second [1,2,3,4,5] to chase).
const RATING_SCALE = Array.from({ length: RATING_MAX }, (_, i) => i + 1);

export function AiReviewCardBody({
  parsed,
  isOffer,
  isScorecard,
  hasBand,
  pricingBasis,
  ttlDays,
  setTtlDays,
  t,
}: {
  parsed: ParsedApproval;
  isOffer: boolean;
  isScorecard: boolean;
  // honest-unpriced-offer — whether this draft actually carries BOTH salary
  // bounds. Derived in decisionsAiReviewCardLogic.ts; false on the fail-safe
  // drafts that deliberately propose no figure.
  hasBand: boolean;
  pricingBasis: number | null;
  ttlDays: number;
  setTtlDays: (n: number) => void;
  t: ReturnType<typeof useTranslations<"decisions.aiReview">>;
}) {
  return (
    <div className="mt-2 rounded-md border border-stone-200 bg-paper/50 p-2.5 text-sm text-ink">
      {isOffer ? (
        <>
          {/* The meter and the band caption are a POSITION-WITHIN-A-BAND readout;
              with no band they'd be a 0–0 rail with the marker pinned at the floor.
              Rendered only when the draft actually carries min AND max. */}
          {hasBand ? (
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
            </>
          ) : (
            <p className="rounded-md border border-dashed border-stone-300 px-2 py-1.5 text-sm text-steel">{t("noBand")}</p>
          )}
          {/* See pricingBasis in decisionsAiReviewCardLogic.ts — labeled, localized,
              one number with a named producer. The "~N% of the band" phrasing is
              meaningless without a band, so an unpriced draft falls through to the
              server's rationale, which names the uncalibrated market and what the
              approver must do. */}
          {pricingBasis != null && hasBand ? (
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
  );
}
