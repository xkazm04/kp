"use client";

// The ladder, as a side panel stuck to the candidate modal: the role's full ranked
// shortlist with this candidate highlighted, the salary expectation against the
// band, and the interview rubric dots. It is the card body the decisions queue used
// to render per card (DecisionsAiReviewCardLadder), now beside the whole candidate.
// Below `md` it folds under the tabs instead of beside them.

import { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { AiReviewCardLadder } from "@/app/features/hiring/decisions/DecisionsAiReviewCardLadder";
import { useAiReviewCardLogic } from "@/app/features/hiring/decisions/decisionsAiReviewCardLogic";
import type { CandidateDecision } from "./candidateDecision";

export function CandidateDecisionPanel({ decision }: { decision: CandidateDecision }) {
  const t = useTranslations("decisions.ledger");
  const { parsed, isScorecard, isOffer } = useAiReviewCardLogic(decision.entry);
  if (!parsed || isOffer) return null;
  return (
    <aside
      aria-label={t("ladderTitle")}
      // Stretches to the modal's full height beside the tabs; scrolls only when the
      // ladder is taller than that.
      className="min-h-0 shrink-0 overflow-y-auto border-t border-stone-200 bg-paper p-4 md:w-80 md:self-stretch md:border-l md:border-t-0"
    >
      <p className={META_LABEL}>{t("ladderTitle")}</p>
      <AiReviewCardLadder
        entry={decision.entry}
        parsed={parsed}
        isScorecard={isScorecard}
        peers={decision.peers}
        peerFacts={decision.peerFacts}
        unbounded
      />
    </aside>
  );
}
