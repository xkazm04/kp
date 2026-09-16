"use client";

// VARIANT 3 — "Grid": a compact card per candidate, three or four to a row.
//
// The browsing variant. A table and a rung list are both ORDERED — the eye walks
// them top to bottom and rank 1 gets read the hardest. A grid is scanned, so a
// strong candidate at position 14 is seen, and it is the layout for "who is in
// this pool" rather than "who is top". One card carries a name, the score, two
// gap chips and the stage; nothing else fits, and pretending otherwise is how the
// old two-column cards grew to nine badges each.
//
// Cards are score-ordered and CAPPED, with the remainder counted rather than
// silently dropped — a grid that renders 40 of 120 and says nothing is the
// cut-slice-as-whole-pool shape this tab exists to avoid.

import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { CHIP_QUIET, PANEL } from "@/app/_components/ui/recipes";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { LadderRow, VariantProps } from "./candidatesModel";

/** How many cards a grid shows before it starts counting instead. Two full rows
 *  of four plus a third is what fits above the fold on a laptop; past that the
 *  Ladder is the honest tool and the footer says so. */
const GRID_CAP = 36;

export function CandidatesGrid({ rows, notEligible, opening, onOpen }: VariantProps) {
  const t = useTranslations("jobs.candidates");
  const shown = rows.slice(0, GRID_CAP);
  const hidden = rows.length - shown.length;

  return (
    <div>
      {rows.length === 0 ? (
        <p className="py-3 text-sm text-steel">{t("noneMatch")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((r) => (
            <Card key={r.id} r={r} busy={opening === r.id} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {hidden > 0 ? <p className="mt-2 text-sm text-steel">{t("gridMore", { count: hidden })}</p> : null}
      {notEligible.length > 0 ? (
        <details className="mt-3 rounded-md border border-stone-200 bg-paper/50 px-3 py-2">
          <summary className="focus-ring cursor-pointer text-sm font-semibold text-steel hover:text-ink">
            {t("band_notEligible")} · {notEligible.length}
          </summary>
          <ul className="mt-2 space-y-1">
            {notEligible.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-1.5 text-sm">
                <button
                  type="button"
                  onClick={() => onOpen(r.c)}
                  className="focus-ring cursor-pointer rounded font-medium text-ink hover:text-coral"
                >
                  {r.label}
                </button>
                {r.nearMiss ? (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-meta text-amber-800">{t("nearMiss")}</span>
                ) : null}
                <span className="text-steel">{r.koReasons.join("; ")}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Card({ r, busy, onOpen }: { r: LadderRow; busy: boolean; onOpen: VariantProps["onOpen"] }) {
  const t = useTranslations("jobs.candidates");
  const enumLabel = useEnumLabel();
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(r.c)}
        aria-busy={busy}
        className={`${PANEL} focus-ring flex w-full cursor-pointer flex-col gap-1.5 p-2.5 text-left transition-colors hover:border-coral/40`}
      >
        <span className="flex items-center gap-2">
          <span className="nums text-meta text-steel">{r.rank}</span>
          <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.label}</span>
          <ScoreBadge score={r.score} />
        </span>
        <span className="flex flex-wrap gap-1">
          {r.gaps.length === 0 ? (
            <span className="text-sm text-moss">{t("noGaps")}</span>
          ) : (
            r.gaps.map((s) => (
              <span key={s} className="rounded bg-red-50 px-1.5 py-0.5 text-meta text-red-700">{s}</span>
            ))
          )}
        </span>
        <span className="flex items-center">
          {r.stage ? (
            <span className={CHIP_QUIET}>{enumLabel("stage", r.stage)}</span>
          ) : (
            <span className="text-sm text-steel">{t("notFiled")}</span>
          )}
        </span>
      </button>
    </li>
  );
}
