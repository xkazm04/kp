"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { META_LABEL, PANEL, STAT_LABEL, STAT_VALUE } from "@/app/_components/ui/recipes";
import { PRIORITY_LEVELS, type PriorityLevel } from "@/app/_lib/role-priorities";
import { LEVEL_DOT } from "./CoachPriorityChips";
import { sharePercent, usePatternCopy } from "./coachLabels";
import { projectPool, type RolePattern, type RolePriorityMap, type Winnability } from "./rolePatterns";

// VARIANT 3 — "Dial". One consequence, held at the top, that moves while you turn the
// dials: how many candidates would shortlist under the current weighting. The list is
// fixed in impact order (no sorting, no paging) because the point is not to browse the
// ledger but to watch one number answer to it.

export function CoachDial({
  patterns,
  priorities,
  win,
  onPriority,
}: {
  patterns: RolePattern[];
  priorities: RolePriorityMap;
  win: Winnability | null;
  onPriority: (patternId: string, level: PriorityLevel | null) => void;
}) {
  const t = useTranslations("jobs.coach");
  const copyOf = usePatternCopy(win);
  const base = win?.qualified ?? 0;
  const cap = win?.eligible ?? win?.poolSize ?? 0;
  const projection = useMemo(() => projectPool(patterns, priorities, base, cap), [patterns, priorities, base, cap]);
  const labels: Record<PriorityLevel, string> = {
    critical: t("level.critical"),
    important: t("level.important"),
    minor: t("level.minor"),
  };

  return (
    <div className="space-y-3">
      <div className={`${PANEL} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
        <div>
          <p className={STAT_LABEL}>{t("dial.projectedLabel")}</p>
          {/* aria-live: the whole point of this variant is that the number answers to
              a control elsewhere on the panel, which is invisible to a reader that
              only hears the button it just pressed. */}
          <p className={`${STAT_VALUE} text-ink`} aria-live="polite">
            {projection.projected}
          </p>
        </div>
        <p className="max-w-sm text-sm text-steel">
          {projection.contributing === 0
            ? t("dial.untouched", { base: projection.base })
            : t("dial.upperBound", { base: projection.base, n: projection.contributing })}
        </p>
      </div>

      <ul className="space-y-1.5">
        {patterns.map((p) => {
          const copy = copyOf(p);
          const pct = sharePercent(p);
          const level = priorities[p.id] ?? null;
          return (
            <li key={p.id} className={`${PANEL} flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2`}>
              <span className="flex-1 basis-56">
                <span className="block text-base text-ink">{copy.title}</span>
                <span className={`${META_LABEL} nums`}>
                  {pct === null ? t("noShare") : t("pct", { pct })}
                  {copy.gain > 0 ? ` · ${t("gain", { n: copy.gain })}` : ""}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-stone-200 p-0.5" role="group" aria-label={t("col.priority")}>
                {PRIORITY_LEVELS.map((lvl) => {
                  const active = level === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      aria-pressed={active}
                      aria-label={
                        active
                          ? t("clearLevelAria", { pattern: copy.title })
                          : t("setLevelAria", { level: labels[lvl], pattern: copy.title })
                      }
                      title={labels[lvl]}
                      onClick={() => onPriority(p.id, active ? null : lvl)}
                      className={`focus-ring inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded transition-colors ${
                        active ? "bg-stone-100" : "hover:bg-stone-100"
                      }`}
                    >
                      {/* A notch, not a letter: the dial reads as one control with
                          three positions rather than three separate switches. */}
                      <span
                        className={`rounded-full transition-all ${active ? `h-3.5 w-3.5 ${LEVEL_DOT[lvl]}` : "h-2 w-2 bg-stone-300"}`}
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
