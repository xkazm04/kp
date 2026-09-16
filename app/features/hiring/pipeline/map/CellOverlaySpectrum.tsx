"use client";

// Layer 2 of the pipeline map — "Spectrum", second cut: the ORCHARD. Opened by a
// cell click on the Subway board (PipelineBoard.tsx hosts both).
//
// The first cut was a light table: one horizontal score axis and a leader line from
// every card to its position. It read beautifully at 8 candidates and became
// spaghetti at 40. So the axis is gone and the SORT is the picture: one BRANCH
// (column) per salary range, ascending left to right, tickets hanging top-down by
// descending score, rows banded by score tone. The top band's two corners are the
// answers a recruiter wants:
//
//   top-RIGHT  = highest salary AND highest score → the best professionals
//   top-LEFT   = modest salary AND highest score  → the gems (best balance)
//
// Everything is CSS grid + borders; nothing is measured. Unscored candidates never
// get a fake position: they park in a bay at the right. Salary is labelled in the
// ORGANIZATION's currency (useMapMoney) and is still a STAND-IN (mapSalary.ts) —
// the header says so out loud.
//
// Layout: orchard/orchardLayout.ts (pure) · OverlayShell · OrchardHeader ·
// OrchardGrid → OrchardBranch → OrchardTicket → TicketEvidence · UnscoredBay.

import { useCallback, useMemo } from "react";
import { useFitTierLabels } from "@/app/features/shared/MatchPresentation";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { boardScoreOf, cardTierOf, sortByScore } from "./mapAvatar";
import { roleBandOf, salaryPointOf, type SalaryPoint } from "./mapSalary";
import type { CellOverlayProps } from "./mapTypes";
import { useMapMoney } from "./useMapMoney";
import { ORCHARD_COPY as COPY } from "./orchard/orchardCopy";
import { buildRows, countBands, salaryBranches } from "./orchard/orchardLayout";
import { OrchardGrid } from "./orchard/OrchardGrid";
import { OrchardHeader } from "./orchard/OrchardHeader";
import type { TicketDeps } from "./orchard/OrchardTicket";
import { OverlayShell } from "./orchard/OverlayShell";
import { UnscoredBay } from "./orchard/UnscoredBay";

export function CellOverlaySpectrum({
  selection,
  matchByCandidate,
  matchLoading,
  matchError,
  onClose,
  openCandidate,
  stageLabel,
}: CellOverlayProps) {
  const tierLabels = useFitTierLabels();
  const money = useMapMoney();
  const sorted = useMemo(() => sortByScore(selection.entries), [selection.entries]);
  const scored = useMemo(() => sorted.filter((e) => boardScoreOf(e) != null), [sorted]);
  const unscored = useMemo(() => sorted.filter((e) => boardScoreOf(e) == null), [sorted]);
  const tier = cardTierOf(sorted.length);
  const bands = useMemo(() => countBands(sorted), [sorted]);

  const roleBand = useMemo(() => roleBandOf(matchByCandidate), [matchByCandidate]);
  const salaryById = useMemo(
    () => new Map<string, SalaryPoint>(scored.map((e) => [e.id, salaryPointOf(e, roleBand)])),
    [scored, roleBand],
  );
  const branches = useMemo(
    () => salaryBranches(scored.map((e) => ({ id: e.id, midpoint: salaryById.get(e.id)?.midpoint ?? 0 }))),
    [scored, salaryById],
  );
  const rows = useMemo(() => buildRows(branches, new Map(scored.map((e) => [e.id, e]))), [branches, scored]);

  // A ticket opens the candidate modal over this overlay (its footer carries every
  // action), and the pager walks the same score-sorted order the orchard reads in.
  const openDetail = useCallback((e: Entry) => openCandidate(e, sorted), [openCandidate, sorted]);
  const deps = useMemo<TicketDeps>(
    () => ({ salaryById, matchByCandidate, matchLoading, openDetail, tierLabels, money }),
    [salaryById, matchByCandidate, matchLoading, openDetail, tierLabels, money],
  );

  return (
    <OverlayShell origin={selection.origin} label={COPY.dialogAria(selection.position.title)} onClose={onClose}>
      <OrchardHeader
        title={selection.position.title}
        stageLabel={stageLabel}
        count={sorted.length}
        bands={bands}
        onBack={onClose}
      />
      {matchError ? <p className="px-6 pb-2 pt-2 text-sm text-steel">{COPY.matchError}</p> : null}
      <div className="flex min-h-0 flex-1 gap-5 px-6 pb-6">
        <div className="min-w-0 flex-1 overflow-auto">
          <OrchardGrid branches={branches} rows={rows} tier={tier} roleBand={roleBand} deps={deps} />
        </div>
        {unscored.length > 0 ? <UnscoredBay entries={unscored} onOpen={openDetail} /> : null}
      </div>
    </OverlayShell>
  );
}
