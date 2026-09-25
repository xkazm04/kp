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
// AND IT IS PER ROLE — which is why there is exactly ONE of it on the board.
// A rail is derived from what actually happened in this role, not from a
// declared policy, so equal vertical position in two clusters is NOT the same
// step. Every cluster used to draw its own, which made a sideways journey read
// rail / columns / rail / columns and cost 16rem per role; now one rail is
// pinned at the far left of the track and REDRAWS for whichever cluster is
// under the reader's view (`clusterIndexInView`, `useClusterInView`), naming
// that role in its own header (`journey.rail.forRole`). The alignment that
// makes one rail legitimate is `globalBandHeights`: every cluster's bands are
// padded to one height, so the rungs sit at the same y in all of them.
// `journey.rail.note` in the toolbar says the rest, once.
//
// The server derives the steps (`RoleCluster.rail`); this component never
// re-derives them.

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

  // TITLE LEFT, COVERAGE RIGHT — the same two-part shape as a JourneyRow, and
  // the same reason. The step used to stack a clamped title over a full-width
  // cohort BAR, which cost a third line of height in every one of the board's
  // rows (the row unit is global, so the rail sets it too) and said nothing the
  // number beside it did not. `journey.rail.reached` IS "38 of 45"; the bar was
  // a second encoding of it in colour, which is the weaker of the two channels.
  return (
    <button
      type="button"
      data-jr-measure=""
      aria-pressed={lit}
      onClick={onLight}
      style={{ height }}
      className={`focus-ring flex w-full shrink-0 items-start gap-2 overflow-hidden border-b border-stone-200 px-2 py-1.5 text-left transition-colors hover:bg-stone-100 ${
        lit ? "bg-coral/10" : ""
      }`}
    >
      {/* Two lines, then the tail is clamped — the full step stays in the DOM,
          so it is still the button's accessible name in full. */}
      <span className="line-clamp-2 min-w-0 flex-1 break-words text-micro leading-snug text-ink">
        {sentence({ kind: step.kind, topicCode: step.topicCode })}
      </span>
      <span className="nums mt-px shrink-0 text-micro text-steel">
        {t("rail.reached", { reached: step.reached, cohort: step.cohort })}
      </span>
      {/* The machine's share of that cohort. It lost its visible bar with the
          owner's density pass; it is still in the accessible name, and the
          actor glyph on every ROW is where a sighted reader reads the same
          fact per event. */}
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
  const roleTitle = cluster.cluster.title;

  return (
    <div
      data-jr-rail=""
      className={`sticky left-0 z-30 flex ${JOURNEY_RAIL_W} flex-none flex-col border-r-2 border-ink bg-paper`}
    >
      <div
        className="sticky top-0 z-10 flex shrink-0 items-center border-b border-stone-200 bg-paper px-2"
        style={{ height: JOURNEY_CLUSTER_HEAD_PX }}
      >
        {/* NEVER the bare "Steps in this role": one rail over a board of roles
            has to say WHICH role, or it reads as a ladder that spans all of
            them — the one claim a per-role rail may not make. Clamped to two
            lines so a long role title cannot break the 44px head the columns
            are aligned against; the full title stays in the DOM. */}
        <span className="line-clamp-2 text-micro font-semibold leading-tight text-coral">
          {t("rail.forRole", { role: roleTitle })}
        </span>
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
