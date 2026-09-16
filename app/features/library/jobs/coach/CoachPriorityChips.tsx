"use client";

import { useTranslations } from "next-intl";
import { CHIP_TOGGLE } from "@/app/_components/ui/recipes";
import { PRIORITY_LEVELS, type PriorityLevel } from "@/app/_lib/role-priorities";

// The three-state weight control shared by the Ledger's priority cell. The Stack moves
// patterns between lanes and the Dial turns a notched dial instead, so this is
// deliberately NOT "the" priority control — it is the one shape that fits inside a
// table cell.
//
// Clicking the ACTIVE level clears it. Untagged is a real state (nobody has weighed
// this pattern yet) and the recruiter must be able to get back to it; a control with
// no way out would force a judgement the ledger then feeds to the scorer as if it
// were one the recruiter meant.

/** Per-level accent, tokens only. Ordered by how loudly the level should read. */
export const LEVEL_ACCENT: Record<PriorityLevel, string> = {
  critical: "text-coral",
  important: "text-amber-700",
  minor: "text-steel",
};

/** The dot a lane header / dial notch paints. Background twins of LEVEL_ACCENT. */
export const LEVEL_DOT: Record<PriorityLevel, string> = {
  critical: "bg-coral",
  important: "bg-amber-500",
  minor: "bg-stone-400",
};

export function CoachPriorityChips({
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
    <span className="inline-flex flex-wrap items-center gap-1">
      {PRIORITY_LEVELS.map((lvl) => {
        const active = level === lvl;
        return (
          <button
            key={lvl}
            type="button"
            aria-pressed={active}
            aria-label={
              active ? t("clearLevelAria", { pattern: patternLabel }) : t("setLevelAria", { level: labels[lvl], pattern: patternLabel })
            }
            onClick={() => onChange(patternId, active ? null : lvl)}
            className={`${CHIP_TOGGLE(active)} cursor-pointer px-2 py-0.5 ${active ? "" : LEVEL_ACCENT[lvl]}`}
          >
            {labels[lvl]}
          </button>
        );
      })}
    </span>
  );
}
