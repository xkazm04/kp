"use client";

// The AI-review card shell: header (tag + amount), CandidateHead, the staleness
// chip and the model's labelled self-report, the per-kind body
// (DecisionsAiReviewCardBody) and the accept/reject actions. Parsing + derived
// flags live in decisionsAiReviewCardLogic.ts so this file stays under the
// 200-line cap.
import { useState } from "react";
import { Check, CheckSquare, CircleDollarSign, History, Search, Sparkles, Square, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { defaultOfferTtlDays } from "@/app/_lib/offer-policy";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { useScoreProvenanceText } from "@/app/_components/ScoreProvenanceLabel";
import { canonicalScoreOf, provenanceOf } from "@/app/_lib/match-score";
import { CandidateHead, RecBadge } from "./DecisionsShared";
import { AiReviewCardBody } from "./DecisionsAiReviewCardBody";
import { useAiReviewCardLogic } from "./decisionsAiReviewCardLogic";
import { AiReviewCardLadder } from "./DecisionsAiReviewCardLadder";
import type { JobPeerContext, PeerScore } from "./decisionsPeerCompare";
import type { Entry } from "@/app/features/shared/decisionsTypes";
import { BTN_AFFIRM } from "@/app/_components/ui/recipes";

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
  // Peer context for the Ladder body (winner of the /prototype round):
  // same-job active peers with their canonical scores (client-derived from the
  // pipeline payload) + the salary/skills facts served by
  // GET /api/decisions/peer-context. Offer cards ignore both — their
  // band+deadline body is decision-critical, not prose.
  peers = [],
  peerFacts = null,
}: {
  entry: Entry;
  onAccept: (ttlDays?: number) => void;
  onReject: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onInspect?: () => void;
  staleSince?: string | null;
  peers?: PeerScore[];
  peerFacts?: JobPeerContext | null;
}) {
  const t = useTranslations("decisions.aiReview");
  const locale = useLocale();
  // The offer amount renders in the APP's locale, not the browser/OS one — the same
  // rule the date chips below already follow (and `ranWhen` in groupEval spells out).
  // A bare `toLocaleString()` made a cs workspace opened in an en-US browser show
  // "45,000" on the approval card while the candidate's own offer page showed
  // "45 000" (OfferClient threads the locale), and made the figure differ between
  // the server render and the client one.
  const n = useNumberFormat();
  // The ONE fit number on this card (REC-01 / OO-L2-10), still resolved through the
  // canonical read path — it just renders HERE now, in the header corner beside the
  // verdict, instead of inside CandidateHead where it squeezed the role line. Its
  // provenance is no longer a printed label ("snapshot at add" cost a line on every
  // card); it rides the badge's tooltip, so the number still says where it came from
  // when asked.
  const score = canonicalScoreOf(entry);
  const provenanceText = useScoreProvenanceText()(provenanceOf(entry));
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
  // `modelSelfReport` is deliberately NOT destructured: the model's own 0-100
  // rating of its verdict no longer renders on this card. Nothing had measured it
  // against an outcome, so it added a number a reviewer could weigh but not check;
  // the MEASURED confidence band still lives one click away in the full analysis
  // (onInspect). The derivation stays in the logic module under its guard —
  // app/features/shared/confidence-vocabulary.test.ts. `verdictSource` /
  // `verdictProvider` are a different thing entirely and still render: WHICH ENGINE
  // wrote the verdict is a disclosure, not a self-assessment.
  const { parsed, isScorecard, isOffer, unpriced, hasBand, pricingBasis, isQueuedReject, isHumanScorecard, verdictSource, verdictProvider } =
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
      <div className="mb-1.5 flex items-start justify-between gap-2">
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
        {/* The header corner: what the AI proposes (or the money, on an offer) and
            how well this person fits, in that order, with the score in the corner
            itself. */}
        <span className="flex shrink-0 items-center gap-1.5">
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
                {n.grouped(Number(parsed?.recommended ?? 0))}
                {parsed?.currency ? ` ${parsed.currency}` : ""}
              </span>
            )
          ) : (
            // UAT KAT-L1-004 — the badge no longer carries the model's self-reported
            // number as a bare "· 87%" suffix. The verdict word is what the badge is for.
            <RecBadge rec={parsed?.recommendation} />
          )}
          {score != null ? (
            <span title={provenanceText ?? undefined}>
              <ScoreBadge score={score} />
            </span>
          ) : null}
        </span>
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

      {/* WHICH ENGINE WROTE THIS — the template-verdict disclosure (automation-run.ts
          stamps `verdictSource` on every approval payload it writes). The automation
          degrades to deterministic templates on a keyless install, past the
          ai_candidates allowance, or when a call fails — a product property, and one
          the card used to hide: a template verdict rendered under the same "AI review"
          tag, in the same grammar, as a model's. Same disclosure rule as the analysis
          report's engine note, and the label LEADS (G1 — the disclosure is the
          headline, never a footnote). An approval with no recorded provenance shows
          nothing at all rather than asserting an engine nobody recorded. */}
      {verdictSource === "template" ? (
        <p className="mt-2 text-meta leading-4 text-amber-800" title={t("engineTemplateTitle")}>
          <span className="font-semibold uppercase tracking-wide">{t("engineLabel")}</span> <span className="font-semibold">{t("engineTemplate")}</span>
          <span className="mt-0.5 block text-steel">{t("engineTemplateNote")}</span>
        </p>
      ) : verdictProvider ? (
        <p className="mt-2 text-meta leading-4 text-steel">
          <span className="font-semibold uppercase tracking-wide">{t("engineLabel")}</span>{" "}
          <span className="font-semibold text-ink">{t("engineLlm", { provider: verdictProvider })}</span>
        </p>
      ) : null}

      {/* Offer cards keep the band + deadline body (decision-critical); every
          other kind renders the Ladder — the AI's prose lives in the
          Full-analysis modal (AiNarrative), one click away via onInspect. */}
      {parsed ? (
        isOffer ? (
          <AiReviewCardBody parsed={parsed} hasBand={hasBand} pricingBasis={pricingBasis} ttlDays={ttlDays} setTtlDays={setTtlDays} t={t} />
        ) : (
          <AiReviewCardLadder entry={entry} parsed={parsed} isScorecard={isScorecard} peers={peers} peerFacts={peerFacts} />
        )
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
            className={`${BTN_AFFIRM} h-9 flex-1 justify-center text-base`}
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
