"use client";

import { Check, Sparkles, X } from "lucide-react";
import { RATING_MAX } from "@/app/_lib/format";
import { CandidateHead, MiniList, RecBadge } from "./DecisionsShared";
import type { Entry, Offer, Scorecard, Screening } from "./DecisionsTypes";

// The 1..RATING_MAX rubric scale as an ascending array, for the per-competency
// dot strip — derived from the single source so re-gearing the rubric reshapes
// the dots too (no second [1,2,3,4,5] to chase).
const RATING_SCALE = Array.from({ length: RATING_MAX }, (_, i) => i + 1);

export function AiReviewCard({ entry, onAccept, onReject }: { entry: Entry; onAccept: () => void; onReject: () => void }) {
  let parsed: (Screening & Scorecard & Offer) | null = null;
  try {
    parsed = entry.approvalDetail ? (JSON.parse(entry.approvalDetail) as Screening & Scorecard & Offer) : null;
  } catch {
    parsed = null;
  }
  const kind = entry.approvalKind;
  const isScorecard = kind === "scorecard_review";
  const isOffer = kind === "offer_review";
  const tag = isOffer ? "Offer package" : isScorecard ? "Interview scorecard" : "AI screening";
  const acceptLabel = isOffer ? "Send offer" : isScorecard ? "To offer" : "Advance";

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
                band {Number(parsed.salaryMin ?? 0).toLocaleString()}–{Number(parsed.salaryMax ?? 0).toLocaleString()} {parsed.currency}
              </p>
              <p className="mt-1">{parsed.rationale}</p>
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
                  <MiniList title="Strengths" items={parsed.strengths ?? []} tone="green" />
                  <MiniList title="Red flags" items={parsed.redFlags ?? []} tone="red" />
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
          onClick={onAccept}
          className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-moss text-base font-semibold text-white hover:opacity-90"
        >
          <Check size={16} /> {acceptLabel}
        </button>
        <button
          type="button"
          onClick={onReject}
          className="focus-ring inline-flex h-9 items-center justify-center gap-1 rounded-md border border-stone-200 px-3 text-base font-semibold text-coral hover:bg-coral/5"
        >
          <X size={16} /> Reject
        </button>
      </div>
    </article>
  );
}
