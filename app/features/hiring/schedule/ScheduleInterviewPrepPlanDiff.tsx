"use client";

// The staged-regeneration banner of the interview-prep modal (r09
// schedule-interview-prep/B). A Regenerate no longer swaps the plan in on completion:
// the new plan waits under `pendingPlan`, and this banner states what swapping it in
// would change — blocks added, removed, retimed or reworded, woven questions that fall
// back to unassigned, ticks that detach or move, a template replacing an AI plan —
// with Replace plan / Keep current. The diff is computed by schedulePrepPlanDiff.ts.

import { AlertTriangle, GitCompare } from "lucide-react";
import type { useTranslations } from "next-intl";
import { isPrepFallback } from "@/app/_components/Badge";
import { BTN_AFFIRM, BTN_SECONDARY, PANEL_ACCENT } from "@/app/_components/ui/recipes";
import type { PlanDiff } from "./schedulePrepPlanDiff";

export function PrepPlanDiff({
  diff,
  decide,
  deciding,
  failed,
  t,
}: {
  diff: PlanDiff;
  decide: (plan: "accept" | "discard") => void;
  deciding: boolean;
  failed: boolean;
  t: ReturnType<typeof useTranslations<"scheduleTab.prep">>;
}) {
  const list = (xs: string[]) => xs.join(", ");
  const lines: string[] = [];
  if (diff.added.length) lines.push(t("planDiff.added", { topics: list(diff.added) }));
  if (diff.removed.length) lines.push(t("planDiff.removed", { topics: list(diff.removed) }));
  if (diff.retimed.length) {
    const items = diff.retimed.map((r) =>
      t("planDiff.retimedItem", { topic: r.topic, fromA: r.from.fromMin, toA: r.from.toMin, fromB: r.to.fromMin, toB: r.to.toMin })
    );
    lines.push(t("planDiff.retimed", { topics: list(items) }));
  }
  if (diff.reworded.length) lines.push(t("planDiff.reworded", { topics: list(diff.reworded) }));
  if (diff.signalsAdded.length || diff.signalsRemoved.length) {
    lines.push(t("planDiff.signals", { added: diff.signalsAdded.length, removed: diff.signalsRemoved.length }));
  }
  if (diff.scenarioChanged) lines.push(t("planDiff.scenario"));
  if (diff.durationFrom !== diff.durationTo) lines.push(t("planDiff.duration", { from: diff.durationFrom, to: diff.durationTo }));

  // The consequences for the interviewer's own work, called out apart from the plan.
  const warnings: string[] = [];
  if (diff.wovenOrphaned.length) warnings.push(t("planDiff.wovenOrphaned", { count: diff.wovenOrphaned.length, questions: list(diff.wovenOrphaned) }));
  if (diff.checkedDetached) warnings.push(t("planDiff.checksDetached", { count: diff.checkedDetached }));
  if (diff.checkedMoved) warnings.push(t("planDiff.checksMoved", { count: diff.checkedMoved }));
  if (isPrepFallback(diff.sourceTo) && !isPrepFallback(diff.sourceFrom)) warnings.push(t("planDiff.toFallback"));

  return (
    <section role="status" aria-live="polite" className={`${PANEL_ACCENT} space-y-2 p-3`}>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <GitCompare size={15} className="shrink-0 text-coral" />
        {diff.isNoop ? t("planDiff.noopTitle") : t("planDiff.title")}
      </p>
      {lines.length ? (
        <ul className="space-y-0.5 text-sm text-ink">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {warnings.length ? (
        <ul className="space-y-0.5 text-sm text-amber-800">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {failed ? <p className="text-sm text-red-700">{t("planDiff.failed")}</p> : null}
      <div className="flex flex-wrap gap-2">
        {diff.isNoop ? (
          <button type="button" onClick={() => decide("discard")} disabled={deciding} className={`${BTN_SECONDARY} h-9 bg-white px-3 text-sm`}>
            {t("planDiff.dismiss")}
          </button>
        ) : (
          <>
            <button type="button" onClick={() => decide("accept")} disabled={deciding} className={`${BTN_AFFIRM} h-9 px-3 text-sm`}>
              {t("planDiff.replace")}
            </button>
            <button type="button" onClick={() => decide("discard")} disabled={deciding} className={`${BTN_SECONDARY} h-9 bg-white px-3 text-sm`}>
              {t("planDiff.keep")}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
