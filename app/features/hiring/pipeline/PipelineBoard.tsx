"use client";

// The pipeline board: a 3-layer map. Layer 1 is the Subway board (one slim row per
// position, candidates as beads), layer 2 the Spectrum "Orchard" overlay an occupied
// cell opens (tickets in salary branches, banded by score). A bead or a ticket opens
// the candidate modal, which PipelineTab mounts (candidate/CandidateModal.tsx) — on
// top of the Orchard, which stays open underneath. Consumers hand this the same
// props as before.
//
// This file owns what is SHARED between the two map layers: the open cell, the role
// ranking the Orchard reads (a module-level store the modal shares), the score
// reconciliation between board and overlay, and the portal that puts the
// fixed-position overlay on <body> (the board sits inside framer-motion wrappers
// whose transforms would otherwise make them the containing block of a `fixed`
// overlay).

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "framer-motion";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { DEFAULT_BOARD_AXIS } from "@/app/features/shared/pipelineTypes";
import { PipelineBoardSubway } from "./map/PipelineBoardSubway";
import { CellOverlaySpectrum } from "./map/CellOverlaySpectrum";
import { useCellMatchData } from "./map/useCellMatchData";
import { bucketLaneEntries } from "./pipelineBoardLayout";
import type { CellSelection, PipelineBoardProps } from "./map/mapTypes";

const noSubscription = () => () => undefined;

export function PipelineBoard(props: PipelineBoardProps) {
  const { openCandidate, positions, entries } = props;
  const axis = props.axis ?? DEFAULT_BOARD_AXIS;
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const enumLabel = useEnumLabel();
  const { matchByCandidate, matchLoading, matchError } = useCellMatchData(selection?.position.id ?? null);

  const onOpenCell = useCallback((sel: CellSelection) => setSelection(sel), []);
  const onClose = useCallback(() => setSelection(null), []);
  const openCell = useMemo(
    () => (selection ? { positionId: selection.position.id, stageId: selection.stage.id } : null),
    [selection],
  );
  // A workspace-renamed column shows its own label, a shipped one the enum catalog.
  const stageLabel = selection
    ? selection.stage.label === selection.stage.id
      ? enumLabel("stage", selection.stage.id)
      : selection.stage.label
    : "";

  // The overlay reads the cell LIVE, not the click-time snapshot: a stage move made
  // in the candidate modal on top of it reloads the board, and the ticket must leave
  // the cell it no longer stands in. Then ONE score per candidate: once the ranking
  // answers, its fresh `total` becomes the entries' canonicalScore for sorting,
  // tallies and rings alike; until then the snapshot stands.
  const overlaySelection = useMemo<CellSelection | null>(() => {
    if (!selection) return null;
    const cells = bucketLaneEntries(positions, entries, axis.map((s) => s.id)).get(selection.position.id);
    const live = cells?.[selection.stageIndex] ?? [];
    return {
      ...selection,
      entries:
        matchByCandidate.size === 0
          ? live
          : live.map((e) => {
              const total = e.candidateId ? matchByCandidate.get(e.candidateId)?.total : undefined;
              return total == null ? e : { ...e, canonicalScore: total };
            }),
    };
  }, [selection, positions, entries, axis, matchByCandidate]);

  // useSyncExternalStore with a null server snapshot is the hydration-safe way to
  // read document.body without a setState-in-effect.
  const portalRoot = useSyncExternalStore(noSubscription, () => document.body, () => null);

  return (
    <>
      <PipelineBoardSubway {...props} onOpenCell={onOpenCell} openCell={openCell} />
      {portalRoot
        ? createPortal(
            <AnimatePresence>
              {overlaySelection ? (
                <CellOverlaySpectrum
                  key={`${overlaySelection.position.id}:${overlaySelection.stage.id}`}
                  selection={overlaySelection}
                  matchByCandidate={matchByCandidate}
                  matchLoading={matchLoading}
                  matchError={matchError}
                  onClose={onClose}
                  openCandidate={openCandidate}
                  stageLabel={stageLabel}
                  enumLabel={enumLabel}
                />
              ) : null}
            </AnimatePresence>,
            portalRoot,
          )
        : null}
    </>
  );
}
