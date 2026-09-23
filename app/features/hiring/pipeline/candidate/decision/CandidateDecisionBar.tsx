"use client";

// The decision strip in the candidate modal — what the AI-review card's header and
// action row were, moved into the ONE place a candidate is looked at. Above the
// modal's footer: the recommendation's kind, what the AI proposes (its verdict, or
// the offer with its band and deadline), which engine wrote it, the JD-staleness
// cue, and the reviewer's accept / reject. The fit score is NOT repeated here — the
// Overview's Scorecard beside it is the canonical read of it.

import { useState } from "react";
import { Check, History, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import { BTN_AFFIRM } from "@/app/_components/ui/recipes";
import { defaultOfferTtlDays } from "@/app/_lib/offer-policy";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { AiReviewCardBody } from "@/app/features/hiring/decisions/DecisionsAiReviewCardBody";
import { useAiReviewCardLogic } from "@/app/features/hiring/decisions/decisionsAiReviewCardLogic";
import { RecBadge } from "@/app/features/hiring/decisions/DecisionsShared";
import type { CandidateDecision } from "./candidateDecision";

export function CandidateDecisionBar({ decision }: { decision: CandidateDecision }) {
  const t = useTranslations("decisions.aiReview");
  const tl = useTranslations("decisions.ledger");
  const n = useNumberFormat();
  const fmt = useDateFormat();
  const { entry, staleSince, onAccept, onReject, busy } = decision;
  const { parsed, isScorecard, isOffer, unpriced, hasBand, pricingBasis, isQueuedReject, isHumanScorecard, verdictSource, verdictProvider } =
    useAiReviewCardLogic(entry);
  const [ttlDays, setTtlDays] = useState<number>(defaultOfferTtlDays());
  const tag = isOffer ? t("tagOffer") : isQueuedReject ? t("tagQueuedReject") : isHumanScorecard ? t("tagHumanScorecard") : isScorecard ? t("tagScorecard") : t("tagScreening");
  const acceptLabel = isOffer ? t("acceptSendOffer") : isScorecard ? t("acceptToOffer") : t("acceptAdvance");

  return (
    <section aria-label={tl("decisionTitle")} className="shrink-0 border-t border-coral/30 bg-coral/5 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1 text-meta font-semibold uppercase tracking-wide text-coral">
          <Sparkles size={11} aria-hidden /> {tag}
        </span>
        {isOffer ? (
          unpriced ? (
            <span className="text-sm text-amber-800" title={t("unpricedTitle")}>
              {t("unpricedAmount")}
            </span>
          ) : (
            <span className="nums font-serif text-base text-ink">
              {n.grouped(Number(parsed?.recommended ?? 0))}
              {parsed?.currency ? ` ${parsed.currency}` : ""}
            </span>
          )
        ) : (
          <RecBadge rec={parsed?.recommendation} />
        )}
        {staleSince ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-meta font-semibold text-amber-800"
            title={t("jdEditedTitle", { date: fmt.date(staleSince) })}
          >
            <History size={11} aria-hidden /> {t("jdEditedBadge", { date: fmt.date(staleSince) })}
          </span>
        ) : null}
        {/* WHICH ENGINE wrote the verdict — a disclosure, never a self-assessment. */}
        {verdictSource === "template" ? (
          <span className="text-meta text-amber-800" title={t("engineTemplateTitle")}>
            <span className="font-semibold uppercase tracking-wide">{t("engineLabel")}</span> {t("engineTemplate")}
          </span>
        ) : verdictProvider ? (
          <span className="text-meta text-steel">
            <span className="font-semibold uppercase tracking-wide">{t("engineLabel")}</span> {t("engineLlm", { provider: verdictProvider })}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-sim-click="accept"
            onClick={() => onAccept(isOffer ? ttlDays : undefined)}
            disabled={busy}
            className={`${BTN_AFFIRM} h-9 cursor-pointer px-3 text-sm disabled:cursor-wait`}
          >
            <Check size={15} aria-hidden /> {acceptLabel}
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={busy}
            className="focus-ring inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-coral hover:bg-coral/5 disabled:cursor-wait disabled:opacity-50"
          >
            <X size={15} aria-hidden /> {t("reject")}
          </button>
        </span>
      </div>
      {/* The offer's band, pricing basis and deadline — decision-critical, so it stays with the buttons. */}
      {isOffer && parsed ? (
        <AiReviewCardBody entryId={entry.id} parsed={parsed} hasBand={hasBand} pricingBasis={pricingBasis} ttlDays={ttlDays} setTtlDays={setTtlDays} t={t} />
      ) : null}
    </section>
  );
}
