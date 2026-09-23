"use client";

// PIPE1 / bdc7fc01 / P2-2 — bulk select mode and everything that acts on a cohort:
// the selection set, the scope-stamped two-step confirms, and the four batch actions
// (move, accept/reject, schedule invite, backgrounded outreach drafting) with their
// shared failures-stay-selected grammar. Split out of usePipelineTabState.
//
// cohort-drift-forces-a-fresh-review (challenge-r06) — the selection, the armed confirm,
// the status line, the busy flag and the outreach run are ONE reducer
// (pipelineBulkSelection.ts). This hook is the network around it: it turns clicks and
// board loads into events and responses into ONE settle event. It never writes the
// selection directly, so no action can forget to disarm a confirm on the way out.

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import { type BulkConfirmIntent } from "./pipelineBulkConfirm";
import {
  EMPTY_BULK_SELECTION,
  actionableRows,
  armedBulkConfirm,
  bulkSelectionReducer,
  cohortSignature,
  foldBatchSettle,
  reconcileSelection,
  type BatchResponse,
  type BatchSettle,
  type BulkResult,
} from "./pipelineBulkSelection";
import { selectionOutsideVisible } from "./pipelineSelectionScope";
import {
  commitItemsFromPreview,
  needsConfirm,
  summarizeMovePreview,
  type MovePreviewPlan,
  type MovePreviewRow,
} from "./pipelineBulkMovePreview";
import { postPipelineBatch, type PipelineBatchItem } from "@/app/_lib/useAddToPipeline";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { PipelineTabTranslator } from "./pipelineTranslator";

export function usePipelineBulk({
  t,
  entries,
  filteredEntries,
  visibleScope,
  relayConfigured,
  load,
}: {
  t: PipelineTabTranslator;
  entries: Entry[] | null;
  /** Exactly what the board renders — the scope `selectAllVisible` and the
   *  over-reach disclosure are resolved against. */
  filteredEntries: readonly Entry[];
  /** The filter hook's identity for "what the board is showing" (usePipelineFilters). */
  visibleScope: string;
  relayConfigured: boolean | null;
  load: () => void;
}) {
  // PIPE1 — bulk select mode: the filters isolate a cohort ("7 aging"), select
  // mode lets the recruiter act on it as a batch instead of N drawer trips.
  const [selectMode, setSelectMode] = useState(false);
  const [bulkStage, setBulkStage] = useState("");
  // Two-step confirms for the two DESTRUCTIVE bulk actions live in the reducer's single
  // confirm slot (pipelineBulkConfirm.ts): reject emails N candidates; outreach (WHEN a
  // relay is configured) relays each drafted letter immediately, so "draft N" IS
  // "send N". Relay definitively off → drafts are terminal Outbox rows and one click is
  // safe; unknown capability (null) fails safe like relay-on.
  //
  // An armed confirm is stamped with WHAT THE BOARD WAS SHOWING (visibleScope, owned by
  // usePipelineFilters) and with the SIGNATURE of the cohort it names (id + stage +
  // decision kind). Either drifting — a filter change, or a poll that adds, drops or
  // re-stages a named candidate — de-arms it by derivation, so the next click re-arms
  // naming the new cohort instead of firing on people nobody confirmed.
  const [bulk, dispatch] = useReducer(bulkSelectionReducer, EMPTY_BULK_SELECTION);

  // Ghost ids — an entry closed by another actor drops off the board (the list excludes
  // terminal rows) while its id would stay selected. Derived first, so the counts are
  // right on the very render the board changes; the reconcile event then persists the
  // prune and discloses it once on the status line.
  const selectedIds = useMemo(
    () => (entries ? reconcileSelection(bulk.selected, entries).selected : bulk.selected),
    [bulk.selected, entries]
  );
  useEffect(() => {
    if (entries) dispatch({ type: "reconcile", entries });
  }, [entries]);

  // Children dispatch a scope-free, cohort-free intent ({type:"arm", which}); the hook
  // stamps the scope in force and the cohort on screen at the moment of the click, so a
  // new bulk control physically cannot arm an unsigned confirm.
  const dispatchBulkConfirm = useCallback(
    (intent: BulkConfirmIntent) => {
      if (intent.type === "arm") {
        dispatch({ ...intent, scope: visibleScope, cohort: cohortSignature(selectedIds, entries, intent.which, bulkStage) });
      } else {
        // cancel (or a child's selectionChanged / fired): disarm, selection untouched.
        dispatch({ type: "cancel" });
      }
    },
    [visibleScope, selectedIds, entries, bulkStage]
  );
  const armedBulk = armedBulkConfirm({ selected: selectedIds, confirm: bulk.confirm }, visibleScope, entries, bulkStage);
  const confirmingBulkReject = armedBulk === "reject";
  const confirmingBulkOutreach = armedBulk === "outreach";
  const confirmingBulkMove = armedBulk === "move";
  // A move preview is the status line only while its confirm stands: a drift, a new
  // target or a cancel de-arms it by derivation, and the sentence goes with it.
  const bulkResult = bulk.result?.verb === "previewed" && !confirmingBulkMove ? null : bulk.result;

  const { startTask } = useTasks();
  // Watch the in-flight bulk-outreach draft run: cheap status/progress from the poll,
  // and its full per-candidate result once it finishes (see the completion effect).
  const outreachTaskId = bulk.outreach?.taskId ?? null;
  const outreachTask = useTaskResult(outreachTaskId);

  // bulk-acts-on-what-you-see — the selected rows the current filter HIDES. The
  // selection is deliberately NOT pruned when the filter changes (a recruiter who
  // filtered down to review a subset has not abandoned the rest, and silently
  // shrinking a cohort they built is its own surprise); the board pays for keeping it
  // by DISCLOSING the over-reach on the bulk bar, so no bulk action — move, invite,
  // outreach, accept/reject — can act on rows the recruiter cannot see without saying
  // so first. Resolved against `filteredEntries`, i.e. exactly what the board renders,
  // over the RECONCILED selection, so a departed candidate is never counted as hidden.
  const selectedOutsideIds = useMemo(
    () => selectionOutsideVisible(selectedIds, filteredEntries),
    [selectedIds, filteredEntries]
  );
  const selectedOutsideCount = selectedOutsideIds.length;

  // bdc7fc01 — the awaiting-decision subset of the current selection (the only
  // entries bulk accept/reject can act on), plus a per-approval-kind breakdown so
  // a mixed selection (screening vs offer vs scorecard) is obvious before acting.
  // The SAME derivation the reject confirm signs (actionableRows).
  const selectedAwaiting = useMemo(() => actionableRows(selectedIds, entries, "reject"), [selectedIds, entries]);
  const awaitingKinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of selectedAwaiting) {
      const k = e.approvalKind ?? "decision";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()];
  }, [selectedAwaiting]);
  // P2-2 — the selected entries eligible for a bulk scheduling invite: any ACTIVE
  // candidate (never a terminal hired/rejected/declined one). The bulk-invite
  // endpoint re-checks status, so this is a UI gate, not the trust boundary.
  const selectedActive = useMemo(() => actionableRows(selectedIds, entries, "outreach"), [selectedIds, entries]);

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    dispatch({ type: "reset" });
  };
  const toggleSelected = (e: Entry) => dispatch({ type: "toggle", id: e.id });
  // A whole CELL at once (a Subway station in select mode): the caller hands the pure
  // set transform (subwayInteraction.toggleCellSelection), and the reducer applies
  // exactly a single toggle's side effects.
  const updateSelection = (update: (cur: ReadonlySet<string>) => ReadonlySet<string>) =>
    dispatch({ type: "update", update });
  const selectAllVisible = () => dispatch({ type: "selectAll", ids: filteredEntries.map((e) => e.id) });
  const clearSelection = () => dispatch({ type: "clear" });

  // ONE settle for every synchronous batch door: the fold's client-sentence key is
  // localized here (a whole-request refusal with no code, or an uncoded per-item
  // refusal); the codes resolve through errors.<CODE> where the bar renders them.
  const settle = (fold: BatchSettle, verb: BulkResult["verb"], extra: { heldBack?: number } = {}) => {
    dispatch({
      type: "settled",
      keep: fold.keep,
      result: {
        ok: fold.ok,
        failed: fold.failed,
        verb,
        reason: fold.reasonKey ? t(fold.reasonKey) : null,
        reasonCodes: fold.reasonCodes,
        refusalCapability: fold.refusalCapability,
        ...(extra.heldBack ? { heldBack: extra.heldBack } : {}),
      },
    });
  };

  // Commit a preview: EXACTLY the previewed rows, each pinned to the stage the preview
  // read (a row that moved since is a per-id 409 that stays selected). A row the move
  // would strip of a drafted offer is never sent; it stays selected with the reason.
  const commitMove = async (preview: MovePreviewPlan, selection: ReadonlySet<string>) => {
    const plan = commitItemsFromPreview(preview, selection);
    const response = plan.items.length > 0 ? await postPipelineBatch(plan.items) : ({ ok: true, results: [] } as const);
    const merged: BatchResponse = response.ok ? { ok: true, results: [...response.results, ...plan.refused] } : response;
    const attempted = [...plan.items.map((it) => it.id), ...plan.refused.map((r) => r.id)];
    settle(
      foldBatchSettle({ attempted, untouched: plan.heldBack, response: merged, alreadyDone: plan.alreadyThere.length }),
      "moved",
      { heldBack: plan.heldBack.length }
    );
    await load();
  };

  // PIPE1 — bulk move, previewed first (blast-radius-computation, challenge-r06). The
  // first click asks the batch door for a DRY RUN: what each row's arrival sets off,
  // read by the planner the stage-entered hook executes. A move that sets nothing off
  // commits right away (one click, as before); one that mails invites or assignments,
  // parks candidates, erases pending decisions or would destroy a drafted offer arms
  // the move confirm, and the bar states the preview. The confirm signs the cohort AND
  // the target, so a poll that re-stages anyone, or a new "Move to" column, re-previews.
  // Per-id failures STAY SELECTED for retry while successes deselect (MatrixTab W11).
  const bulkMove = async () => {
    if (!bulkStage || selectedIds.size === 0 || bulk.busy) return;
    const selection = selectedIds;
    if (
      bulk.movePreview &&
      bulk.movePreview.toStage === bulkStage &&
      armedBulkConfirm({ selected: selection, confirm: bulk.confirm }, visibleScope, entries, bulkStage) === "move"
    ) {
      const preview = bulk.movePreview;
      dispatch({ type: "fired", busy: true });
      await commitMove(preview, selection);
      return;
    }
    // Signed at the CLICK, over the rows the preview is asked about: a poll that lands
    // while the preview is in flight leaves the confirm un-armed, and the next click
    // previews again.
    const scope = visibleScope;
    const cohort = cohortSignature(selection, entries, "move", bulkStage);
    const rows = actionableRows(selection, entries, "move");
    dispatch({ type: "fired", busy: true });
    const items: PipelineBatchItem[] = rows.map((e) => ({ id: e.id, action: "set_stage", toStage: bulkStage, expectedStage: e.stage }));
    if (items.length === 0) {
      settle(foldBatchSettle({ attempted: [], untouched: [], response: { ok: true, results: [] } }), "moved");
      return;
    }
    const answer = await previewPipelineMove(items);
    if (!answer.ok) {
      settle(foldBatchSettle({ attempted: items.map((it) => it.id), untouched: [], response: answer }), "moved");
      return;
    }
    const preview: MovePreviewPlan = { toStage: bulkStage, rows: answer.rows };
    if (needsConfirm(summarizeMovePreview(preview.rows))) {
      dispatch({ type: "previewed", preview, arm: { scope, cohort } });
      return;
    }
    await commitMove(preview, selection);
  };

  // bdc7fc01 — bulk accept/reject the AWAITING cohort in the selection. Acts only
  // on selected entries that need a human decision (others have nothing to decide
  // and are left selected, untouched). ONE batch POST, each item carrying its OWN
  // expectedStage so a concurrent move is a per-id 409 that STAYS SELECTED for retry
  // — same grammar as bulkMove. A bulk reject emails everyone, so it's confirm-gated.
  const bulkDecide = async (action: "accept" | "reject") => {
    const awaiting = actionableRows(selectedIds, entries, "reject");
    if (awaiting.length === 0 || bulk.busy) return;
    // bulk-acts-on-what-you-see + cohort-drift-forces-a-fresh-review — belt AND braces:
    // reject fires only while the confirm is armed under the current visible scope AND
    // over exactly the cohort it names now. The set fired below is therefore the set
    // the recruiter confirmed. The guard lives at the fire site too, so a future caller
    // (a shortcut, the command bar) can't route around the render-level gate.
    if (action === "reject" && armedBulkConfirm({ selected: selectedIds, confirm: bulk.confirm }, visibleScope, entries) !== "reject") {
      dispatchBulkConfirm({ type: "arm", which: "reject" });
      return;
    }
    dispatch({ type: "fired", busy: true });
    const items: PipelineBatchItem[] = awaiting.map((e) => ({ id: e.id, action, expectedStage: e.stage }));
    const response = await postPipelineBatch(items);
    // Successes deselect; failures + any selected non-awaiting entries stay selected.
    const attempted = awaiting.map((e) => e.id);
    const untouched = [...selectedIds].filter((id) => !attempted.includes(id));
    settle(foldBatchSettle({ attempted, untouched, response }), action === "accept" ? "accepted" : "rejected");
    await load();
  };

  // P2-2 — send self-scheduling links to the selected ACTIVE cohort in one action
  // (the back half of the funnel was per-candidate-only). ONE round trip to the
  // bulk endpoint, which isolates each entry; successes deselect, failures + any
  // terminal selected entries stay selected for retry — same grammar as bulkDecide.
  const bulkInvite = async () => {
    if (selectedActive.length === 0 || bulk.busy) return;
    dispatch({ type: "fired", busy: true });
    const attempted = selectedActive.map((e) => e.id);
    // gated-doors-clients-read-the-refusal - this door is capability-gated too, so the
    // whole-request refusal is read exactly the way the batch one is: its CODE, plus
    // the capability it named. A per-item CODE (SCHEDULE_BULK_* — /perfect wave 40)
    // resolves through the bar's errors.<CODE> fold; a server that sends none gets the
    // honest localized floor (bulkInviteItemsRefused), never English prose.
    let response: Parameters<typeof foldBatchSettle>[0]["response"];
    try {
      const r = await fetch("/api/schedule/invite/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: attempted }),
      });
      const d = (await r.json().catch(() => null)) as
        | { results?: { entryId: string; ok: boolean; code?: string }[]; code?: string; capability?: string }
        | null;
      response =
        r.ok && d?.results
          ? { ok: true, results: d.results.map((x) => ({ id: x.entryId, ok: x.ok, code: x.code })) }
          : { ok: false, status: r.status, code: d?.code ?? null, capability: d?.capability ?? null };
    } catch {
      // A transport blip has no verdict to read - the cohort stays selected and the
      // client's own sentence is the honest answer.
      response = { ok: false };
    }
    const untouched = [...selectedIds].filter((id) => !attempted.includes(id));
    settle(foldBatchSettle({ attempted, untouched, response, uncodedItemFailureKey: "bulkInviteItemsRefused" }), "invited");
    await load();
  };

  // Draft tailored OUTREACH for the selected ACTIVE cohort in one action — the same
  // per-candidate "Draft outreach" the drawer runs, but for N candidates at once so a
  // filtered cohort of 8 isn't 8 drawer trips. Backgrounded (N letters = N LLM calls),
  // so this only STARTS the task; the drafts land in the Outbox as reviewable rows
  // (nothing auto-sends in the demo default) and the completion effect below settles
  // it once the run finishes, against the cohort it was STARTED with.
  const bulkOutreach = async () => {
    if (selectedActive.length === 0 || outreachTask.active) return;
    // With a relay configured (or unknown), a draft IS a send — same fire-site scope +
    // cohort guard as the reject above. Relay definitively off → drafts are terminal
    // Outbox rows and the one-click path stays.
    if (
      relayConfigured !== false &&
      armedBulkConfirm({ selected: selectedIds, confirm: bulk.confirm }, visibleScope, entries) !== "outreach"
    ) {
      dispatchBulkConfirm({ type: "arm", which: "outreach" });
      return;
    }
    dispatch({ type: "fired" });
    const cohort = selectedActive.map((e) => e.id);
    const started = await startTask("batch_outreach", { entryIds: cohort });
    if (started) dispatch({ type: "outreachStarted", taskId: started.id, cohort });
  };

  // Settle the background draft run when it finishes: successes deselect, per-candidate
  // failures STAY selected for retry (plus any selected entry the run never attempted),
  // and the honest queued-vs-sent count lands in the shared status line. A task-level
  // failure keeps the selection and reports the cohort the run was started with. The
  // reducer ignores a completion for a run it no longer tracks, so this is idempotent.
  useEffect(() => {
    if (!outreachTaskId) return;
    if (outreachTask.status === "failed" || outreachTask.status === "interrupted" || outreachTask.status === "canceled") {
      // The runner's `error` is its own ENGLISH diagnostic (no code to resolve), so the
      // line is localized and the diagnostic rides as details for whoever is debugging.
      dispatch({
        type: "outreachSettled",
        taskId: outreachTaskId,
        failure: { reason: t("bulkTaskIncomplete"), diagnostic: outreachTask.error },
      });
      return;
    }
    const full = outreachTask.full;
    if (!full || full.id !== outreachTaskId) return;
    const res = (full.result as { ok?: number; total?: number; results?: { id: string; ok: boolean }[] } | null) ?? null;
    dispatch({ type: "outreachSettled", taskId: outreachTaskId, failure: null, ok: res?.ok ?? 0, results: res?.results ?? [] });
    void load();
    // `t` joins the deps for the localized task-incomplete line; it is a stable
    // next-intl binding per namespace/locale, so it cannot re-fire the completion.
  }, [outreachTaskId, outreachTask.status, outreachTask.full, outreachTask.error, load, t]);

  return {
    selectMode,
    toggleSelectMode,
    selectedIds,
    toggleSelected,
    updateSelection,
    selectAllVisible,
    clearSelection,
    selectedOutsideCount,
    bulkStage,
    setBulkStage,
    bulkBusy: bulk.busy,
    bulkResult,
    confirmingBulkReject,
    confirmingBulkOutreach,
    confirmingBulkMove,
    dispatchBulkConfirm,
    selectedAwaiting,
    awaitingKinds,
    selectedActive,
    bulkMove,
    bulkDecide,
    bulkInvite,
    bulkOutreach,
    outreachTaskActive: outreachTask.active,
  };
}

export type PipelineBulkState = ReturnType<typeof usePipelineBulk>;

/** The batch door's DRY RUN for a bulk move: per-id previews, or the whole-request
 *  refusal read exactly the way the commit reads it (its code and the capability it
 *  named), so the fold can report either. Nothing is written server-side. */
async function previewPipelineMove(
  items: PipelineBatchItem[]
): Promise<{ ok: true; rows: MovePreviewRow[] } | Extract<BatchResponse, { ok: false }>> {
  try {
    const r = await fetch("/api/pipeline/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true, items }),
    });
    const d = (await r.json().catch(() => null)) as { results?: MovePreviewRow[]; code?: string; capability?: string } | null;
    if (r.ok && Array.isArray(d?.results)) return { ok: true, rows: d.results };
    return { ok: false, status: r.status, code: d?.code ?? null, capability: d?.capability ?? null };
  } catch {
    // A transport blip: no verdict to read; the cohort stays selected.
    return { ok: false };
  }
}
