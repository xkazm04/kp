// All state, data-fetching and mutation logic for the Decisions tab: the
// pending/AI-review/reconsider queues, batch select+accept/reject, the
// screening-wave/group-eval modal wiring, and the one-shot ?arm= handoff.
// Split out of DecisionsTab.tsx (a pure logic hook, no JSX) so the tab's
// render shell can stay under the 200-line cap.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { postPipelineBatch, type PipelineBatchItem } from "@/app/_lib/useAddToPipeline";
import { toast } from "@/app/_components/toast-store";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import { sharedGetJson } from "@/app/features/shared/sharedGet";
import { waveReasonText } from "@/app/_lib/decision-attribution";
import type { GroupEvalPayload } from "./GroupEvalModal";
import { ARM_PARAM, parseArmParam } from "@/app/features/shared/groupEvalArm";
import { isScoreStale, type Entry } from "@/app/features/shared/decisionsTypes";
import { selectionCacheKey } from "./groupEval/cache-key";
import { pruneSelection, selectionDriftIds } from "./decisionsSelectionHygiene";
import { peersForEntry, type JobPeerContext, type PeerContextMap, type PeerScore } from "./decisionsPeerCompare";
import { isDecisionsQueueEntry, roleKeyOf, type Group, type ReconsiderReason, type ReconsiderRow } from "./decisionsQueueTypes";

export function useDecisionsQueue() {
  const search = useSearchParams();
  const t = useTranslations("decisions");
  const tWave = useTranslations("decisions.wave"); // shared sealed-reason resolver scope
  const locale = useLocale(); // PREP2 — prep pack language
  // REC-10 — "Offer sent" is only claimed when a relay delivers; without one
  // the letter is a terminal outbox row and the recruiter must hand over the link.
  const relayConfigured = useDeliveryCapability();
  const { startTask } = useTasks();
  // Filter the queue to one opened JD (deep-linkable via ?job=<id>).
  const [jobFilter, setJobFilter] = useState<string | null>(search.get("job"));
  // shortlist-to-group-eval — pre-arm handoff from the Match shortlist:
  // ?job=<jobId>&arm=<entryId,entryId,…> arms round-9's selection mode on that
  // role's row with the ids pre-picked (the recruiter still clicks "Compare N" —
  // a group eval is a paid LLM run, never auto-fired from a URL). Both values are
  // captured ONCE at mount (state initializers), because the param is one-shot:
  // the effect below strips ?arm= from the address bar so a refresh or a shared
  // link can never re-arm a stale selection against a changed cohort. armIds is
  // shape-validated here; membership in the live cohort is enforced at seed time
  // (RoleDecisionRow → seedArmSelection) and again by the server.
  const [armIds] = useState<string[] | null>(() => parseArmParam(search.get(ARM_PARAM)));
  const [armJobId] = useState<string | null>(() => search.get("job"));
  useEffect(() => {
    // One-shot consumption: drop ?arm= via history.replaceState, deliberately NOT
    // a router navigation — per buildUrl's notes a raw history write doesn't
    // re-render useSearchParams, which is exactly right for erasing a param whose
    // value is already captured in mount state (no re-render, no nav churn). Runs
    // even when the param failed validation: a malformed arm is dead weight too.
    if (!search.has(ARM_PARAM)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(ARM_PARAM);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Record<string, "accept" | "reject" | "approve_event">>({});
  // Candidates whose screening was accepted THIS sitting — accepting silently
  // queues them on Schedule (approvalKind flips to "calendar" server-side), so
  // the banner below narrates the handoff and offers the jump. Session-local on
  // purpose: it is a "what just happened" trail, not a persistent inbox.
  const [queuedLabels, setQueuedLabels] = useState<string[]>([]);
  // OO-L1-02 — offers extended THIS sitting. The server answers "Send offer"
  // with { offerExtended, link } and the card fades away; without this the
  // secure /offer/[token] link was discarded on the wire and only recoverable
  // by digging through the Comms Center. Session-local like queuedLabels.
  const [sentOffers, setSentOffers] = useState<{ id: string; label: string; link: string }[]>([]);
  const [copiedOfferId, setCopiedOfferId] = useState<string | null>(null);

  // Modal + group-eval state
  const [summaryEntry, setSummaryEntry] = useState<Entry | null>(null);
  // The role whose screening wave (DEC1/DEC2) is open — jobId + title for the modal.
  const [waveRole, setWaveRole] = useState<{ jobId: string; title: string } | null>(null);
  const [evalRole, setEvalRole] = useState<{ roleKey: string; roleTitle: string } | null>(null);
  // Governance mode for the next group evaluation (P1-3). "recommendation" keeps the
  // AI-picks-a-lead default; "committee" / "eligibility_list" make the AI advisory.
  const [evalMode, setEvalMode] = useState<"recommendation" | "committee" | "eligibility_list">("recommendation");
  const [evalData, setEvalData] = useState<GroupEvalPayload | null>(null);
  const [evalCreatedAt, setEvalCreatedAt] = useState<string | null>(null);
  const [evalTaskId, setEvalTaskId] = useState<string | null>(null);
  // Whether the in-flight eval run is over an explicit SELECTION (selection-rerun-cache).
  // Its result is cached under the selection's own key, so it must not flip the role's
  // "evaluated" chip, which promises a role-level top-N eval.
  const [evalIsSelection, setEvalIsSelection] = useState(false);
  // Set when a role marked "evaluated" has an unreadable/missing saved payload, so the modal
  // shows an honest "couldn't load — re-run" instead of the misleading "no evaluation yet".
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evaluated, setEvaluated] = useState<Record<string, string>>({});

  // Direction 2 (queue-staleness) — the JD content-edit time per role, fetched for
  // the AI-review jobs so a card can flag a score computed before the JD changed.
  // Server derives (jd-freshness route, workspace-scoped); the card applies the
  // shared isScoreStale rule against each entry's canonical analysis timestamp.
  const [jdEditedAt, setJdEditedAt] = useState<Record<string, string | null>>({});

  // Peer-comparison facts (salary expectation + verified per-JD skill coverage
  // from the freshest stored analysis, plus the role band) per AI-review job —
  // the card-level "how does this candidate sit vs the rest of the pipeline"
  // context. Same fetch cadence as jdEditedAt (keyed off the job set).
  const [peerCtx, setPeerCtx] = useState<PeerContextMap>({});

  // idea-e43fa801 — the reconsider (auto-rejected) queue, loaded alongside the
  // pending queue and refreshed on the same signals.
  const [reconsider, setReconsider] = useState<ReconsiderRow[]>([]);
  const [reinstating, setReinstating] = useState<ReadonlySet<string>>(new Set());
  // reconsider-earns-keep — the queue is a collapsed <details> at the bottom, but a
  // count chip in the header (below) surfaces it; clicking the chip opens the
  // details and scrolls to it. Controlled so the chip can drive it.
  const [reconsiderOpen, setReconsiderOpen] = useState(false);
  const reconsiderRef = useRef<HTMLDetailsElement | null>(null);
  const revealReconsider = () => {
    setReconsiderOpen(true);
    // Let the details expand, then bring it into view.
    requestAnimationFrame(() => reconsiderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // Direction 1 — batch accept/reject for AI review cards. POST /api/pipeline/batch
  // already offers per-id CAS + verbatim per-id failure reasons; this reuses the
  // board's PipelineTab.bulkDecide grammar (successes clear, failures stay selected
  // for retry, reject is confirm-gated because it emails candidates). offer_review
  // is EXCLUDED from multi-select (see selectableReviews below): the batch response
  // discards the extended offer's secure link + the per-offer deadline lever, so an
  // offer accept stays a one-by-one ceremony.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedReviewIds, setSelectedReviewIds] = useState<ReadonlySet<string>>(new Set());
  // Direction 3 — the selectable cohort captured at "select all" time. Cards that
  // arrive AFTER (a live poll, an automation wave) aren't in it, so a non-empty
  // selectionDrift means select-all is silently stale — surfaced as a re-select cue.
  // Null when select-all wasn't used (or was reset), which reads as no drift.
  // The snapshot carries the ROLE FILTER it was taken under: the selectable cohort is
  // filter-scoped, so a snapshot taken on one role compared against another role's
  // cohort reported every newly-visible card as "arrived" — select all under a role
  // filter, then clear the filter, and the amber cue claimed "3 new cards arrived"
  // about cards that had been there all along. A snapshot from a different filter is
  // no longer a snapshot of this cohort, so it reads as no drift.
  const [selectAllSnapshot, setSelectAllSnapshot] = useState<{ filter: string | null; ids: string[] } | null>(null);
  // Direction 2b — candidates whose rejection notification failed to queue during a
  // committed screening wave. Session-local (like queuedLabels): a "what just
  // happened" trail naming WHO needs a manual nudge, kept discoverable after the
  // wave modal closes. Each failure is ALSO an audited rejection_comms_failed event
  // (the Decision Log in Analytics) — no new store, this just re-surfaces it.
  // Direction 3 — grouped PER committed wave (not a flat, ever-growing name list):
  // each committed wave with comms failures pushes one { count, labels } group, so
  // the banner can group + cap ("+N more") instead of appending names uncapped.
  const [waveCommsFailed, setWaveCommsFailed] = useState<{ count: number; labels: string[] }[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ ok: number; failed: number; verb: "accepted" | "rejected"; reason: string | null } | null>(null);
  const [confirmingBulkReject, setConfirmingBulkReject] = useState(false);

  // One-writer-wins for the queue read. `load` runs from mount, from the live-refresh
  // bus (which fires from OTHER windows too), from reinstate and from act()'s
  // rollback, so two reads can be in flight at once — and a read that STARTED before
  // a decision landed carries a pre-decision snapshot. Letting such a response settle
  // put the just-decided card back on screen after act() had removed it: the exact
  // vanish-then-reappear the no-optimistic-removal rewrite in act() exists to
  // prevent, with a live Advance/Reject button over an entry the server already
  // moved. Every read takes a ticket, a confirmed decision invalidates outstanding
  // tickets, and a superseded response is dropped instead of clobbering fresher state.
  const loadTicket = useRef(0);
  // Sharing is OPT-IN (see usePipelineBoardData): `load` is also the post-action
  // reconcile, which must always hit the network.
  const load = (opts?: { shared?: boolean }) => {
    const ticket = ++loadTicket.current;
    return sharedGetJson<{ entries?: Entry[]; error?: string }>("/api/pipeline", { refresh: !opts?.shared })
      .then((p) => {
        if (ticket !== loadTicket.current) return; // superseded by a newer read or a landed decision
        if (p.error) throw new Error(p.error);
        setEntries((p.entries as Entry[]) ?? []);
      })
      .catch((e) => {
        if (ticket !== loadTicket.current) return;
        setError(e instanceof Error ? e.message : t("loadFailed"));
      });
  };
  const loadReconsider = () =>
    fetch("/api/decisions/reconsider")
      .then((r) => r.json())
      .then((p) => setReconsider((p.items as ReconsiderRow[]) ?? []))
      .catch(() => undefined);
  useEffect(() => {
    load({ shared: true }); // mount read may ride a sibling's in-flight request
    loadReconsider();
  }, []);
  useLiveRefresh(() => {
    load();
    loadReconsider();
  }); // live-update both queues when the simulation / automation acts

  const reinstate = async (item: ReconsiderRow) => {
    setReinstating((s) => new Set(s).add(item.id));
    try {
      const r = await fetch(`/api/pipeline/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reinstate" }),
      });
      if (r.ok) {
        setReconsider((cur) => cur.filter((x) => x.id !== item.id));
        load(); // the candidate is back in the active pipeline at Screened
      }
    } finally {
      setReinstating((s) => {
        const n = new Set(s);
        n.delete(item.id);
        return n;
      });
    }
  };
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));

  // reconsider-earns-keep — localize the sealed reject reason through the SAME
  // decisions.wave.reasons.* catalog the screen-wave modal renders, now via the ONE
  // shared resolver (waveReasonText) the records panel + decision log also call, so the
  // audit reads in the recruiter's language and the surfaces can never drift.
  const reconsiderReasonText = (r: ReconsiderReason): string | null => waveReasonText(tWave, r);

  // Only the kinds THIS tab renders (isDecisionsQueueEntry) — an active entry sitting
  // on the Schedule tab's `calendar` gate is not a decision waiting here.
  const pending = (entries ?? []).filter(isDecisionsQueueEntry);
  const keyDecisions = pending.filter((e) => e.approvalKind === "decision");
  const aiReviews = pending.filter(
    (e) =>
      e.approvalKind === "screening_review" ||
      e.approvalKind === "scorecard_review" ||
      e.approvalKind === "rejection_review" ||
      e.approvalKind === "offer_review"
  );

  // Direction 2 — the distinct JD-backed jobs among the AI reviews, fetched once
  // (and on live refresh) for their last content-edit time. Keyed off entries so a
  // poll that doesn't change the job set doesn't refetch.
  const aiReviewJobKey = useMemo(
    () => [...new Set(aiReviews.map((e) => e.jobId).filter((j): j is string => Boolean(j)))].sort().join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries]
  );
  useEffect(() => {
    // No AI-review jobs → nothing to fetch. Any previously-fetched entries are
    // harmless (staleSinceOf only reads the jobId of a card that's still present).
    if (!aiReviewJobKey) return;
    let alive = true;
    fetch(`/api/decisions/jd-freshness?jobs=${encodeURIComponent(aiReviewJobKey)}`)
      .then((r) => r.json())
      .then((p) => alive && setJdEditedAt((p.editedAt as Record<string, string | null>) ?? {}))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [aiReviewJobKey]);
  // Peer-comparison facts for the same job set (salary + skill coverage + role
  // band). Best-effort: a failure just hides the comparison chrome.
  useEffect(() => {
    if (!aiReviewJobKey) return;
    let alive = true;
    fetch(`/api/decisions/peer-context?jobs=${encodeURIComponent(aiReviewJobKey)}`)
      .then((r) => r.json())
      .then((p) => alive && setPeerCtx((p.jobs as PeerContextMap) ?? {}))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [aiReviewJobKey]);
  // The JD-edit date to show on a card when its score predates that edit (else null).
  const staleSinceOf = (e: Entry): string | null => {
    const scoredAt = e.scoreProvenance?.source === "analysis" ? e.scoreProvenance.at : null;
    const edited = e.jobId ? jdEditedAt[e.jobId] ?? null : null;
    return isScoreStale(scoredAt, edited) ? edited : null;
  };

  // Distinct roles (opened JDs) with pending decisions, for the filter dropdown.
  const jobOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of pending) map.set(roleKeyOf(e), e.jobTitle ?? t("unassignedRole"));
    return [...map.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);
  // If the active filter no longer matches any pending role, fall back to all.
  const activeFilter = jobFilter && jobOptions.some((o) => o.key === jobFilter) ? jobFilter : null;
  const matchesFilter = (e: Entry) => !activeFilter || roleKeyOf(e) === activeFilter;
  const visibleAiReviews = aiReviews.filter(matchesFilter);
  // Batchable AI reviews: offer_review is excluded (extendOffer's secure link + the
  // per-offer deadline are dropped by the batch response — see the state comment).
  const selectableReviews = visibleAiReviews.filter((e) => e.approvalKind !== "offer_review");
  const hasOfferReviews = visibleAiReviews.some((e) => e.approvalKind === "offer_review");
  const selectedReviews = selectableReviews.filter((e) => selectedReviewIds.has(e.id));

  // Direction 3 — prune selected ids whose cards vanished (committed elsewhere,
  // moved, filtered out) on every load/refresh, so the Set never leaks stale ids.
  // pruneSelection returns the same reference when nothing changed, so a clean poll
  // is a no-op that doesn't re-render.
  const selectableIdKey = selectableReviews.map((e) => e.id).join(",");
  useEffect(() => {
    // Reconciling selection to the present cohort — the legitimate effect use, and
    // a no-op (identity bail) when nothing was pruned.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedReviewIds((cur) => pruneSelection(cur, selectableReviews.map((e) => e.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectableIdKey]);
  // How many selectable cards arrived since "select all" — drives the drift cue.
  // Only a snapshot of THIS filter's cohort can be compared against it (see above).
  const selectionDrift = selectionDriftIds(
    selectAllSnapshot && selectAllSnapshot.filter === activeFilter ? selectAllSnapshot.ids : null,
    selectableReviews.map((e) => e.id)
  ).length;

  const toggleReviewSelect = (e: Entry) => {
    setBulkResult(null);
    setConfirmingBulkReject(false);
    setSelectedReviewIds((cur) => {
      const next = new Set(cur);
      if (next.has(e.id)) next.delete(e.id);
      else next.add(e.id);
      return next;
    });
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedReviewIds(new Set());
    setSelectAllSnapshot(null);
    setBulkResult(null);
    setConfirmingBulkReject(false);
  };
  const selectAllReviews = () => {
    setBulkResult(null);
    setConfirmingBulkReject(false);
    const ids = selectableReviews.map((e) => e.id);
    setSelectedReviewIds(new Set(ids));
    // Snapshot the cohort we just selected across, with the filter that scoped it —
    // drift is measured against this, and only under the same filter.
    setSelectAllSnapshot({ filter: activeFilter, ids });
  };
  const clearSelectedReviews = () => {
    setSelectedReviewIds(new Set());
    setSelectAllSnapshot(null);
    setConfirmingBulkReject(false);
    setBulkResult(null);
  };

  // ONE batch POST per action, each item carrying its OWN expectedStage CAS snapshot
  // (the stage the card rendered from) — a concurrent move is a per-id 409 that STAYS
  // selected for retry while successes clear. Mirrors PipelineTab.bulkDecide exactly;
  // rejects route through the batch endpoint's runPipelineEntryAction → dispatchRejection
  // (the same comms the one-by-one path fires — not duplicated here).
  const bulkDecideReviews = async (action: "accept" | "reject") => {
    const targets = selectedReviews;
    if (targets.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkResult(null);
    setConfirmingBulkReject(false);
    let ok = 0;
    const failed = new Set<string>();
    const reasons = new Set<string>();
    const items: PipelineBatchItem[] = targets.map((e) => ({ id: e.id, action, expectedStage: e.stage }));
    const res = await postPipelineBatch(items);
    if (res.ok) {
      const okIds = new Set(res.results.filter((r) => r.ok).map((r) => r.id));
      for (const r of res.results) {
        if (r.ok) ok += 1;
        else {
          failed.add(r.id);
          if (r.reason) reasons.add(r.reason);
        }
      }
      // Preserve the one-by-one accept's forward handoff: each accepted screening
      // review flows to Schedule, so backfill its interview-prep artifact and name
      // it in the queued banner — parity with act()'s screening_review branch.
      if (action === "accept") {
        const acceptedScreenings = targets.filter((e) => okIds.has(e.id) && e.approvalKind === "screening_review");
        for (const e of acceptedScreenings) {
          void startTask("interview_prep", { entryId: e.id, candidateLabel: e.candidateLabel, jobTitle: e.jobTitle, lang: locale });
        }
        if (acceptedScreenings.length > 0) setQueuedLabels((prev) => [...prev, ...acceptedScreenings.map((e) => e.candidateLabel)]);
      }
      // Same contract as act(): a row leaves only once the server confirmed it — and
      // then it leaves right away. The reconcile load() below is no longer what
      // REMOVES these cards, so an unrelated read finishing between the batch and
      // that load can't leave the decided cards on screen with live buttons.
      if (okIds.size > 0) {
        loadTicket.current += 1;
        setEntries((prev) => (prev ? prev.filter((x) => !okIds.has(x.id)) : prev));
      }
    } else {
      // Transport-level failure — every attempted decision stays selected for retry.
      for (const e of targets) failed.add(e.id);
    }
    // Successes clear; failures + any selected non-selectable strays stay selected.
    const untouched = [...selectedReviewIds].filter((id) => !targets.some((e) => e.id === id));
    setSelectedReviewIds(new Set([...failed, ...untouched]));
    // The cohort just changed under us — a stale select-all snapshot would read as
    // permanent drift, so reset it (the recruiter re-selects if they want the rest).
    setSelectAllSnapshot(null);
    setBulkResult({
      ok,
      failed: failed.size,
      verb: action === "accept" ? "accepted" : "rejected",
      reason: reasons.size ? [...reasons].join(" · ") : null,
    });
    setBulkBusy(false);
    await load();
  };

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const e of keyDecisions) {
      const roleKey = roleKeyOf(e);
      if (!map.has(roleKey)) map.set(roleKey, { roleKey, roleTitle: e.jobTitle ?? t("unassignedRole"), jobId: e.jobId, entries: [] });
      map.get(roleKey)!.entries.push(e);
    }
    return [...map.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);
  const roleKeys = groups.map((g) => g.roleKey).join(",");
  const visibleGroups = groups.filter((g) => !activeFilter || g.roleKey === activeFilter);

  // Which roles already have a saved evaluation (toggles the button label).
  useEffect(() => {
    if (!roleKeys) return;
    fetch(`/api/decisions/group-eval?roles=${encodeURIComponent(roleKeys)}`)
      .then((r) => r.json())
      .then((p) => setEvaluated(p.evaluated ?? {}))
      .catch(() => undefined);
  }, [roleKeys]);

  // Watch the group-eval background task; its result is fetched on demand once it
  // finishes (the poll omits the blob). Completion is consumed DURING render
  // (guarded: the task id is cleared in the same pass, so this runs once per
  // task) — the guarded render-phase pattern instead of an effect round-trip.
  const { status: evalStatus, full: evalFull } = useTaskResult(evalTaskId);
  if (evalTaskId && evalStatus === "succeeded" && evalFull) {
    setEvalData((evalFull.result as GroupEvalPayload) ?? null);
    setEvalTaskId(null);
    // Only a top-N run makes the ROLE "evaluated" — a selection run's eval lives under
    // its own cache key (selection-rerun-cache), and claiming the role otherwise would
    // send the next default open to a role-level row that was never written.
    if (evalRole && !evalIsSelection) setEvaluated((s) => ({ ...s, [evalRole.roleKey]: new Date().toISOString() }));
  } else if (evalTaskId && (evalStatus === "failed" || evalStatus === "canceled" || evalStatus === "interrupted")) {
    setEvalTaskId(null);
  }

  // Resolves TRUE only when the server confirmed the decision, FALSE on any failure
  // (a stale-stage 409, a transport error, a 500). Callers that claim an outcome —
  // DecisionsModals seals the group-eval reject identity and toasts "the reason is on
  // the audit record" — must await this instead of firing and forgetting: a 409 means
  // the candidate was NOT rejected, no rationale was sealed and no notice was queued,
  // so a green toast over a permanently-sealed button is a success the server never
  // gave. The boolean is the half this hook owns; the awaiting is the caller's.
  const act = async (e: Entry, action: "accept" | "reject" | "approve_event", detail?: string, ttlDays?: number): Promise<boolean> => {
    // Direction 2a — the row leaves ONLY when the server confirms. The old path
    // scheduled a 260ms timer that dropped the row BEFORE the fetch resolved, so a
    // slow network showed a vanish-then-reappear on an irreversible reject. Now the
    // in-flight card shows a subtle pending state (leavingWrapClass) and is removed
    // on the 200, or cleanly restored on failure — no optimistic disappearance.
    setResolving((s) => ({ ...s, [e.id]: action }));
    try {
      const note = detail?.trim();
      const r = await fetch(`/api/pipeline/${e.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // expectedStage pins the decision to the snapshot this card/modal was
        // rendered from (idea-84392364): the queue live-refreshes while the
        // analysis modal can stay open across a state change, so a stale
        // Advance/Reject now gets a 409 (and the catch below reloads the fresh
        // queue) instead of blindly overriding what another actor did.
        // An optional reason (DEC4) rides as `detail` → recorded on the
        // advanced/rejected event → shown in the Decision Log.
        body: JSON.stringify({ action, expectedStage: e.stage, ...(note ? { detail: note } : {}), ...(ttlDays ? { ttlDays } : {}) }),
      });
      if (!r.ok) throw new Error();
      // Surface the offer-extension result instead of discarding it (OO-L1-02):
      // the response carries the candidate's secure accept/decline link — confirm
      // the send with a toast and keep the link copyable in the banner below.
      const p = (await r.json().catch(() => null)) as { offerExtended?: boolean; link?: unknown; routedToHumanRound?: boolean } | null;
      // HYBRID HANDOFF (interviewPlan): the accepted AI scorecard routed the
      // candidate to the human round's calendar gate — narrate the Schedule
      // handoff exactly like an accepted screening does.
      if (action === "accept" && e.approvalKind === "scorecard_review" && p?.routedToHumanRound) {
        setQueuedLabels((prev) => [...prev, e.candidateLabel]);
      }
      if (action === "accept" && e.approvalKind === "offer_review" && p?.offerExtended && typeof p.link === "string") {
        const link = p.link;
        if (relayConfigured === false) toast.info(t("offerSent.toastQueued", { name: e.candidateLabel }));
        else toast.success(t("offerSent.toast", { name: e.candidateLabel }));
        setSentOffers((prev) => [...prev.filter((o) => o.id !== e.id), { id: e.id, label: e.candidateLabel, link }]);
      }
      // Accepting an AI screening flows the candidate to interview scheduling —
      // generate their interview-prep artifact in the background so it's ready
      // when the interviewer opens it from the Schedule tab.
      if (action === "accept" && e.approvalKind === "screening_review") {
        void startTask("interview_prep", {
          entryId: e.id,
          candidateLabel: e.candidateLabel,
          jobTitle: e.jobTitle,
          lang: locale,
        });
        setQueuedLabels((prev) => [...prev, e.candidateLabel]);
      }
      // Server confirmed — NOW the row leaves. Before this point it was only
      // dimmed (pending), never removed, so nothing can vanish-then-reappear.
      // Invalidate any read that started before this decision: its snapshot still
      // holds this row and would put the card straight back (see loadTicket).
      loadTicket.current += 1;
      setEntries((prev) => (prev ? prev.filter((x) => x.id !== e.id) : prev));
      return true;
    } catch {
      // Roll back cleanly: clear the pending state so the card returns to normal.
      // A stale-stage 409 carried the fresh entry, so reload to reconcile the queue
      // to reality — the row never disappeared first, so this isn't a reappear.
      setResolving((s) => {
        const n = { ...s };
        delete n[e.id];
        return n;
      });
      load();
      return false;
    }
  };

  const openGroupEval = async (g: Group, rerun = false, selection?: string[]) => {
    setEvalRole({ roleKey: g.roleKey, roleTitle: g.roleTitle });
    setEvalData(null);
    setEvalCreatedAt(null);
    setEvalTaskId(null);
    setEvalError(null);
    const hasSelection = Array.isArray(selection) && selection.length > 0;
    const cohortCands = g.entries.map((e) => ({ entryId: e.id, candidateId: e.candidateId, label: e.candidateLabel, matchScore: e.matchScore }));
    // Selection: send the chosen subset as `candidates` and the FULL cohort as
    // `cohort` (the server validates membership + cap and anchors coverage/drift to
    // the full cohort). No selection: send the full cohort as `candidates` — today's
    // shape, byte-identical — and omit `cohort`.
    const selectedSet = hasSelection ? new Set(selection) : null;
    const candidates = selectedSet ? cohortCands.filter((c) => selectedSet.has(c.entryId)) : cohortCands;
    // selection-rerun-cache — WHICH saved eval this open is looking for. A default
    // top-N open looks up the role key (unchanged); a selection open looks up the key
    // for THAT exact field (roleKey + a hash of its sorted member ids), computed from
    // the same ids the server hashes when it persists the run. Reopening the identical
    // four-candidate comparison therefore serves the cache instead of re-spawning the
    // full ≤8-process pipeline (LLM weights, embeddings, compare narrative).
    const cacheKey = selectedSet ? selectionCacheKey(g.roleKey, candidates.map((c) => c.entryId)) : g.roleKey;
    // A top-N open reads the cache only when the role is KNOWN to be evaluated (the
    // roles list drives the chip); a selection open always probes its own key, since
    // nothing lists selection rows — a miss simply falls through to a fresh run.
    const tryCache = !rerun && (selectedSet ? true : Boolean(evaluated[g.roleKey]));
    if (tryCache) {
      const p = await fetch(`/api/decisions/group-eval?role=${encodeURIComponent(cacheKey)}`)
        .then((r) => r.json())
        .catch(() => null);
      const payload = (p?.evaluation?.payload as GroupEvalPayload) ?? null;
      // The role is marked evaluated but the stored eval is unreadable/missing (parse failed,
      // or removed between the list and this read). Surface an error so the modal doesn't fall
      // through to "No evaluation yet" for a role its own button promised had one. Only for the
      // top-N path: a selection was never PROMISED a cached run, so a miss there just spawns.
      if (!payload && !selectedSet) {
        setEvalError(t("evalLoadFailed"));
        return;
      }
      if (payload) {
        setEvalData(payload);
        setEvalCreatedAt((p?.evaluation?.createdAt as string) ?? null);
        // Bind the segmented control to the role's PERSISTED governance (bug-ui-scan #1):
        // evalMode is unpersisted per-mount state that defaults to "recommendation", so
        // without this a rerun of a committee/eligibility role could re-send
        // "recommendation" and (were the server to trust it) silently auto-seal an AI lead.
        // The server also enforces this, but syncing the control keeps the UI honest and a
        // subsequent rerun sends the correct mode.
        if (payload.governanceMode) setEvalMode(payload.governanceMode);
        return;
      }
    }
    // The run this open is about to spawn is a SELECTION run: its result is stored
    // under the selection key, not the role key, so completion must not mark the ROLE
    // evaluated (the chip promises a role-level top-N eval that would then 404).
    setEvalIsSelection(Boolean(selectedSet));
    const params: Record<string, unknown> = { roleKey: g.roleKey, roleTitle: g.roleTitle, jobId: g.jobId, candidates, governanceMode: evalMode };
    if (selectedSet) params.cohort = cohortCands;
    const started = await startTask("group_eval", params);
    if (started) setEvalTaskId(started.id);
  };

  const decide = (e: Entry, action: "accept" | "reject", detail?: string) => {
    setSummaryEntry(null);
    void act(e, action, detail);
  };

  // Subtle in-flight pending state while a decision is on the wire — dimmed and
  // non-interactive, but NOT translated/hidden. The row is removed outright once
  // the server confirms (act()), so there's no pre-confirmation slide-away to undo.
  const leavingWrapClass = (e: Entry) =>
    resolving[e.id]
      ? "transition-all duration-200 ease-in pointer-events-none animate-pulse opacity-50"
      : "transition-all duration-200 ease-in";

  // Card-level peer accessors: score peers from the entries already in hand,
  // salary/skills facts from the peer-context fetch above.
  const peersOf = (e: Entry): PeerScore[] => peersForEntry(entries ?? [], e);
  const peerFactsOf = (e: Entry): JobPeerContext | null => (e.jobId ? peerCtx[e.jobId] ?? null : null);

  const evalGroup = evalRole ? groups.find((g) => g.roleKey === evalRole.roleKey) ?? null : null;

  // Pool drift: how many candidates were added/removed from this role's pending pool
  // since the cached evaluation ran, so a stale comparison prompts a re-run. Compared
  // against the FULL cohort the eval was computed over. selection-memory-rerun: prefer
  // stable ENTRY IDS when the payload carries them (evaluatedIds) so two same-named
  // candidates are counted distinctly; fall back to labels only for legacy payloads
  // saved before ids were persisted.
  const evalDrift = (() => {
    if (!evalGroup) return 0;
    const countDrift = (evaluated: string[], current: string[]): number => {
      const evaluatedSet = new Set(evaluated);
      const currentSet = new Set(current);
      let changed = 0;
      for (const k of evaluatedSet) if (!currentSet.has(k)) changed += 1;
      for (const k of currentSet) if (!evaluatedSet.has(k)) changed += 1;
      return changed;
    };
    if (evalData?.evaluatedIds && evalData.evaluatedIds.length > 0) {
      return countDrift(evalData.evaluatedIds, evalGroup.entries.map((e) => e.id));
    }
    if (evalData?.evaluatedLabels) {
      return countDrift(evalData.evaluatedLabels, evalGroup.entries.map((e) => e.candidateLabel));
    }
    return 0;
  })();

  return {
    t, locale, search,
    relayConfigured,
    jobFilter, setJobFilter,
    armIds, armJobId,
    entries, error,
    resolving, leavingWrapClass,
    queuedLabels, setQueuedLabels,
    sentOffers, setSentOffers,
    copiedOfferId, setCopiedOfferId,
    waveCommsFailed, setWaveCommsFailed,
    summaryEntry, setSummaryEntry,
    waveRole, setWaveRole,
    evalRole, setEvalRole,
    evalMode, setEvalMode,
    evalData, setEvalData,
    evalCreatedAt, setEvalCreatedAt,
    evalTaskId, setEvalTaskId,
    evalError, setEvalError,
    evaluated,
    reconsider, reinstating, reinstate,
    reconsiderOpen, setReconsiderOpen, reconsiderRef, revealReconsider,
    fmtDate, reconsiderReasonText,
    pending,
    jobOptions, activeFilter,
    visibleAiReviews, selectableReviews, hasOfferReviews, selectedReviews,
    selectionDrift,
    selectMode, setSelectMode,
    selectedReviewIds, toggleReviewSelect, exitSelectMode, selectAllReviews, clearSelectedReviews,
    bulkBusy, bulkResult, confirmingBulkReject, setConfirmingBulkReject, bulkDecideReviews,
    visibleGroups,
    act, openGroupEval, decide,
    evalGroup, evalDrift,
    staleSinceOf,
    peersOf, peerFactsOf,
    load,
  };
}
