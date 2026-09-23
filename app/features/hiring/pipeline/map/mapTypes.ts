// The 3-layer pipeline "map" board — the shipped board since the 2026-09 redesign
// round (Subway board + Spectrum/"Orchard" overlay won; PipelineBoard.tsx hosts them).
//
// Layer 1 (board): one slim row per position, stage columns, candidates drawn ONLY
//   as initial-avatars (fill = gender hint, ring = score tone). A bead opens the
//   candidate modal; an occupied station/cell opens layer 2.
// Layer 2 (overlay): clicking a (position × stage) cell opens a full-screen overlay
//   of candidate tickets, sized by how many stand in the cell.
// Layer 3: the candidate modal (candidate/CandidateModal.tsx, mounted by the tab)
//   and the Match profile (openProfile).

import type { InterviewPlanRule } from "@/app/_lib/decision-config-schema";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import type { Entry, Position } from "@/app/features/shared/pipelineTypes";
import type { MatchResultView } from "@/app/features/shared/matchTypes";
import type { CandidateTab } from "../candidate/candidateView";

/** The row context menu's verbs (subway/LineContextMenu.tsx → useLineActions). */
export type LineAction = "acceptAll" | "rejectAll" | "aiEvaluate";

/** Why a candidate sits on the rejected shelf: the column they were rejected at and
 *  whether the AI screener (true) or a recruiter (false) decided it. */
export type RejectedTag = { stage: string; auto: boolean };

/** Open the candidate modal: `cohort` is what its pager walks (null / omitted = the
 *  board's visible order), `tab` the section to land on (default Overview). */
export type OpenCandidate = (entry: Entry, cohort?: readonly Entry[] | null, tab?: CandidateTab) => void;

/** The board's public props — what PipelineTab hands to <PipelineBoard />. The
 *  map board renders bounced-move feedback on beads, select mode (beads and
 *  stations become checkboxes) and moves (drag a bead, or its Move-to menu) - the
 *  rules live in subway/subwayInteraction.ts. */
export type PipelineBoardProps = {
  positions: Position[];
  entries: Entry[];
  /** The columns THIS WORKSPACE renders, from GET /api/pipeline. */
  axis?: readonly StageDef[];
  /** Columns the workspace has dropped — used to NAME a stranded candidate's stage. */
  retiredStages?: readonly StageDef[];
  /** The hiring plan in force (Settings → Hiring) — each step's executor decides who
   *  a candidate standing there waits on (subway/lineAttention.ts). Null while loading. */
  plan?: InterviewPlanRule | null;
  /** Rejected candidates per lane key (`entryLaneKey`) — the rows are off the payload. */
  rejectedByLane?: Record<string, number>;
  /** A row's context menu: act on the position's ENTRY-column candidates at once. */
  onLineAction?: (position: Position, action: LineAction) => void;
  isStale: (e: Entry) => boolean;
  openPositionRanking: (jobId: string) => void;
  openProfile: (e: Entry) => void;
  openJob: (jobId: string) => void;
  openCandidate: OpenCandidate;
  selectMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (e: Entry) => void;
  /** Select or clear a whole cell at once (a station in select mode). Takes the pure
   *  set transform so the board never re-implements the selection's side effects. */
  onUpdateSelection?: (update: (cur: ReadonlySet<string>) => ReadonlySet<string>) => void;
  onMove?: (entry: Entry, toStage: string) => void;
  bouncedEntryId?: string | null;
  bouncedReason?: string | null;
};

/** The cell the recruiter clicked: which lane, which column, who stands there, and
 *  where on screen the click came from (so the overlay can grow out of it). */
export type CellSelection = {
  position: Position;
  stage: StageDef;
  stageIndex: number;
  /** Who stood there at click time. The host re-derives the LIVE cell from the
   *  board's entries while the overlay is open. */
  entries: Entry[];
  /** The clicked cell's viewport rect at click time — null when opened by keyboard
   *  without a measurable target. Overlays animate from it; never lay out on it. */
  origin: { x: number; y: number; width: number; height: number } | null;
  /** The REJECTED shelf of a lane rather than a live cell: `stage` is a synthetic
   *  column, the entries are closed, and each carries the column it was rejected at. */
  rejected?: Record<string, RejectedTag>;
};

/** The synthetic column the rejected shelf opens under (never on any axis). */
export const REJECTED_SHELF_ID = "__rejected";

export type MapBoardProps = PipelineBoardProps & {
  /** Layer-1 → layer-2 hand-off. */
  onOpenCell: (sel: CellSelection) => void;
  /** The first column's rejected count → the lane's rejected shelf in the overlay. */
  onOpenRejected: (position: Position, origin: CellSelection["origin"]) => void;
  /** The cell currently open in the overlay (to keep it highlighted underneath). */
  openCell?: { positionId: string; stageId: string } | null;
};

export type CellOverlayProps = {
  selection: CellSelection;
  /** Full match breakdown per candidateId for the selection's role — ONE shared
   *  ranking per role (useCellMatchData). Missing key = no analysis on file; render
   *  the Entry's canonicalScore/matchScore fallback and no bars. */
  matchByCandidate: ReadonlyMap<string, MatchResultView>;
  matchLoading: boolean;
  matchError: string | null;
  onClose: () => void;
  /** A ticket → the candidate modal, paging through this cell's cohort. */
  openCandidate: OpenCandidate;
  /** Stage label as the board header shows it (localized / workspace-renamed). */
  stageLabel: string;
  enumLabel: (group: string, value: string | null | undefined) => string;
  /** A per-ticket caption (the rejected shelf: "Rejected at Screened"). */
  ticketTag?: (e: Entry) => string | null;
};

/** How much room each card gets, from how many cards share the screen. */
export type CardTier = "spacious" | "regular" | "compact" | "micro";
