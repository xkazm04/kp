"use client";

// PIPE1 / bdc7fc01 / P2-2 — bulk select mode and everything that acts on a cohort:
// the selection set, the scope-stamped two-step confirms, and the four batch actions
// (move, accept/reject, schedule invite, backgrounded outreach drafting) with their
// shared failures-stay-selected grammar. Split out of usePipelineTabState.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import { needsHumanDecision } from "@/app/_lib/approval-kinds";
import { armedConfirm, bulkConfirmReducer, type BulkConfirmIntent } from "./pipelineBulkConfirm";
import { selectionOutsideVisible } from "./pipelineSelectionScope";
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
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkStage, setBulkStage] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // `verb` selects the result label so the same status line reads correctly for a
  // stage move vs. a bulk accept/reject (bdc7fc01).
  // A bulk failure says WHY, not just how many — like the drag + drawer do. TWO
  // channels, deliberately: `reason` is a message this CLIENT already localized (the
  // whole-request refusal: the operator gate, a transport blip, an outreach task's
  // own error), while `reasonCodes` are the SERVER's per-id refusal codes (the 409
  // concurrency loss vs the 422 forbidden transition). The codes used to arrive as
  // English prose and were painted verbatim, so a Czech, German or French board read
  // its hottest refusals in English; the bar now resolves them through
  // errors.<CODE> in the reader's language.
  const [bulkResult, setBulkResult] = useState<{
    ok: number;
    failed: number;
    verb: "moved" | "accepted" | "rejected" | "invited" | "drafted";
    reason?: string | null;
    reasonCodes?: string[];
    /** The permission a FORBIDDEN_CAPABILITY refusal wanted (wave 18a ships it beside
     *  the code). Data for the bar's localized sentence - one per whole-request
     *  refusal, never per-id: a capability answer is about the seat, not the row. */
    refusalCapability?: string | null;
    /** The TASK RUNNER's own stored diagnostic for a failed background run. English
     *  prose with no code to resolve, so it is never the sentence the recruiter reads
     *  — the bar carries it as details (a `title`) beside the localized line. */
    diagnostic?: string | null;
  } | null>(null);
  // Bulk outreach runs as a BACKGROUND task (N letters = N LLM calls), so unlike the
  // synchronous move/decide it can't resolve inline — we track the task id and apply
  // the failures-stay-selected grammar when it finishes. lastOutreachApplied guards
  // the completion effect to fire exactly once per task.
  const [outreachTaskId, setOutreachTaskId] = useState<string | null>(null);
  const lastOutreachApplied = useRef<string | null>(null);
  // Two-step confirms for the two DESTRUCTIVE bulk actions, modelled as ONE
  // single-slot state (pipelineBulkConfirm.ts) so that "disarm on ANY selection
  // change" is one un-forgettable transition — the round-5 defect was two separate
  // booleans where only the reject flag got reset on a selection mutation, letting
  // an armed outreach confirm fire against a grown cohort. Reject emails N
  // candidates; outreach (WHEN a relay is configured) relays each drafted letter
  // immediately, so "draft N" IS "send N". Relay definitively off → drafts are
  // terminal Outbox rows and one click is safe; unknown capability (null) fails
  // safe like relay-on.
  //
  // bulk-acts-on-what-you-see — the confirm is additionally scoped to WHAT THE BOARD
  // WAS SHOWING when it was armed (visibleScope, owned by usePipelineFilters). Disarming
  // on a selection change alone left the mirror-image hole open: hold the selection still
  // and change the FILTER instead, and an armed reject survived into a board where its
  // cohort is invisible — one more click and they're emailed. The scope stamp closes it by
  // DERIVATION (armedConfirm) rather than by a disarm dispatch in each of the ~9
  // filter mutators, so a mutator added later is covered without anyone remembering.
  const [bulkConfirm, rawDispatchBulkConfirm] = useReducer(bulkConfirmReducer, null);
  // Children dispatch a scope-free intent ({type:"arm", which}); the hook stamps the
  // scope in force at the moment of the click. Keeping the scope out of the child API
  // means a new bulk control physically cannot arm an unscoped confirm.
  const dispatchBulkConfirm = useCallback(
    (intent: BulkConfirmIntent) =>
      rawDispatchBulkConfirm(intent.type === "arm" ? { ...intent, scope: visibleScope } : intent),
    [visibleScope]
  );
  const armedBulkConfirm = armedConfirm(bulkConfirm, visibleScope);
  const confirmingBulkReject = armedBulkConfirm === "reject";
  const confirmingBulkOutreach = armedBulkConfirm === "outreach";

  const { startTask } = useTasks();
  // Watch the in-flight bulk-outreach draft run: cheap status/progress from the poll,
  // and its full per-candidate result once it finishes (see the completion effect).
  const outreachTask = useTaskResult(outreachTaskId);

  // bulk-acts-on-what-you-see — the selected rows the current filter HIDES. The
  // selection is deliberately NOT pruned when the filter changes (a recruiter who
  // filtered down to review a subset has not abandoned the rest, and silently
  // shrinking a cohort they built is its own surprise); the board pays for keeping it
  // by DISCLOSING the over-reach on the bulk bar, so no bulk action — move, invite,
  // outreach, accept/reject — can act on rows the recruiter cannot see without saying
  // so first. Resolved against `filteredEntries`, i.e. exactly what the board renders.
  const selectedOutsideIds = useMemo(
    () => selectionOutsideVisible(selectedIds, filteredEntries),
    [selectedIds, filteredEntries]
  );
  const selectedOutsideCount = selectedOutsideIds.length;

  // bdc7fc01 — the awaiting-decision subset of the current selection (the only
  // entries bulk accept/reject can act on), plus a per-approval-kind breakdown so
  // a mixed selection (screening vs offer vs scorecard) is obvious before acting.
  const selectedAwaiting = useMemo(
    () =>
      [...selectedIds]
        .map((id) => (entries ?? []).find((x) => x.id === id))
        .filter((e): e is Entry => !!e && needsHumanDecision(e.approvalKind) && e.status === "active"),
    [selectedIds, entries]
  );
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
  const selectedActive = useMemo(
    () =>
      [...selectedIds]
        .map((id) => (entries ?? []).find((x) => x.id === id))
        .filter((e): e is Entry => !!e && e.status === "active"),
    [selectedIds, entries]
  );

  // PIPE1 — bulk move. ONE batch POST, each item carrying its OWN expectedStage
  // (the stage the board showed for THAT card) — a per-id 409 means a concurrent
  // actor moved that candidate, and the MatrixTab W11 grammar applies: the failure
  // STAYS SELECTED for retry while successes deselect.
  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
    setBulkResult(null);
    dispatchBulkConfirm({ type: "selectionChanged" });
  };
  const toggleSelected = (e: Entry) => {
    setBulkResult(null);
    dispatchBulkConfirm({ type: "selectionChanged" });
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(e.id)) next.delete(e.id);
      else next.add(e.id);
      return next;
    });
  };
  const selectAllVisible = () => {
    setBulkResult(null);
    dispatchBulkConfirm({ type: "selectionChanged" });
    setSelectedIds(new Set(filteredEntries.map((e) => e.id)));
  };
  const clearSelection = () => {
    setSelectedIds(new Set());
    dispatchBulkConfirm({ type: "selectionChanged" });
  };
  // A WHOLE-REQUEST batch refusal (the operator gate's 401/403, or a transport
  // blip with no per-id results) is NOT a per-id reason — surface an honest,
  // localized line so a bulk action that was blocked reads as blocked, not as a
  // silent count or a fabricated per-id error. Mirrors the command bar, which is
  // operator-gated in lock-step (batch-authz-parity).
  const batchRequestReason = (res: { ok: false; status?: number }): string =>
    res.status === 401 || res.status === 403 ? t("bulkNotPermitted") : t("bulkRequestFailed");
  // gated-doors-clients-read-the-refusal - the gate answers with a CODE now
  // (FORBIDDEN_CAPABILITY, carrying the capability it wanted). Prefer it over the
  // generic "not permitted" line: the code resolves in the reader's language AND
  // names the permission the operator has to ask for. No code (a transport blip, an
  // older server) still falls back to the client's own sentence.
  const batchRequestRefusal = (res: {
    ok: false;
    status?: number;
    code?: string | null;
    capability?: string | null;
  }): { reason: string | null; codes: string[]; capability: string | null } =>
    res.code
      ? { reason: null, codes: [res.code], capability: res.capability ?? null }
      : { reason: batchRequestReason(res), codes: [], capability: null };
  const bulkMove = async () => {
    if (!bulkStage || selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkResult(null);
    let moved = 0;
    const failures = new Set<string>();
    // A whole-request refusal reason (operator gate / transport), distinct from the
    // per-id server reasons — it overrides the per-id line when the whole call fell.
    let requestReason: string | null = null;
    // ...and its coded half, when the door named one (the capability gate does).
    let requestCodes: string[] = [];
    let requestCapability: string | null = null;
    // Distinct server refusal CODES across the refused entries (a batch can mix a
    // 409 concurrency loss with a 422 forbidden transition) — deduped so the status
    // line names WHY, not just how many, and localized where it is rendered.
    const reasonCodes = new Set<string>();
    // Build the batch: skip vanished entries; count an already-at-target card as
    // moved without a round trip (the server would no-op it anyway).
    const items: PipelineBatchItem[] = [];
    for (const id of selectedIds) {
      const entry = (entries ?? []).find((x) => x.id === id);
      if (!entry) continue; // vanished since selection — nothing left to move
      if (entry.stage === bulkStage) {
        moved += 1; // already at the target — done, deselect
        continue;
      }
      items.push({ id, action: "set_stage", toStage: bulkStage, expectedStage: entry.stage });
    }
    if (items.length > 0) {
      const res = await postPipelineBatch(items);
      if (res.ok) {
        for (const r of res.results) {
          if (r.ok) moved += 1;
          else {
            failures.add(r.id);
            if (r.code) reasonCodes.add(r.code);
          }
        }
      } else {
        // Whole-request failure (operator gate refusal or transport blip) — every
        // attempted item stays selected for retry, with an honest refusal reason.
        for (const it of items) failures.add(it.id);
        const refusal = batchRequestRefusal(res);
        requestReason = refusal.reason;
        requestCodes = refusal.codes;
        requestCapability = refusal.capability;
      }
    }
    setSelectedIds(failures);
    setBulkResult({
      ok: moved,
      failed: failures.size,
      verb: "moved",
      // A whole-request refusal OVERRIDES the per-id codes: when the call itself
      // fell, no per-id verdict was ever reached.
      reason: requestReason,
      reasonCodes: requestCodes.length ? requestCodes : requestReason ? [] : [...reasonCodes],
      refusalCapability: requestCapability,
    });
    setBulkBusy(false);
    await load();
  };

  // bdc7fc01 — bulk accept/reject the AWAITING cohort in the selection. Acts only
  // on selected entries that need a human decision (others have nothing to decide
  // and are left selected, untouched). ONE batch POST, each item carrying its OWN
  // expectedStage so a concurrent move is a per-id 409 that STAYS SELECTED for retry
  // — same grammar as bulkMove. A bulk reject emails everyone, so it's confirm-gated.
  const bulkDecide = async (action: "accept" | "reject") => {
    const awaiting = [...selectedIds]
      .map((id) => (entries ?? []).find((x) => x.id === id))
      .filter((e): e is Entry => !!e && needsHumanDecision(e.approvalKind) && e.status === "active");
    if (awaiting.length === 0 || bulkBusy) return;
    // bulk-acts-on-what-you-see — belt AND braces: reject emails everyone, so it fires
    // only while the confirm is armed UNDER THE CURRENT VISIBLE SCOPE. The bar already
    // reverts to the un-armed button when the scope changes, but the guard lives at the
    // fire site too, so a future caller (a shortcut, the command bar) can't route around
    // the render-level gate.
    if (action === "reject" && armedConfirm(bulkConfirm, visibleScope) !== "reject") {
      dispatchBulkConfirm({ type: "arm", which: "reject" });
      return;
    }
    setBulkBusy(true);
    setBulkResult(null);
    dispatchBulkConfirm({ type: "fired" });
    let ok = 0;
    const failed = new Set<string>();
    // Same as bulkMove: surface the server's distinct refusal codes for refused
    // decides (e.g. a 409 stage change that lost the CAS in the gap), not a count.
    const reasonCodes = new Set<string>();
    let requestReason: string | null = null;
    let requestCodes: string[] = [];
    let requestCapability: string | null = null;
    const items: PipelineBatchItem[] = awaiting.map((e) => ({ id: e.id, action, expectedStage: e.stage }));
    const res = await postPipelineBatch(items);
    if (res.ok) {
      for (const r of res.results) {
        if (r.ok) ok += 1;
        else {
          failed.add(r.id);
          if (r.code) reasonCodes.add(r.code);
        }
      }
    } else {
      // Whole-request failure (operator gate refusal or transport blip) — every
      // attempted decision stays selected for retry, with an honest refusal reason.
      for (const e of awaiting) failed.add(e.id);
      const refusal = batchRequestRefusal(res);
      requestReason = refusal.reason;
      requestCodes = refusal.codes;
      requestCapability = refusal.capability;
    }
    // Successes deselect; failures + any selected non-awaiting entries stay selected.
    const untouched = [...selectedIds].filter((id) => !awaiting.some((e) => e.id === id));
    setSelectedIds(new Set([...failed, ...untouched]));
    setBulkResult({
      ok,
      failed: failed.size,
      verb: action === "accept" ? "accepted" : "rejected",
      reason: requestReason,
      reasonCodes: requestCodes.length ? requestCodes : requestReason ? [] : [...reasonCodes],
      refusalCapability: requestCapability,
    });
    setBulkBusy(false);
    await load();
  };

  // P2-2 — send self-scheduling links to the selected ACTIVE cohort in one action
  // (the back half of the funnel was per-candidate-only). ONE round trip to the
  // bulk endpoint, which isolates each entry; successes deselect, failures + any
  // terminal selected entries stay selected for retry — same grammar as bulkDecide.
  const bulkInvite = async () => {
    if (selectedActive.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkResult(null);
    dispatchBulkConfirm({ type: "fired" });
    let ok = 0;
    const failed = new Set<string>();
    // gated-doors-clients-read-the-refusal - this door is capability-gated too, and
    // `if (r.ok)` alone made a viewer's refusal render as "0 invited, N failed" with
    // no reason at all. The whole-request refusal is read exactly the way the batch
    // one is: its CODE, plus the capability it named.
    let requestReason: string | null = null;
    let requestCodes: string[] = [];
    let requestCapability: string | null = null;
    // Distinct PER-ITEM refusal codes, deduped — the same channel bulkMove/bulkDecide
    // use for the batch route's per-id verdicts.
    const itemCodes = new Set<string>();
    try {
      const r = await fetch("/api/schedule/invite/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryIds: selectedActive.map((e) => e.id) }),
      });
      const d = (await r.json().catch(() => null)) as
        | { results?: { entryId: string; ok: boolean; code?: string }[]; code?: string; capability?: string }
        | null;
      if (r.ok && d?.results) {
        for (const res of d.results) {
          if (res.ok) {
            ok += 1;
            continue;
          }
          failed.add(res.entryId);
          // gated-doors-clients-read-the-refusal — the per-item branch used to read
          // NOTHING but `ok`, so a cohort where half the rows were refused rendered
          // "3 invited · 4 couldn't be invited" with no reason at all: not the cap,
          // not "no longer active", not a mint failure. A per-item CODE is read the
          // same way the batch route's is and resolves through the bar's existing
          // errors.<CODE> fold, in the reader's language.
          if (res.code) itemCodes.add(res.code);
        }
      } else {
        for (const e of selectedActive) failed.add(e.id);
        const refusal = batchRequestRefusal({ ok: false, status: r.status, code: d?.code ?? null, capability: d?.capability ?? null });
        requestReason = refusal.reason;
        requestCodes = refusal.codes;
        requestCapability = refusal.capability;
      }
    } catch {
      // A transport blip has no verdict to read - the cohort stays selected and the
      // client's own sentence is the honest answer.
      for (const e of selectedActive) failed.add(e.id);
      requestReason = t("bulkRequestFailed");
    }
    const untouched = [...selectedIds].filter((id) => !selectedActive.some((e) => e.id === id));
    setSelectedIds(new Set([...failed, ...untouched]));
    setBulkResult({
      ok,
      failed: failed.size,
      verb: "invited",
      // A whole-request refusal OVERRIDES the per-item verdicts (no per-item verdict
      // was ever reached). Otherwise: the server's per-item codes, which the bulk
      // invite route now mints for every refused row (SCHEDULE_BULK_* — /perfect wave
      // 40, lib-scheduling; it used to answer English prose like "not active", which is
      // NOT code-resolvable and must never be painted onto a localized board). The
      // honest localized line below stays as the floor for a server that sends none.
      reason: requestReason ?? (failed.size > 0 && itemCodes.size === 0 ? t("bulkInviteItemsRefused") : null),
      reasonCodes: requestCodes.length ? requestCodes : requestReason ? [] : [...itemCodes],
      refusalCapability: requestCapability,
    });
    setBulkBusy(false);
    await load();
  };

  // Draft tailored OUTREACH for the selected ACTIVE cohort in one action — the same
  // per-candidate "Draft outreach" the drawer runs, but for N candidates at once so a
  // filtered cohort of 8 isn't 8 drawer trips. Backgrounded (N letters = N LLM calls),
  // so this only STARTS the task; the drafts land in the Outbox as reviewable rows
  // (nothing auto-sends in the demo default) and the completion effect below applies
  // the failures-stay-selected grammar once the run finishes. Reuses the same task
  // machinery the board already tracks for batch-screen.
  const bulkOutreach = async () => {
    if (selectedActive.length === 0 || outreachTask.active) return;
    // With a relay configured (or unknown), a draft IS a send — same fire-site scope
    // guard as the reject above. Relay definitively off → drafts are terminal Outbox
    // rows and the one-click path stays.
    if (relayConfigured !== false && armedConfirm(bulkConfirm, visibleScope) !== "outreach") {
      dispatchBulkConfirm({ type: "arm", which: "outreach" });
      return;
    }
    setBulkResult(null);
    dispatchBulkConfirm({ type: "fired" });
    const started = await startTask("batch_outreach", { entryIds: selectedActive.map((e) => e.id) });
    if (started) {
      lastOutreachApplied.current = null; // a fresh run — allow its completion to apply once
      setOutreachTaskId(started.id);
    }
  };

  // Apply the batch grammar when the background draft run finishes: successes
  // deselect, per-candidate failures STAY selected for retry (plus any selected
  // entry the run never attempted — e.g. a terminal one), and the honest
  // queued-vs-sent count lands in the shared status line. A task-level failure
  // (the whole run threw) keeps the whole cohort selected and surfaces the reason.
  useEffect(() => {
    if (!outreachTaskId) return;
    if (outreachTask.status === "failed" || outreachTask.status === "interrupted" || outreachTask.status === "canceled") {
      if (lastOutreachApplied.current === outreachTaskId) return;
      lastOutreachApplied.current = outreachTaskId;
      // The runner's `error` is its own ENGLISH diagnostic (useTaskResult passes the
      // polled record's string through unchanged — there is no code to resolve), and
      // painting it here put the queue's English onto every localized board. The line
      // is localized now; the diagnostic rides as details for whoever is debugging.
      // The runner gaining a CODE is the tasks context's follow-up.
      setBulkResult({
        ok: 0,
        failed: selectedIds.size,
        verb: "drafted",
        reason: t("bulkTaskIncomplete"),
        diagnostic: outreachTask.error,
      });
      setOutreachTaskId(null);
      return;
    }
    const full = outreachTask.full;
    if (!full || full.id !== outreachTaskId) return;
    if (lastOutreachApplied.current === outreachTaskId) return;
    lastOutreachApplied.current = outreachTaskId;
    const res = (full.result as { ok?: number; total?: number; results?: { id: string; ok: boolean }[] } | null) ?? null;
    const items = res?.results ?? [];
    const attempted = new Set(items.map((r) => r.id));
    const failed = new Set(items.filter((r) => !r.ok).map((r) => r.id));
    // Keep a selected id iff it failed, or the run never touched it (untouched stays).
    setSelectedIds((cur) => new Set([...cur].filter((id) => failed.has(id) || !attempted.has(id))));
    setBulkResult({ ok: res?.ok ?? 0, failed: failed.size, verb: "drafted", reason: null });
    setOutreachTaskId(null);
    void load();
    // `t` joins the deps for the localized task-incomplete line; it is a stable
    // next-intl binding per namespace/locale, so it cannot re-fire the completion.
  }, [outreachTaskId, outreachTask.status, outreachTask.full, outreachTask.error, selectedIds, load, t]);

  return {
    selectMode,
    toggleSelectMode,
    selectedIds,
    toggleSelected,
    selectAllVisible,
    clearSelection,
    selectedOutsideCount,
    bulkStage,
    setBulkStage,
    bulkBusy,
    bulkResult,
    confirmingBulkReject,
    confirmingBulkOutreach,
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
