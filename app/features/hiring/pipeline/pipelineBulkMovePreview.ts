// blast-radius-computation — the board's bulk "Move N" says what it sets off before it
// fires (challenge-r06 pipeline-move-bulk-operations/B).
//
// The server previews each selected row through /api/pipeline/batch {dryRun:true},
// which reads the arrival with `planArrival` (app/_lib/pipeline-arrival-plan.ts) — the
// planner the stage-entered hook itself executes. This module is the client half, pure:
//   • `summarizeMovePreview` folds the rows into counts (who moves, who gets an AI
//     interview invite now, who is parked for a human, who gets a work-sample, which
//     pending decisions the move erases, which drafted offers keep a row back);
//   • `needsConfirm` arms the move confirm whenever anything leaves the building or is
//     destroyed — an all-plain move still commits on one click;
//   • `commitItemsFromPreview` builds the commit from EXACTLY the previewed rows, each
//     pinned to the stage the preview read, so a row that moved since is a per-id 409
//     rather than a move nobody previewed. A drafted-offer holder is never committed.
//
// Types only from the server side: no app/_lib module joins the client graph.

import type { ArrivalPlan } from "@/app/_lib/pipeline-arrival-plan";

export type MovePreview = ArrivalPlan & {
  /** The stage the preview read the row on — the commit's expectedStage. */
  stage: string;
};

/** One row of the dry-run answer. `ok:false` rows would not move (a CAS miss, a closed
 *  row, the terminal refusal); `code` is the server's refusal code. */
export type MovePreviewRow = { id: string; ok: boolean; code?: string; preview?: MovePreview };

/** A preview of one target, as the reducer holds it between the preview and the commit. */
export type MovePreviewPlan = { toStage: string; rows: readonly MovePreviewRow[] };

export type MovePreviewSummary = {
  /** Rows the commit will actually move. */
  moving: number;
  alreadyThere: number;
  invitesNow: number;
  invitesHeld: number;
  homework: number;
  /** Rows kept back because the move would erase a drafted offer. */
  offersHeld: number;
  /** Moving rows whose pending decision the move erases. */
  verdictsCleared: number;
  /** Rows the preview refused (moved since, closed, or not movable here). */
  stale: number;
};

const willMove = (r: MovePreviewRow): r is MovePreviewRow & { preview: MovePreview } =>
  r.ok && !!r.preview && r.preview.effect !== "noop" && !r.preview.holdBack;

export function summarizeMovePreview(rows: readonly MovePreviewRow[]): MovePreviewSummary {
  const s: MovePreviewSummary = {
    moving: 0,
    alreadyThere: 0,
    invitesNow: 0,
    invitesHeld: 0,
    homework: 0,
    offersHeld: 0,
    verdictsCleared: 0,
    stale: 0,
  };
  for (const r of rows) {
    if (!r.ok || !r.preview) {
      s.stale += 1;
      continue;
    }
    if (r.preview.effect === "noop") {
      s.alreadyThere += 1;
      continue;
    }
    if (r.preview.holdBack) {
      s.offersHeld += 1;
      continue;
    }
    s.moving += 1;
    if (r.preview.effect === "ai_invite") s.invitesNow += 1;
    else if (r.preview.effect === "ai_invite_held") s.invitesHeld += 1;
    else if (r.preview.effect === "homework") s.homework += 1;
    if (r.preview.clears) s.verdictsCleared += 1;
  }
  return s;
}

/** Anything outbound (an invite, an assignment), anything parked for a human, anything
 *  erased (a pending decision) or held back (a drafted offer) deserves a confirm. */
export function needsConfirm(s: MovePreviewSummary): boolean {
  return s.invitesNow + s.invitesHeld + s.homework + s.verdictsCleared + s.offersHeld > 0;
}

/** The pipeline.tab catalog keys the preview sentence is built from. */
export type MovePreviewKey =
  | "bulkMovePreviewMoving"
  | "bulkMovePreviewInvitesNow"
  | "bulkMovePreviewInvitesHeld"
  | "bulkMovePreviewHomework"
  | "bulkMovePreviewVerdictsCleared"
  | "bulkMovePreviewOffersHeld"
  | "bulkMovePreviewAlreadyThere"
  | "bulkMovePreviewStale";

/** The sentence, as catalog keys in reading order; only non-zero parts. The bar joins
 *  them with " · ". */
export function movePreviewParts(s: MovePreviewSummary): { key: MovePreviewKey; count: number }[] {
  const parts: [MovePreviewKey, number][] = [
    ["bulkMovePreviewMoving", s.moving],
    ["bulkMovePreviewInvitesNow", s.invitesNow],
    ["bulkMovePreviewInvitesHeld", s.invitesHeld],
    ["bulkMovePreviewHomework", s.homework],
    ["bulkMovePreviewVerdictsCleared", s.verdictsCleared],
    ["bulkMovePreviewOffersHeld", s.offersHeld],
    ["bulkMovePreviewAlreadyThere", s.alreadyThere],
    ["bulkMovePreviewStale", s.stale],
  ];
  return parts.filter(([, n]) => n > 0).map(([key, count]) => ({ key, count }));
}

export type MoveCommitItem = { id: string; action: "set_stage"; toStage: string; expectedStage: string };

/** The commit for a confirmed preview: only rows still selected; drafted-offer holders
 *  and already-there rows are not sent; refused rows ride back as per-id failures. */
export function commitItemsFromPreview(
  preview: MovePreviewPlan,
  selection: ReadonlySet<string>
): { items: MoveCommitItem[]; heldBack: string[]; alreadyThere: string[]; refused: { id: string; ok: false; code?: string }[] } {
  const items: MoveCommitItem[] = [];
  const heldBack: string[] = [];
  const alreadyThere: string[] = [];
  const refused: { id: string; ok: false; code?: string }[] = [];
  for (const r of preview.rows) {
    if (!selection.has(r.id)) continue;
    if (!r.ok || !r.preview) {
      refused.push({ id: r.id, ok: false, ...(r.code ? { code: r.code } : {}) });
      continue;
    }
    if (r.preview.effect === "noop") alreadyThere.push(r.id);
    else if (r.preview.holdBack) heldBack.push(r.id);
    else if (willMove(r)) items.push({ id: r.id, action: "set_stage", toStage: preview.toStage, expectedStage: r.preview.stage });
  }
  return { items, heldBack, alreadyThere, refused };
}
