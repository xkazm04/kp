// cohort-drift-forces-a-fresh-review — the pipeline board's bulk selection as ONE pure
// reducer (challenge-r06 pipeline-move-bulk-operations/A).
//
// The bulk hook used to hold five loose cells (selectedIds, bulkResult, bulkConfirm,
// outreachTaskId, bulkBusy) and keep them consistent by hand: 9 `setSelectedIds` call
// sites, 5 of them paired with a manual `selectionChanged` dispatch, and bulkMove forgot
// its pair — so an armed reject/outreach confirm outlived the cohort change its own
// settle caused. The round-5 lesson (pipelineBulkConfirm.ts) was that a disarm written
// per call site leaks; this module applies it to everything else:
//
//   • every selection change is an EVENT, and every event that changes the selection
//     disarms the confirm in the same transition — nothing has to remember to;
//   • an armed confirm SIGNS the actionable cohort it names (`cohortSignature`: id +
//     stage + decision kind), and `armedBulkConfirm` reports it armed only while the
//     board's cohort still signs identically — a poll that adds, drops or re-stages a
//     named person makes the next click re-arm instead of firing on someone the
//     recruiter never confirmed (a confirm only ever applies to the rows it named);
//   • ids of entries that LEFT the board (closed elsewhere; the list excludes terminal
//     rows) are pruned on reconcile and disclosed once, instead of being counted as
//     "hidden by the current filter" forever;
//   • the failures-stay-selected fold, with a whole-request refusal overriding per-id
//     codes, is written ONCE (`foldBatchSettle`) for move, decide and invite.
//
// DB-free and React-free so every invariant is provable in a unit test.

import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { armedConfirm, bulkConfirmReducer, type BulkConfirm } from "./pipelineBulkConfirm";
import { summarizeMovePreview, type MovePreviewPlan, type MovePreviewSummary } from "./pipelineBulkMovePreview";

export type BulkWhich = NonNullable<BulkConfirm>["which"];

/** The status line after a bulk action. `reason` is a sentence this CLIENT already
 *  localized (a whole-request refusal, an outreach task's own failure); `reasonCodes`
 *  are the SERVER's refusal codes, resolved through errors.<CODE> where rendered;
 *  `refusalCapability` is the permission a FORBIDDEN_CAPABILITY refusal wanted;
 *  `diagnostic` is the task runner's English, carried as details only. `departed` is how
 *  many selected candidates left the board (closed elsewhere) and were deselected;
 *  verb "departed" is a line that reports only that. */
export type BulkResult = {
  ok: number;
  failed: number;
  verb: "moved" | "accepted" | "rejected" | "invited" | "drafted" | "departed" | "previewed";
  /** verb "previewed": what the armed move would set off (pipelineBulkMovePreview.ts). */
  preview?: MovePreviewSummary;
  /** Rows a move kept back (a drafted offer it would erase); they stay selected. */
  heldBack?: number;
  reason?: string | null;
  reasonCodes?: string[];
  refusalCapability?: string | null;
  diagnostic?: string | null;
  departed?: number;
};

/** The fields of a board entry a cohort signature reads. */
export type CohortRow = { id: string; stage: string; approvalKind: string | null; status: string };

export type BulkSelectionState = {
  selected: ReadonlySet<string>;
  confirm: BulkConfirm;
  result: BulkResult | null;
  busy: boolean;
  /** The backgrounded outreach run and the cohort it was STARTED with. */
  outreach: { taskId: string; cohort: readonly string[] } | null;
  /** The dry-run preview the armed move confirm names, committed verbatim on confirm. */
  movePreview: MovePreviewPlan | null;
};

export const EMPTY_BULK_SELECTION: BulkSelectionState = {
  selected: new Set<string>(),
  confirm: null,
  result: null,
  busy: false,
  outreach: null,
  movePreview: null,
};

export type BulkSelectionEvent =
  /** Select mode toggled: an empty selection, no line, no confirm. */
  | { type: "reset" }
  | { type: "toggle"; id: string }
  /** A pure set transform (a Subway station: subwayInteraction.toggleCellSelection). */
  | { type: "update"; update: (cur: ReadonlySet<string>) => ReadonlySet<string> }
  | { type: "selectAll"; ids: readonly string[] }
  | { type: "clear" }
  /** A board load: prune ids that are no longer on the board. */
  | { type: "reconcile"; entries: readonly { id: string }[] }
  | { type: "arm"; which: BulkWhich; scope: string; cohort: string }
  | { type: "cancel" }
  /** An action left the building: the confirm has served its purpose. `busy` marks a
   *  synchronous batch in flight; omitted (the backgrounded outreach) leaves it as is. */
  | { type: "fired"; busy?: boolean }
  | { type: "outreachStarted"; taskId: string; cohort: readonly string[] }
  /** A move preview came back that needs a confirm: hold it and arm the move. */
  | { type: "previewed"; preview: MovePreviewPlan; arm: { scope: string; cohort: string } }
  /** The ONLY way an action changes the selection. */
  | { type: "settled"; keep: Iterable<string>; result: BulkResult }
  | {
      type: "outreachSettled";
      taskId: string;
      /** The whole run failed (reason already localized). */
      failure: { reason: string; diagnostic: string | null } | null;
      ok?: number;
      results?: readonly { id: string; ok: boolean }[];
    };

/** The selected entries the given bulk action would touch, in selection order.
 *  reject acts on the ACTIVE entries awaiting a human decision; outreach (and invite)
 *  and move on any ACTIVE entry. An id with no entry on the board touches nothing. */
export function actionableRows<E extends CohortRow>(
  selected: Iterable<string>,
  entries: readonly E[] | null,
  which: BulkWhich
): E[] {
  const byId = new Map((entries ?? []).map((e) => [e.id, e] as const));
  const out: E[] = [];
  for (const id of selected) {
    const e = byId.get(id);
    if (!e || e.status !== "active") continue;
    if (which === "reject" && !needsHumanDecision(e.approvalKind)) continue;
    out.push(e);
  }
  return out;
}

/** Order-independent identity of the cohort an armed `which` action would touch:
 *  every row's id, stage and pending decision kind, prefixed with the action so a
 *  signature minted for one confirm can never arm the other. Control-character
 *  separators, as in visibleScopeSignature, so two cohorts cannot collide. */
export function cohortSignature(
  selected: Iterable<string>,
  entries: readonly CohortRow[] | null,
  which: BulkWhich,
  /** The move's target column: a move confirm signs WHERE as well as WHO. */
  moveTarget = ""
): string {
  const rows = actionableRows(selected, entries, which)
    .map((e) => [e.id, e.stage, e.approvalKind ?? ""].join("\u001f"))
    .sort();
  const head = which === "move" ? which + "\u001c" + moveTarget : which;
  return head + "\u001d" + rows.join("\u001e");
}

/** Which confirm is armed RIGHT NOW: the scope it was armed under still holds AND the
 *  cohort it named still signs identically. Read this at every fire site. */
export function armedBulkConfirm(
  state: Pick<BulkSelectionState, "selected" | "confirm">,
  scope: string,
  entries: readonly CohortRow[] | null,
  /** The Move-to column in force now (only a move confirm reads it). */
  moveTarget = ""
): BulkWhich | null {
  if (!state.confirm) return null;
  return armedConfirm(state.confirm, scope, cohortSignature(state.selected, entries, state.confirm.which, moveTarget));
}

/** Drop selected ids whose entry is no longer on the board. Returns the SAME set when
 *  nothing left, so a poll that changed nothing re-renders nothing. */
export function reconcileSelection(
  selected: ReadonlySet<string>,
  entries: readonly { id: string }[]
): { selected: ReadonlySet<string>; pruned: string[] } {
  const onBoard = new Set(entries.map((e) => e.id));
  const pruned = [...selected].filter((id) => !onBoard.has(id));
  if (pruned.length === 0) return { selected, pruned };
  return { selected: new Set([...selected].filter((id) => onBoard.has(id))), pruned };
}

/** A batch door's answer, normalized: per-id outcomes, or a whole-request failure
 *  (`status` absent on a transport blip). */
export type BatchResponse =
  | { ok: true; results: readonly { id: string; ok: boolean; code?: string }[] }
  | { ok: false; status?: number; code?: string | null; capability?: string | null };

export type BatchSettle = {
  keep: ReadonlySet<string>;
  ok: number;
  failed: number;
  /** A client sentence to localize, when the call fell with no code to resolve. */
  reasonKey: "bulkNotPermitted" | "bulkRequestFailed" | "bulkInviteItemsRefused" | null;
  reasonCodes: string[];
  refusalCapability: string | null;
};

/** THE failures-stay-selected fold. Successes deselect; per-id failures and every
 *  `untouched` id stay selected for retry. A whole-request refusal keeps every attempted
 *  id and OVERRIDES the per-id codes (no per-id verdict was reached): its CODE when the
 *  door named one (with the capability it wanted), else the client's own line — the gate
 *  sentence for an uncoded 401/403, the transport sentence otherwise. `alreadyDone` counts
 *  rows that needed no round trip; `uncodedItemFailureKey` is the floor sentence for a
 *  door whose per-id refusals may arrive without codes. */
export function foldBatchSettle({
  attempted,
  untouched,
  response,
  alreadyDone = 0,
  uncodedItemFailureKey = null,
}: {
  attempted: readonly string[];
  untouched: readonly string[];
  response: BatchResponse;
  alreadyDone?: number;
  uncodedItemFailureKey?: "bulkInviteItemsRefused" | null;
}): BatchSettle {
  const failed = new Set<string>();
  const reasonCodes = new Set<string>();
  let ok = alreadyDone;
  if (response.ok) {
    for (const r of response.results) {
      if (r.ok) ok += 1;
      else {
        failed.add(r.id);
        if (r.code) reasonCodes.add(r.code);
      }
    }
    return {
      keep: new Set([...failed, ...untouched]),
      ok,
      failed: failed.size,
      reasonKey: failed.size > 0 && reasonCodes.size === 0 ? uncodedItemFailureKey : null,
      reasonCodes: [...reasonCodes],
      refusalCapability: null,
    };
  }
  for (const id of attempted) failed.add(id);
  const coded = !!response.code;
  return {
    keep: new Set([...failed, ...untouched]),
    ok,
    failed: failed.size,
    reasonKey: coded ? null : response.status === 401 || response.status === 403 ? "bulkNotPermitted" : "bulkRequestFailed",
    reasonCodes: coded ? [response.code as string] : [],
    refusalCapability: coded ? (response.capability ?? null) : null,
  };
}

/** A selection-changing transition: new set, the confirm disarmed, the line cleared. */
function withSelection(state: BulkSelectionState, selected: ReadonlySet<string>): BulkSelectionState {
  return { ...state, selected, confirm: bulkConfirmReducer(state.confirm, { type: "selectionChanged" }), result: null, movePreview: null };
}

export function bulkSelectionReducer(state: BulkSelectionState, ev: BulkSelectionEvent): BulkSelectionState {
  switch (ev.type) {
    case "reset":
      return { ...state, selected: new Set<string>(), confirm: null, result: null, movePreview: null };
    case "toggle": {
      const next = new Set(state.selected);
      if (next.has(ev.id)) next.delete(ev.id);
      else next.add(ev.id);
      return withSelection(state, next);
    }
    case "update":
      return withSelection(state, new Set(ev.update(state.selected)));
    case "selectAll":
      return withSelection(state, new Set(ev.ids));
    case "clear":
      // Clearing keeps the last action's line: it is the recruiter's own gesture after
      // reading it, not a new outcome.
      return { ...withSelection(state, new Set<string>()), result: state.result };
    case "reconcile": {
      const { selected, pruned } = reconcileSelection(state.selected, ev.entries);
      if (pruned.length === 0) return state;
      // The confirm is NOT touched here: if a departed row was in the signed cohort,
      // the signature already differs by derivation; if it was not, the people the
      // confirm names did not change.
      const prior = state.result;
      const result: BulkResult = prior
        ? { ...prior, departed: (prior.departed ?? 0) + pruned.length }
        : { ok: 0, failed: 0, verb: "departed", departed: pruned.length };
      return { ...state, selected, result };
    }
    case "arm":
      return { ...state, confirm: bulkConfirmReducer(state.confirm, ev) };
    case "cancel":
      return { ...state, confirm: bulkConfirmReducer(state.confirm, ev) };
    case "fired":
      return { ...state, confirm: bulkConfirmReducer(state.confirm, { type: "fired" }), result: null, busy: ev.busy ?? state.busy, movePreview: null };
    case "outreachStarted":
      return { ...state, outreach: { taskId: ev.taskId, cohort: [...ev.cohort] } };
    case "previewed":
      // The preview IS the status line while the confirm stands; the hook hides it the
      // moment the confirm stops being armed (a drift, a new target, a cancel).
      return {
        ...state,
        confirm: bulkConfirmReducer(state.confirm, { type: "arm", which: "move", ...ev.arm }),
        movePreview: ev.preview,
        result: { ok: 0, failed: 0, verb: "previewed", preview: summarizeMovePreview(ev.preview.rows) },
        busy: false,
      };
    case "settled":
      return { ...state, selected: new Set(ev.keep), confirm: null, result: ev.result, busy: false, movePreview: null };
    case "outreachSettled": {
      const run = state.outreach;
      if (!run || run.taskId !== ev.taskId) return state; // a late duplicate completion
      if (ev.failure) {
        // The whole run failed: the selection stays as the recruiter has it now, and
        // the count is the cohort the run was STARTED with.
        return {
          ...state,
          confirm: null,
          outreach: null,
          result: {
            ok: 0,
            failed: run.cohort.length,
            verb: "drafted",
            reason: ev.failure.reason,
            diagnostic: ev.failure.diagnostic,
          },
        };
      }
      const items = ev.results ?? [];
      const attempted = new Set(items.map((r) => r.id));
      const failed = new Set(items.filter((r) => !r.ok).map((r) => r.id));
      // Keep a selected id iff it failed, or the run never touched it.
      const keep = [...state.selected].filter((id) => failed.has(id) || !attempted.has(id));
      return {
        ...state,
        selected: new Set(keep),
        confirm: null,
        outreach: null,
        result: { ok: ev.ok ?? 0, failed: failed.size, verb: "drafted", reason: null },
      };
    }
  }
}
