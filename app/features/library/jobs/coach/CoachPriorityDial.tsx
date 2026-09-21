"use client";

import { useTranslations } from "next-intl";
import { PRIORITY_LEVELS, type PriorityLevel } from "@/app/_lib/role-priorities";

// The three-notch priority dial — the one weight control in the ledger. It reads as
// ONE control with three positions rather than three separate switches, which is
// what won it over the chip row in the 2026-09 prototype round.
//
// Clicking the ACTIVE notch clears it. Untagged is a real state (nobody has weighed
// this pattern yet) and the recruiter must be able to get back to it; a control with
// no way out would force a judgement the ledger then feeds to the scorer as if it
// were one the recruiter meant.

/** The dot a notch paints, per level. Tokens only; ordered by how loudly it reads. */
export const LEVEL_DOT: Record<PriorityLevel, string> = {
  critical: "bg-coral",
  important: "bg-amber-500",
  minor: "bg-stone-400",
};

export function CoachPriorityDial({
  patternId,
  patternLabel,
  level,
  onChange,
}: {
  patternId: string;
  patternLabel: string;
  level: PriorityLevel | null;
  onChange: (patternId: string, level: PriorityLevel | null) => void;
}) {
  const t = useTranslations("jobs.coach");
  const labels: Record<PriorityLevel, string> = {
    critical: t("level.critical"),
    important: t("level.important"),
    minor: t("level.minor"),
  };
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-stone-200 p-0.5" role="group" aria-label={t("col.priority")}>
      {PRIORITY_LEVELS.map((lvl) => {
        const active = level === lvl;
        return (
          <button
            key={lvl}
            type="button"
            aria-pressed={active}
            aria-label={active ? t("clearLevelAria", { pattern: patternLabel }) : t("setLevelAria", { level: labels[lvl], pattern: patternLabel })}
            title={labels[lvl]}
            onClick={() => onChange(patternId, active ? null : lvl)}
            className={`focus-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded transition-colors ${
              active ? "bg-stone-100" : "hover:bg-stone-100"
            }`}
          >
            <span className={`rounded-full transition-all ${active ? `h-3.5 w-3.5 ${LEVEL_DOT[lvl]}` : "h-2 w-2 bg-stone-300"}`} aria-hidden />
          </button>
        );
      })}
    </span>
  );
}
