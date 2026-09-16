"use client";

import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { PRIORITY_LEVELS, type PriorityLevel } from "@/app/_lib/role-priorities";
import { LEVEL_DOT } from "./CoachPriorityChips";
import { sharePercent, usePatternCopy } from "./coachLabels";
import { laneWeight, patternsInLane, type RolePattern, type RolePriorityMap, type Winnability } from "./rolePatterns";

// VARIANT 2 — "Stack". Sorting, not reading: the patterns start in an inbox strip and
// the recruiter pushes each one left or right until every lane holds what it should.
// The lane headers carry the SUMMED weight, so the shape of the decision ("I have made
// nine things critical") is visible without counting rows.

/** Where ← and → send a card. The order is the lane order, and the ends are dead: an
 *  arrow that wrapped around would move a card the recruiter meant to leave alone. */
const ORDER: readonly (PriorityLevel | null)[] = [null, "minor", "important", "critical"];

function neighbour(level: PriorityLevel | null, step: -1 | 1): PriorityLevel | null | undefined {
  const i = ORDER.indexOf(level);
  const next = i + step;
  return next >= 0 && next < ORDER.length ? ORDER[next] : undefined;
}

export function CoachStack({
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
  const labels: Record<PriorityLevel, string> = {
    critical: t("level.critical"),
    important: t("level.important"),
    minor: t("level.minor"),
  };

  const card = (p: RolePattern, level: PriorityLevel | null) => {
    const copy = copyOf(p);
    const pct = sharePercent(p);
    const left = neighbour(level, -1);
    const right = neighbour(level, 1);
    const arrow =
      "focus-ring inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-stone-200 text-steel transition-colors hover:border-coral/40 hover:text-coral disabled:cursor-default disabled:opacity-30 disabled:hover:border-stone-200 disabled:hover:text-steel";
    return (
      <li key={p.id} className={`${PANEL} space-y-1.5 px-2.5 py-2`}>
        <p className="text-sm text-ink">{copy.title}</p>
        <p className="text-sm text-steel nums">{pct === null ? t("noShare") : t("pct", { pct })}</p>
        <div className="flex items-center justify-between gap-1">
          <button
            type="button"
            className={arrow}
            disabled={left === undefined}
            aria-label={t("moveLeftAria", { pattern: copy.title })}
            onClick={() => left !== undefined && onPriority(p.id, left)}
          >
            <ChevronLeft size={14} aria-hidden />
          </button>
          {copy.gain > 0 ? <span className="text-sm font-semibold text-moss nums">{t("gain", { n: copy.gain })}</span> : null}
          <button
            type="button"
            className={arrow}
            disabled={right === undefined}
            aria-label={t("moveRightAria", { pattern: copy.title })}
            onClick={() => right !== undefined && onPriority(p.id, right)}
          >
            <ChevronRight size={14} aria-hidden />
          </button>
        </div>
      </li>
    );
  };

  const inbox = patternsInLane(patterns, priorities, null);

  return (
    <div className="space-y-3">
      {/* The inbox strip: everything nobody has weighed yet. It sits ABOVE the lanes
          rather than as a fourth column because it is a queue to be emptied, not a
          verdict — and an empty one is the signal that the sorting is done. */}
      <div className={`${PANEL_SUNKEN} px-3 py-2.5`}>
        <p className={`${META_LABEL} mb-2 flex items-center gap-1.5`}>
          <Inbox size={13} aria-hidden /> {t("lane.inbox", { n: inbox.length })}
        </p>
        {inbox.length === 0 ? (
          <p className="text-sm text-steel">{t("lane.inboxEmpty")}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{inbox.map((p) => card(p, null))}</ul>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {/* Lanes read weakest → strongest left to right, so ← and → mean "matters
            less" and "matters more" the way the arrows are already read. */}
        {[...PRIORITY_LEVELS].reverse().map((level) => {
          const lane = patternsInLane(patterns, priorities, level);
          return (
            <section key={level} className={`${PANEL_SUNKEN} min-h-[8rem] px-2.5 py-2.5`}>
              <p className={`${META_LABEL} mb-2 flex items-center justify-between gap-2`}>
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${LEVEL_DOT[level]}`} aria-hidden />
                  {labels[level]}
                </span>
                <span className="nums text-steel">{t("laneWeight", { n: laneWeight(patterns, priorities, level) })}</span>
              </p>
              {lane.length === 0 ? (
                <p className="text-sm text-steel">{t("lane.empty")}</p>
              ) : (
                <ul className="space-y-2">{lane.map((p) => card(p, level))}</ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
