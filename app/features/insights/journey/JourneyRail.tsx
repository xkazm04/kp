"use client";

// The canonical-step rail — the concept the owner asked to import from the
// contest's runner-up, "The Ladder".
//
// WHY IT EARNS THE 16rem IT COSTS. A stacked chronology answers "what happened
// to THIS person" and cannot answer "where did this process go wrong", because
// row 4 of one column and row 4 of the next are different events. With a rail,
// row `n` is the SAME step in every column of the cluster, so the cohort becomes
// readable across: "38 of 45 reached this, 31 of them by the machine".
//
// AND IT IS PER ROLE. `journey.rail.note` says so in the toolbar, once: a rail
// is derived from what actually happened in this role, not from a declared
// policy, so equal vertical position in two clusters is NOT the same step. The
// server derives it (`RoleCluster.rail`); this component never re-derives it.

import { memo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import type { JourneyPhaseId, JourneyRailStep } from "@/app/_lib/journey/types";
import { useJourneySentence } from "./useJourneySentence";
import {
  JOURNEY_BAND_LABEL_PX,
  JOURNEY_CLUSTER_HEAD_PX,
  JOURNEY_COLUMN_HEAD_PX,
  JOURNEY_RAIL_W,
  JOURNEY_SHARED_HEAD_PX,
  type ClusterPlan,
  rowHeight,
} from "./journeyLayout";

/** Phase names, as literal catalog keys — see the note on ACTOR_MARK_KEY. */
export const PHASE_LABEL_KEY: Record<JourneyPhaseId, "phases.job-definition" | "phases.case" | "phases.screening"> = {
  "job-definition": "phases.job-definition",
  case: "phases.case",
  screening: "phases.screening",
};

export type LitRow = { jobId: string; phase: JourneyPhaseId; row: number } | null;

function PhaseLabel({ phase, height }: { phase: JourneyPhaseId; height?: number }) {
  const t = useTranslations("journey");
  return (
    <div
      className="flex shrink-0 items-center border-b border-stone-200 bg-stone-100 px-2"
      style={{ height: height ?? JOURNEY_BAND_LABEL_PX }}
    >
      <span className={META_LABEL}>{t(PHASE_LABEL_KEY[phase])}</span>
    </div>
  );
}

function RailStep({
  step,
  height,
  lit,
  onLight,
}: {
  step: JourneyRailStep;
  height: number;
  lit: boolean;
  onLight: () => void;
}) {
  const t = useTranslations("journey");
  const sentence = useJourneySentence();
  const cohort = Math.max(step.cohort, 1);
  const machinePct = Math.round((step.byMachine / cohort) * 100);
  const humanPct = Math.max(0, Math.round((step.reached / cohort) * 100) - machinePct);

  return (
    <button
      type="button"
      data-jr-measure=""
      aria-pressed={lit}
      onClick={onLight}
      style={{ height }}
      className={`focus-ring flex w-full shrink-0 flex-col justify-center overflow-hidden border-b border-stone-200 px-2 py-1 text-left transition-colors hover:bg-stone-100 ${
        lit ? "bg-coral/10" : ""
      }`}
    >
      <span className="block break-words text-xs leading-snug text-ink">
        {sentence({ kind: step.kind, topicCode: step.topicCode })}
      </span>
      <span className="mt-1 flex items-center gap-2">
        <span className="flex h-1 flex-1 overflow-hidden rounded-full bg-stone-200" aria-hidden="true">
          <span className="h-full bg-steel" style={{ width: `${machinePct}%` }} />
          <span className="h-full bg-coral" style={{ width: `${humanPct}%` }} />
        </span>
        <span className="nums shrink-0 text-xs text-steel">
          {t("rail.reached", { reached: step.reached, cohort: step.cohort })}
        </span>
      </span>
      {/* The machine share is a bar for a sighted reader and a sentence for
          everyone else — never a colour on its own, never a tooltip. */}
      <span className="sr-only">{t("rail.byMachine", { count: step.byMachine })}</span>
    </button>
  );
}

export type JourneyRailProps = {
  cluster: ClusterPlan;
  phases: readonly JourneyPhaseId[];
  bandPx: Map<JourneyPhaseId, number>;
  sharedPx: number;
  unit: number;
  silencePx: number;
  lit: LitRow;
  onLight: (phase: JourneyPhaseId, row: number) => void;
};

function StepList({
  steps,
  rowCount,
  silentRows,
  height,
  unit,
  silencePx,
  phase,
  lit,
  onLight,
  jobId,
}: {
  steps: readonly JourneyRailStep[];
  rowCount: number;
  silentRows: readonly boolean[];
  height: number;
  unit: number;
  silencePx: number;
  phase: JourneyPhaseId;
  lit: LitRow;
  onLight: (phase: JourneyPhaseId, row: number) => void;
  jobId: string;
}) {
  const rows: ReactNode[] = [];
  let used = 0;
  for (let row = 0; row < rowCount; row++) {
    const h = rowHeight(unit, silentRows[row] === true, silencePx);
    used += h;
    const step = steps[row];
    rows.push(
      step ? (
        <RailStep
          key={row}
          step={step}
          height={h}
          lit={lit !== null && lit.jobId === jobId && lit.phase === phase && lit.row === row}
          onLight={() => onLight(phase, row)}
        />
      ) : (
        // A row past this role's own rail: the board pads every band to one
        // global height so the phases line up, and a pad is not a step.
        <div key={row} className="shrink-0 border-b border-stone-200" style={{ height: h }} />
      )
    );
  }
  const pad = Math.max(0, height - used);
  if (pad > 0) rows.push(<div key="pad" className="shrink-0" style={{ height: pad }} />);
  return <>{rows}</>;
}

function JourneyRailImpl({ cluster, phases, bandPx, sharedPx, unit, silencePx, lit, onLight }: JourneyRailProps) {
  const t = useTranslations("journey");
  const jobId = cluster.cluster.jobId;

  return (
    <div className={`sticky left-0 z-30 flex ${JOURNEY_RAIL_W} flex-none flex-col border-r-2 border-ink bg-paper`}>
      <div
        className="sticky top-0 z-10 flex shrink-0 items-center border-b border-stone-200 bg-paper px-2"
        style={{ height: JOURNEY_CLUSTER_HEAD_PX }}
      >
        <span className="text-meta uppercase text-coral">{t("rail.title")}</span>
      </div>

      {/* The role's own conversation, above every column — so its steps sit in
          the rail above the column headers, not beside them. */}
      <PhaseLabel phase="job-definition" height={JOURNEY_SHARED_HEAD_PX} />
      <StepList
        steps={cluster.sharedSteps}
        rowCount={cluster.sharedRowCount}
        silentRows={cluster.sharedSilentRows}
        height={sharedPx}
        unit={unit}
        silencePx={silencePx}
        phase="job-definition"
        lit={lit}
        onLight={onLight}
        jobId={jobId}
      />

      {/* Aligns the rail with the sticky column headers below the shared band. */}
      <div className="shrink-0 border-b-2 border-ink" style={{ height: JOURNEY_COLUMN_HEAD_PX }} />

      {phases.map((phase) => {
        const plan = cluster.phases.get(phase);
        return (
          <div key={phase} className="flex shrink-0 flex-col">
            <PhaseLabel phase={phase} />
            <StepList
              steps={plan?.steps ?? []}
              rowCount={plan?.rowCount ?? 0}
              silentRows={plan?.silentRows ?? []}
              height={bandPx.get(phase) ?? 0}
              unit={unit}
              silencePx={silencePx}
              phase={phase}
              lit={lit}
              onLight={onLight}
              jobId={jobId}
            />
          </div>
        );
      })}
    </div>
  );
}

export const JourneyRail = memo(JourneyRailImpl);
