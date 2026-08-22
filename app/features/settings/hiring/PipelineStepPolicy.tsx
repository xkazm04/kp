"use client";

// What runs at ONE board column, and who lets it through — the policy half of the
// merged step editor.
//
// This is the content that used to be a second table (`PipelineComposerMatrix`,
// deleted): a Station / Mode / Approval / Cohort grid sitting under the steps
// editor, listing the same columns a second time in a different order with
// different words. Two tables for one pipeline is one table too many — the
// recruiter had to hold "row 3 there is row 2 here" in their head, and neither
// table could say what the other knew.
//
// It could only be merged once the plan became STAGE-KEYED
// (decision-config-schema.ts): a row-per-column table needs one policy per
// column, and the old shape had one `screeningGate` for the whole workspace plus
// a flat round array bound to columns by an implicit left-to-right rule.
//
// ONE STEP, ONE ACTIVITY. An interview column runs exactly one round. Rounds used
// to stack — two conversations behind one column, added with an "Add interview
// round" button that quietly created configuration the board could not draw. They
// are steps now: to run an AI round, then scoring, then a human panel, the
// operator adds three steps and picks their types, which is the same gesture the
// rest of this table already uses and produces a board a candidate can actually
// be standing on. The add-round button is gone with the stacking.
//
// THREE SLOTS, ALWAYS THE SAME THREE — cohort · executor · guard — at fixed widths
// (POLICY_SLOT), so one dimension can be read straight down the table. A row with
// no such decision renders its slot EMPTY rather than collapsing it; collapsing is
// what made the first version ragged.
//
// WHAT FILLS THEM IS DECIDED BY THE COLUMN'S TYPE, not by its position:
//
//   entry / terminal   nothing at all. Arrival and outcome are not decisions; a
//                      guard here would govern nothing.
//   screening          executor = AI, stated not offered; guard = a real choice.
//   interview          cohort (who reaches it), executor (AI or a person), guard.
//   scoring            executor = AI, stated; guard = who ratifies the score. The
//                      automated pass between an AI interview and a human one.
//   offer              executor = AI drafts it, stated; guard = who sends it.
//   custom             nothing, deliberately. The automation layer resolves policy
//                      by ROLE, so a guard on a column the product has no
//                      semantics for would be a switch wired to nothing.
//
// Every control is a real, immediate edit of the plan; the host holds the draft
// and Save persists it (nothing here writes).

import type { ReactNode } from "react";
import { AlertTriangle, Bot, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { CohortSelect, GateButton, KindButton, POLICY_SLOT, PolicyStatic } from "./PipelineComposerBits";
import { newRound, patchRound, setStepGate, setStepRounds, type PipelinePlan } from "./pipelineComposerModel";
import { planStep } from "@/app/_lib/decision-config-schema";
import type { StageRole } from "@/app/_lib/pipeline-stages";

/** Types that carry policy at all. Everything else renders the em dash the row
 *  reserves space for. */
export function stepCarriesPolicy(role: StageRole): boolean {
  return role === "screening" || role === "interview" || role === "scoring" || role === "offer";
}

/** One policy line: the three decision slots, always in this order and always at
 *  these widths — an absent decision leaves its slot empty. */
function PolicyLine({ cohort, executor, guard }: { cohort?: ReactNode; executor?: ReactNode; guard?: ReactNode }) {
  return (
    // flex-1 so a single line fills the row: the slot dividers then run the row's
    // full height and match the ones on the outer cells instead of stopping short.
    // No gap — each slot carries its own rule and 2px of air, and a gap here would
    // push the cells out of line with the headings, which have none.
    <span className="flex w-full flex-1 items-center">
      <span className={`${POLICY_SLOT.cohort} shrink-0`}>{cohort}</span>
      <span className={`${POLICY_SLOT.executor} shrink-0`}>{executor}</span>
      <span className={`${POLICY_SLOT.guard} shrink-0`}>{guard}</span>
    </span>
  );
}

export function PipelineStepPolicy({
  plan,
  onPlan,
  stageId,
  role,
  stageLabel,
  roundsBefore,
}: {
  plan: PipelinePlan;
  onPlan: (next: PipelinePlan) => void;
  stageId: string;
  role: StageRole;
  /** Rounds the plan runs at earlier columns, counted in BOARD order by the
   *  caller (which holds the axis). Zero ⇒ this column runs the plan's first
   *  round, which has no previous cohort to reduce. */
  roundsBefore: number;
  /** The column's display name, for the controls' accessible names — "Approval
   *  at Tech screen" beats "Approval, row 3". */
  stageLabel: string;
}) {
  const t = useTranslations("hiringPlan");
  const step = planStep(plan, stageId);
  // A column with no step yet reads as its conservative default rather than as
  // blank: absence means "nobody chose", and for a guard that means a person.
  const gate = step?.gate ?? "human";
  const rounds = step?.rounds ?? [];

  if (!stepCarriesPolicy(role)) return null;

  if (role !== "interview") {
    // Screening, scoring and offer are all "the AI does it, you decide who lets it
    // through". Same shape, different sentence.
    const tip = role === "screening" ? "tipModeScreening" : role === "scoring" ? "tipModeScoring" : "tipModeOffer";
    return (
      <PolicyLine
        executor={<PolicyStatic icon={Bot} label={t("kindAi")} title={t(tip)} />}
        guard={<GateButton value={gate} onChange={(v) => onPlan(setStepGate(plan, stageId, v))} stage={stageLabel} />}
      />
    );
  }

  // Exactly one round. A step the plan has not met yet renders its DEFAULT round
  // rather than an empty cell — the controls have to show something, and "an AI
  // round nobody has approved yet" is what an untouched interview column is. The
  // round is written into the plan on the first edit, not on render.
  const round = rounds[0] ?? newRound("ai");
  const setRound = (patch: Partial<typeof round>) =>
    onPlan(rounds.length > 0 ? patchRound(plan, stageId, 0, patch) : setStepRounds(plan, stageId, [{ ...round, ...patch }]));

  return (
    <>
      <PolicyLine
        // Who reaches THIS round. Meaningless on the plan's first round, which has
        // no previous cohort to reduce — the validator nulls it there, so it is not
        // offered there either, and the slot stays empty rather than closing up.
        cohort={
          roundsBefore > 0 ? (
            <CohortSelect value={round.topN} onChange={(topN) => setRound({ topN })} stage={stageLabel} />
          ) : null
        }
        executor={<KindButton value={round.kind} onChange={(kind) => setRound({ kind })} stage={stageLabel} />}
        // A human round's verdict IS the human decision, so there is nothing left
        // to let through. Stated in the guard column's own vocabulary rather than
        // a fourth word, so the column still reads as one dimension.
        guard={
          round.kind === "human" ? (
            <PolicyStatic icon={UserRound} label={t("gateShortHuman")} title={t("tipScorecard")} />
          ) : (
            <GateButton value={round.gate} onChange={(g) => setRound({ gate: g })} stage={stageLabel} />
          )
        }
      />

      {/* Configuration this editor can no longer CREATE but must not hide: a plan
          saved before one-round-per-step could stack several conversations behind
          one column. Say so, name the fix, and leave the data alone — silently
          dropping a round would change who gets interviewed. */}
      {rounds.length > 1 ? (
        <span
          title={t("tipStackedRounds", { count: rounds.length })}
          className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-sm text-amber-900"
        >
          <AlertTriangle size={12} aria-hidden className="shrink-0" />
          {t("stackedRounds", { count: rounds.length })}
        </span>
      ) : null}
    </>
  );
}
