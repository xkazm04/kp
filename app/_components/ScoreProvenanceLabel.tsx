"use client";

import { useTranslations } from "next-intl";
import { useDateFormat } from "@/app/_components/ui/useDateFormat";
import type { MatchScoreProvenance } from "@/app/_lib/match-score";

// The provenance half of the canonical match-score read path (REC-01 /
// OO-L2-10, see app/_lib/match-score.ts): every surface that shows THE match
// score names where the number came from — "from CV analysis · <date>" or
// "snapshot at add" — through this one label, so the wording can't drift
// between the decisions queue, the drawer and the board.

/** The localized provenance string (also usable inside `title` tooltips). */
export function useScoreProvenanceText(): (p: MatchScoreProvenance | null | undefined) => string | null {
  const t = useTranslations("scoreProvenance");
  const fmt = useDateFormat();
  return (p) => {
    if (!p) return null;
    if (p.source === "analysis") {
      const date = fmt.date(p.at, { fallback: p.at });
      return t("analysis", { date });
    }
    // ONE THREAD (gap 2): a transfer score is not a match snapshot, so it must not
    // borrow the snapshot wording — it names the assignment it came out of.
    if (p.source === "transfer") return t("transfer");
    return t("snapshot");
  };
}

export function ScoreProvenanceLabel({
  provenance,
  className = "text-meta text-steel",
}: {
  provenance: MatchScoreProvenance | null | undefined;
  className?: string;
}) {
  const text = useScoreProvenanceText()(provenance);
  if (!text) return null;
  return <span className={className}>{text}</span>;
}
