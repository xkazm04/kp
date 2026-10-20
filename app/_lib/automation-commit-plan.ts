// Commit the pass you previewed (challenge-r02 pipeline-actions-events/B).
//
// The policy pass is look-before-commit: a dry run shows the recruiter what it would
// do, and a commit applies it. Before this module the commit re-ran the whole pass
// with no reference to the preview, so what landed was whatever the pass decided at
// click time - a candidate whose score arrived in between could be advanced without
// ever appearing in the modal, and a single row the recruiter disagreed with could not
// be held back without abandoning the pass.
//
// A commit may now carry the reviewed selection: `approved` = the advance and
// would-be-reject rows the recruiter kept ticked, each with the action and target it
// was SHOWN with. `planCommit` reconciles the fresh decisions against it, per entry:
//
//   apply     - ticked, and the pass still decides the same action + target
//   declined  - the pass wants to advance/reject it, but the recruiter did not tick it
//               (unticked, or absent from the preview) -> not applied, logged as a skip
//   drifted   - ticked, but the pass now decides something else -> not applied, named
//               back to the recruiter as changed since the preview
//   foreign   - the entry belongs to ANOTHER team. A selection is one team's review, so
//               it neither applies nor holds back another team's row: such a decision is
//               dropped from this commit entirely (the pass is scoped to the caller's
//               workspace before it runs; this verdict is the defence in depth)
//   autonomous- a hold / none, or a reject the fairness backstop refuses: not a row the
//               recruiter was asked about, so it runs exactly as it does without a
//               selection. Alerts are recorded for every decision regardless.
//
// PURE and import-free on purpose: the preview modal (a client component) builds its
// selection with `approvedFromPreview`, and the route validates the body with
// `parseApprovedSelection`; neither may pull the database or node: modules along.

/** The two decision kinds a recruiter can hold back from a commit. Holds, nones and
 *  alerts are never selectable: they change nothing on the board. */
export const SELECTABLE_ACTIONS = ["advance", "reject"] as const;
export type SelectableAction = (typeof SELECTABLE_ACTIONS)[number];

export function isSelectableAction(v: unknown): v is SelectableAction {
  return typeof v === "string" && (SELECTABLE_ACTIONS as readonly string[]).includes(v);
}

/** One reviewed row, echoed back exactly as the preview showed it. */
export type ApprovedDecision = { entryId: string; action: SelectableAction; toStage: string | null };

export type CommitVerdict = "apply" | "declined" | "drifted" | "foreign" | "autonomous";

/** The minimum of a pass decision the plan reads. */
export type PlannableDecision = { entryId: string; action: string; toStage: string | null; workspaceId?: string };

/** A selection scoped to the team that reviewed it. */
export type CommitSelection = { approved: readonly ApprovedDecision[]; workspace: string };

/** Reconcile a fresh decision list against the recruiter's reviewed selection.
 *
 *  `workspace` is the reviewing team; a decision whose `workspaceId` names a different
 *  team is `foreign`. A decision with no `workspaceId` is judged by the caller (the pass
 *  stamps every decision from its entry snapshot before planning). */
export function planCommit(
  fresh: readonly PlannableDecision[],
  approved: readonly ApprovedDecision[],
  workspace?: string,
): Map<string, CommitVerdict> {
  const byEntry = new Map(approved.map((a) => [a.entryId, a]));
  const out = new Map<string, CommitVerdict>();
  for (const d of fresh) {
    if (!d.entryId) continue;
    if (workspace && d.workspaceId && d.workspaceId !== workspace) {
      out.set(d.entryId, "foreign");
      continue;
    }
    const kept = byEntry.get(d.entryId);
    if (kept) {
      const same = kept.action === d.action && (kept.action !== "advance" || (kept.toStage ?? null) === (d.toStage ?? null));
      out.set(d.entryId, same ? "apply" : "drifted");
    } else {
      out.set(d.entryId, isSelectableAction(d.action) ? "declined" : "autonomous");
    }
  }
  return out;
}

export type SelectionParse = { ok: true; approved: ApprovedDecision[] } | { ok: false };

/** Validate the `approved` field of a commit body. `undefined` is not a selection (the
 *  scheduler clock, the command bar and an external cron send none) and parses to
 *  `null`; anything else must be an array of at most `cap` rows, each naming an entry,
 *  a selectable action and (for an advance) a target stage. A duplicate entry id is
 *  refused rather than guessed at. */
export function parseApprovedSelection(raw: unknown, cap: number): SelectionParse | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length > cap) return { ok: false };
  const seen = new Set<string>();
  const approved: ApprovedDecision[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return { ok: false };
    const { entryId, action, toStage } = row as Record<string, unknown>;
    if (typeof entryId !== "string" || !entryId || entryId.length > 200 || seen.has(entryId)) return { ok: false };
    if (!isSelectableAction(action)) return { ok: false };
    if (toStage !== null && toStage !== undefined && typeof toStage !== "string") return { ok: false };
    seen.add(entryId);
    approved.push({ entryId, action, toStage: typeof toStage === "string" ? toStage : null });
  }
  return { ok: true, approved };
}

/** Client side: the rows the modal posts back - every advance / would-be-reject the
 *  preview showed, minus the ones the recruiter unticked. */
export function approvedFromPreview(
  decisions: readonly { entryId: string; action: string; toStage: string | null }[],
  unticked: ReadonlySet<string>,
): ApprovedDecision[] {
  const out: ApprovedDecision[] = [];
  for (const d of decisions) {
    if (!d.entryId || unticked.has(d.entryId) || !isSelectableAction(d.action)) continue;
    out.push({ entryId: d.entryId, action: d.action, toStage: d.action === "advance" ? d.toStage ?? null : null });
  }
  return out;
}

/** One row that changed between the preview and the commit: what was approved, and
 *  what the pass decided when it ran. */
export type DriftedRow = {
  entryId: string;
  approvedAction: SelectableAction;
  approvedToStage: string | null;
  action: string;
  toStage: string | null;
};

/** What a commit tells the recruiter about their selection, beside the summary.
 *
 *  `selectionHonored` is false when the commit JOINED a pass already in flight (the
 *  clock, or another click): that pass was planned without this selection, so its
 *  result is not this click's and the modal must say so instead of reporting it as
 *  applied. `drifted` is then empty - there is nothing honest to compare against. */
export type CommitReport = { selectionHonored: boolean; drifted: DriftedRow[]; declined: number };

/** The per-decision stamp the pass leaves on a held-back row: the verdict it was given
 *  and, for a drifted row, what the pass decided before it was held back. */
export type PlannedDecision = PlannableDecision & {
  commitVerdict?: CommitVerdict;
  plannedAction?: string;
  plannedToStage?: string | null;
};

export function commitReport(
  decisions: readonly PlannedDecision[],
  approved: readonly ApprovedDecision[],
  joined: boolean,
): CommitReport {
  if (joined) return { selectionHonored: false, drifted: [], declined: 0 };
  const byEntry = new Map(approved.map((a) => [a.entryId, a]));
  const drifted: DriftedRow[] = [];
  let declined = 0;
  for (const d of decisions) {
    if (d.commitVerdict === "declined") declined += 1;
    if (d.commitVerdict !== "drifted") continue;
    const kept = byEntry.get(d.entryId);
    if (!kept) continue;
    drifted.push({
      entryId: d.entryId,
      approvedAction: kept.action,
      approvedToStage: kept.toStage,
      action: d.plannedAction ?? d.action,
      toStage: d.plannedToStage === undefined ? d.toStage : d.plannedToStage,
    });
  }
  return { selectionHonored: true, drifted, declined };
}
