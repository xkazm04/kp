"use client";

// VARIANT 2 — "Rungs": the ladder as a ladder.
//
// Where the table answers "who is 7th", this answers "how is this pool SHAPED".
// The rungs are grouped into score bands (strong / promising / weak / not
// eligible), each band wearing its count and a bar of its share, so the first
// thing read is the distribution — four strong, thirty weak is a sourcing
// problem, and a ranked table hides it behind a scrollbar.
//
// Inside a band every candidate is ONE line: name, score, and the single gap
// sentence that explains the score. The not-eligible band starts collapsed —
// present, countable and openable, never deleted.

import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { CHIP_QUIET } from "@/app/_components/ui/recipes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { bandShare, groupByBand, type LadderRow, type ScoreBand, type VariantProps } from "./candidatesModel";

// Band → the token-mapped fill of its share bar. Score tones, so a band reads the
// same colour language as the badge on every rung inside it.
const BAND_BAR: Record<ScoreBand, string> = {
  strong: "bg-score-strong",
  mid: "bg-score-mid",
  weak: "bg-score-weak",
  notEligible: "bg-steel",
};

export function CandidatesRungs({ rows, notEligible, opening, onOpen }: VariantProps) {
  const t = useTranslations("jobs.candidates");
  const groups = groupByBand([...rows, ...notEligible]);
  const total = rows.length + notEligible.length;

  if (total === 0) return <p className="py-3 text-sm text-steel">{t("noneMatch")}</p>;

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <details key={g.band} open={g.band !== "notEligible"} className="rounded-md border border-stone-200 bg-white">
          <summary className="focus-ring flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
            <span className="text-sm font-semibold text-ink">{t(`band_${g.band}`)}</span>
            <span className="nums text-sm text-steel">{t("bandCount", { count: g.rows.length })}</span>
            <span aria-hidden className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-stone-100 sm:w-48">
              <span className={`block h-full ${BAND_BAR[g.band]}`} style={{ width: `${bandShare(g.rows.length, total)}%` }} />
            </span>
          </summary>
          <ul className="border-t border-stone-100">
            {g.rows.map((r) => (
              <Rung key={r.id} r={r} busy={opening === r.id} onOpen={onOpen} />
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

function Rung({ r, busy, onOpen }: { r: LadderRow; busy: boolean; onOpen: VariantProps["onOpen"] }) {
  const t = useTranslations("jobs.candidates");
  const enumLabel = useEnumLabel();
  // The one-line "why": the KO reasons when it was excluded, the missing skills
  // when it was not, and an honest blank when the engine listed neither.
  const why = !r.eligible ? r.koReasons.join("; ") : r.gaps.length > 0 ? t("gapsInline", { gaps: r.gaps.join(", ") }) : "";
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(r.c)}
        aria-busy={busy}
        className="focus-ring flex w-full cursor-pointer flex-wrap items-center gap-2 border-b border-stone-100 px-3 py-1.5 text-left last:border-b-0 hover:bg-paper"
      >
        {r.eligible ? <span className="nums w-6 shrink-0 text-sm text-steel">{r.rank}</span> : null}
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.label}</span>
        {r.nearMiss ? (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-meta text-amber-800">{t("nearMiss")}</span>
        ) : null}
        {r.stage ? <span className={CHIP_QUIET}>{enumLabel("stage", r.stage)}</span> : null}
        <ScoreBadge score={r.score} />
        {why ? <span className="w-full text-sm text-steel sm:w-auto sm:basis-full">{why}</span> : null}
      </button>
    </li>
  );
}
