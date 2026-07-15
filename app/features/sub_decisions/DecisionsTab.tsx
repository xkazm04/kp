"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, Copy, ListChecks, RotateCcw, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { buildTabSwitchUrl, buildUrl, clearedTabScopedParams } from "@/app/features/tabs";
import { postPipelineBatch, type PipelineBatchItem } from "@/app/_lib/useAddToPipeline";
import { ChainEmptyState } from "@/app/_components/ChainEmptyState";
import { CompletionCta } from "@/app/_components/CompletionCta";
import { Select } from "@/app/_components/Select";
import { Skeleton } from "@/app/_components/Skeleton";
import { toast } from "@/app/_components/toast-store";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { useDeliveryCapability } from "@/app/features/useDeliveryCapability";
import { useLiveRefresh } from "@/app/features/live-refresh";
import { ScoreProvenanceLabel } from "@/app/_components/ScoreProvenanceLabel";
import { waveReasonText } from "@/app/_lib/decision-attribution";
import type { MatchScoreProvenance } from "@/app/_lib/match-score";
import { AiReviewCard } from "./AiReviewCard";
import { DecisionRulesModal } from "./DecisionRulesModal";
import { ScreenWaveModal } from "./ScreenWaveModal";
import { AnalysisSummaryModal } from "./AnalysisSummaryModal";
import { Empty } from "./DecisionsShared";
import { GroupEvalModal, type GroupEvalPayload } from "./GroupEvalModal";
import { ARM_PARAM, parseArmParam } from "./group-eval-arm";
import { RoleDecisionRow } from "./RoleDecisionRow";
import { isScoreStale, type Entry } from "./DecisionsTypes";
import { capNames, pruneSelection, selectionDriftIds } from "./selection-hygiene";

type Group = { roleKey: string; roleTitle: string; jobId: string | null; entries: Entry[] };

// The sealed auto-reject reason the wave wrote, read back for display: a
// structured code + its interpolation params, localized on the client through the
// same decisions.wave.reasons.* catalog the screen-wave modal uses.
type ReconsiderReason = { reasonCode: string; reasonParams: Record<string, string | number> };

// idea-e43fa801 — an auto-rejected candidate a recruiter can put back for review.
type ReconsiderRow = {
  id: string;
  candidateLabel: string;
  jobTitle: string | null;
  archetype: string | null;
  matchScore: number | null;
  // The canonical score's provenance, so the row can name where the number came
  // from (CV analysis · date / snapshot) exactly like the rest of the decisions UI.
  scoreProvenance: MatchScoreProvenance | null;
  rejectedAt: string | null;
  // reconsider-earns-keep — the machine reject reason, read back from the sealed
  // decision record. Null when no seal was found (best-effort).
  reason: ReconsiderReason | null;
};

const roleKeyOf = (e: Entry) => e.jobId ?? e.jobTitle ?? "unassigned";

export function DecisionsTab() {
  const router = useRouter();
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
  const [rulesOpen, setRulesOpen] = useState(false);
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
  // Set when a role marked "evaluated" has an unreadable/missing saved payload, so the modal
  // shows an honest "couldn't load — re-run" instead of the misleading "no evaluation yet".
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evaluated, setEvaluated] = useState<Record<string, string>>({});

  // Direction 2 (queue-staleness) — the JD content-edit time per role, fetched for
  // the AI-review jobs so a card can flag a score computed before the JD changed.
  // Server derives (jd-freshness route, workspace-scoped); the card applies the
  // shared isScoreStale rule against each entry's canonical analysis timestamp.
  const [jdEditedAt, setJdEditedAt] = useState<Record<string, string | null>>({});

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
  const [selectAllSnapshot, setSelectAllSnapshot] = useState<string[] | null>(null);
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

  const load = () =>
    fetch("/api/pipeline")
      .then((r) => r.json())
      .then((p) => {
        if (p.error) throw new Error(p.error);
        setEntries((p.entries as Entry[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("loadFailed")));
  const loadReconsider = () =>
    fetch("/api/decisions/reconsider")
      .then((r) => r.json())
      .then((p) => setReconsider((p.items as ReconsiderRow[]) ?? []))
      .catch(() => undefined);
  useEffect(() => {
    load();
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

  const pending = (entries ?? []).filter((e) => e.approvalKind && e.status === "active");
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
  const selectionDrift = selectionDriftIds(selectAllSnapshot, selectableReviews.map((e) => e.id)).length;

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
    // Snapshot the cohort we just selected across — drift is measured against this.
    setSelectAllSnapshot(ids);
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
        const okIds = new Set(res.results.filter((r) => r.ok).map((r) => r.id));
        const acceptedScreenings = targets.filter((e) => okIds.has(e.id) && e.approvalKind === "screening_review");
        for (const e of acceptedScreenings) {
          void startTask("interview_prep", { entryId: e.id, candidateLabel: e.candidateLabel, jobTitle: e.jobTitle, lang: locale });
        }
        if (acceptedScreenings.length > 0) setQueuedLabels((prev) => [...prev, ...acceptedScreenings.map((e) => e.candidateLabel)]);
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
    if (evalRole) setEvaluated((s) => ({ ...s, [evalRole.roleKey]: new Date().toISOString() }));
  } else if (evalTaskId && (evalStatus === "failed" || evalStatus === "canceled" || evalStatus === "interrupted")) {
    setEvalTaskId(null);
  }

  const act = async (e: Entry, action: "accept" | "reject" | "approve_event", detail?: string, ttlDays?: number) => {
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
      const p = (await r.json().catch(() => null)) as { offerExtended?: boolean; link?: unknown } | null;
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
      setEntries((prev) => (prev ? prev.filter((x) => x.id !== e.id) : prev));
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
    }
  };

  const openGroupEval = async (g: Group, rerun = false, selection?: string[]) => {
    setEvalRole({ roleKey: g.roleKey, roleTitle: g.roleTitle });
    setEvalData(null);
    setEvalCreatedAt(null);
    setEvalTaskId(null);
    setEvalError(null);
    // group-eval-cohort-choice — an explicit selection ("compare these four") always
    // runs FRESH (it's a different, recruiter-chosen field); a saved eval is reused
    // only for the default top-N view.
    const hasSelection = Array.isArray(selection) && selection.length > 0;
    if (evaluated[g.roleKey] && !rerun && !hasSelection) {
      const p = await fetch(`/api/decisions/group-eval?role=${encodeURIComponent(g.roleKey)}`)
        .then((r) => r.json())
        .catch(() => null);
      const payload = (p?.evaluation?.payload as GroupEvalPayload) ?? null;
      // The role is marked evaluated but the stored eval is unreadable/missing (parse failed,
      // or removed between the list and this read). Surface an error so the modal doesn't fall
      // through to "No evaluation yet" for a role its own button promised had one.
      if (!payload) {
        setEvalError(t("evalLoadFailed"));
        return;
      }
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
    const cohortCands = g.entries.map((e) => ({ entryId: e.id, candidateId: e.candidateId, label: e.candidateLabel, matchScore: e.matchScore }));
    // Selection: send the chosen subset as `candidates` and the FULL cohort as
    // `cohort` (the server validates membership + cap and anchors coverage/drift to
    // the full cohort). No selection: send the full cohort as `candidates` — today's
    // shape, byte-identical — and omit `cohort`.
    const selectedSet = hasSelection ? new Set(selection) : null;
    const candidates = selectedSet ? cohortCands.filter((c) => selectedSet.has(c.entryId)) : cohortCands;
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

  const evalGroup = evalRole ? groups.find((g) => g.roleKey === evalRole.roleKey) ?? null : null;

  // Pool drift: how many candidates were added/removed from this role's pending
  // pool since the cached evaluation ran. Compared by label against the pre-cap
  // set the eval was computed over, so a stale comparison prompts a re-run.
  const evalDrift = (() => {
    if (!evalData?.evaluatedLabels || !evalGroup) return 0;
    const evaluatedSet = new Set(evalData.evaluatedLabels);
    const currentSet = new Set(evalGroup.entries.map((e) => e.candidateLabel));
    let changed = 0;
    for (const l of evaluatedSet) if (!currentSet.has(l)) changed += 1;
    for (const l of currentSet) if (!evaluatedSet.has(l)) changed += 1;
    return changed;
  })();

  return (
    <div data-sim="decisions" className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
          <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            {t.rich("intro", {
              schedule: (chunks) => (
                <button
                  type="button"
                  onClick={() => router.push(buildTabSwitchUrl("schedule", search.toString()))}
                  className="focus-ring font-semibold text-coral hover:underline"
                >
                  {chunks}
                </button>
              ),
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {jobOptions.length > 1 ? (
            <Select
              ariaLabel={t("filterTitle")}
              value={activeFilter ?? ""}
              onChange={(v) => setJobFilter(v || null)}
              size="sm"
              options={[
                { value: "", label: t("allRoles", { count: pending.length }) },
                ...jobOptions.map((o) => ({ value: o.key, label: `${o.label} (${pending.filter((e) => roleKeyOf(e) === o.key).length})` })),
              ]}
            />
          ) : null}
          <Select
            ariaLabel={t("govModeTitle")}
            value={evalMode}
            onChange={(v) => setEvalMode(v as typeof evalMode)}
            size="sm"
            options={[
              { value: "recommendation", label: t("govRecommendation") },
              { value: "committee", label: t("govCommittee") },
              { value: "eligibility_list", label: t("govEligibility") },
            ]}
          />
          <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-sm text-steel">
            {t("pending", {
              count: activeFilter
                ? visibleAiReviews.length + visibleGroups.reduce((n, g) => n + g.entries.length, 0)
                : pending.length,
            })}
          </span>
          {/* reconsider-earns-keep — a headline count chip for the auto-reject
              safety valve, so an audit isn't buried in a collapsed section at the
              bottom. Clicking opens + scrolls to the reconsider queue. Amber: a
              standing "these need a second look", not a success signal. */}
          {reconsider.length > 0 ? (
            <button
              type="button"
              onClick={revealReconsider}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            >
              <RotateCcw size={13} aria-hidden /> {t("reconsiderChip", { count: reconsider.length })}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            title={t("rulesTitle")}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-steel hover:bg-stone-50"
          >
            <SlidersHorizontal size={13} /> {t("rulesButton")}
          </button>
        </div>
      </header>

      {/* Forward handoff (Decisions → Schedule): accepting a screening queues
          the candidate for slot-picking on Schedule with no visible trace here —
          this band says what happened and where the work continues. */}
      {queuedLabels.length > 0 ? (
        <CompletionCta
          message={t("queuedBanner", { count: queuedLabels.length, name: queuedLabels[queuedLabels.length - 1] })}
          links={[{ label: t("queuedBannerCta"), tab: "schedule" }]}
          onDismiss={() => setQueuedLabels([])}
          dismissLabel={t("queuedDismiss")}
        />
      ) : null}

      {/* OO-L1-02 — extended offers keep their candidate link visible + copyable
          (the same readonly-field + copy affordance as the drawer's TokenLinkPanel),
          instead of the card fading out and the link living only in the outbox. */}
      {sentOffers.length > 0 ? (
        <section aria-live="polite" className="rounded-lg border border-moss/40 bg-moss/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Check size={14} className="text-moss" />{" "}
              {t(relayConfigured === false ? "offerSent.titleQueued" : "offerSent.title", { count: sentOffers.length })}
            </p>
            <button
              type="button"
              onClick={() => setSentOffers([])}
              className="focus-ring text-meta font-semibold text-steel hover:text-ink"
            >
              {t("offerSent.dismiss")}
            </button>
          </div>
          <p className="mt-0.5 text-sm text-steel">{t("offerSent.help")}</p>
          <ul className="mt-2 space-y-1.5">
            {sentOffers.map((o) => (
              <li key={o.id} className="flex items-center gap-1.5">
                <span className="w-40 shrink-0 truncate text-sm font-semibold text-ink">{o.label}</span>
                <input
                  readOnly
                  value={o.link}
                  onFocus={(ev) => ev.currentTarget.select()}
                  aria-label={t("offerSent.linkAria", { name: o.label })}
                  className="focus-ring min-w-0 flex-1 rounded-md border border-stone-200 bg-paper px-2 py-1 text-sm text-ink"
                />
                <button
                  type="button"
                  title={t("offerSent.copy")}
                  onClick={() => {
                    void navigator.clipboard?.writeText(o.link);
                    setCopiedOfferId(o.id);
                  }}
                  className="focus-ring rounded-md border border-stone-200 bg-white p-1.5 text-steel hover:text-coral"
                >
                  {copiedOfferId === o.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Direction 2b — a committed wave's comms failures stay named after the
          modal closes. Amber (a warning, not the success band): these candidates
          are out of the funnel but weren't notified, so they need a manual nudge.
          Links to Analytics, where the Decision Log holds the audited
          rejection_comms_failed trail. */}
      {waveCommsFailed.length > 0 ? (
        <section
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5"
        >
          <p className="min-w-0 text-sm text-ink">
            <AlertTriangle size={14} className="-mt-0.5 mr-1 inline text-amber-700" aria-hidden />
            {t("waveComms.banner", { count: waveCommsFailed.reduce((n, g) => n + g.count, 0) })}
            {/* Grouped per committed wave; each wave's names capped with "+N more"
                so the banner can't grow unbounded across successive waves. */}
            {waveCommsFailed.map((g, i) => {
              const { shown, more } = capNames(g.labels, 5);
              if (shown.length === 0 && more === 0) return null;
              return (
                <span key={i} className="block text-amber-800">
                  {shown.join(", ")}
                  {more > 0 ? ` ${t("waveComms.more", { count: more })}` : ""}
                </span>
              );
            })}
          </p>
          <span className="flex items-center gap-3">
            {/* Direction 3 — land on Analytics with the Decision Log already
                filtered to the audited rejection_comms_failed trail (the
                deep-linkable ?kind= the log now hydrates from), not the bare tab. */}
            <button
              type="button"
              onClick={() =>
                router.push(
                  buildUrl({ tab: "analytics", ...clearedTabScopedParams(), kind: "rejection_comms_failed" }, search.toString())
                )
              }
              className="focus-ring inline-flex items-center gap-1 text-sm font-semibold text-amber-800 hover:underline"
            >
              {t("waveComms.cta")} <ArrowRight size={13} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setWaveCommsFailed([])}
              aria-label={t("queuedDismiss")}
              className="focus-ring rounded p-0.5 text-steel hover:text-ink"
            >
              <X size={14} aria-hidden />
            </button>
          </span>
        </section>
      ) : null}

      {error ? (
        <p role="alert" aria-live="assertive" className="rounded-md bg-red-50 p-3 text-base text-red-700">
          {error}
        </p>
      ) : entries == null ? (
        <div aria-busy="true" aria-label={t("loading")} className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : pending.length === 0 ? (
        // Caught-up is closure, not a dead-end: point at where the work
        // continues (slots waiting on Schedule, the live board).
        <ChainEmptyState
          icon={Check}
          title={t("caughtUpTitle")}
          body={t("caughtUpBody")}
          links={[
            { tab: "schedule", label: t("caughtUpCtaSchedule") },
            { tab: "pipeline", label: t("caughtUpCtaPipeline") },
          ]}
        />
      ) : (
        <div className="space-y-6">
          {visibleAiReviews.length > 0 ? (
            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
                  <Sparkles size={13} className="text-coral" /> {t("aiRecommendations")} <span className="text-coral">· {visibleAiReviews.length}</span>
                </h3>
                {/* Direction 1 — batch accept/reject. Offered when 2+ cards are
                    batchable (offer_review excluded); a single card is faster one-by-one.
                    Once armed, the toggle stays so the recruiter can always exit. */}
                {selectMode || selectableReviews.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                    aria-pressed={selectMode}
                    className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold ${
                      selectMode ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:bg-stone-50"
                    }`}
                  >
                    <ListChecks size={13} /> {selectMode ? t("batch.exit") : t("batch.select")}
                  </button>
                ) : null}
              </div>

              {selectMode ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-coral/30 bg-coral/5 px-3 py-2">
                  <span className="text-sm font-semibold text-ink" aria-live="polite">
                    {t("batch.selectedCount", { count: selectedReviews.length })}
                  </span>
                  <button
                    type="button"
                    onClick={selectAllReviews}
                    className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
                  >
                    {t("batch.selectAll", { count: selectableReviews.length })}
                  </button>
                  {selectedReviews.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedReviewIds(new Set());
                        setSelectAllSnapshot(null);
                        setConfirmingBulkReject(false);
                        setBulkResult(null);
                      }}
                      className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
                    >
                      {t("batch.clear")}
                    </button>
                  ) : null}
                  {/* Direction 3 — select-all drift cue: cards arrived since the
                      recruiter selected all, so the current select-all is stale.
                      Clicking re-selects (and re-snapshots) the current cohort. */}
                  {selectionDrift > 0 ? (
                    <button
                      type="button"
                      onClick={selectAllReviews}
                      aria-live="polite"
                      className="focus-ring inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      {t("batch.selectionDrift", { count: selectionDrift })}
                    </button>
                  ) : null}
                  {hasOfferReviews ? (
                    <span className="text-sm text-steel">{t("batch.offersExcluded")}</span>
                  ) : null}
                  {bulkResult ? (
                    <span role="status" className="text-sm">
                      <span className="font-semibold text-moss">
                        {t(bulkResult.verb === "accepted" ? "batch.accepted" : "batch.rejected", { count: bulkResult.ok })}
                      </span>
                      {bulkResult.failed > 0 ? (
                        <span className="font-semibold text-coral">
                          {" · "}
                          {t("batch.failed", { count: bulkResult.failed })}
                        </span>
                      ) : null}
                      {bulkResult.reason ? <span className="block text-steel">{bulkResult.reason}</span> : null}
                    </span>
                  ) : null}
                  {selectedReviews.length > 0 ? (
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void bulkDecideReviews("accept")}
                        disabled={bulkBusy}
                        className="focus-ring rounded-md bg-moss px-3 py-1 text-sm font-semibold text-white hover:bg-moss/90 disabled:opacity-50"
                      >
                        {t("batch.accept", { count: selectedReviews.length })}
                      </button>
                      {confirmingBulkReject ? (
                        <>
                          <span className="text-sm font-semibold text-coral">{t("batch.rejectConfirm", { count: selectedReviews.length })}</span>
                          <button
                            type="button"
                            onClick={() => void bulkDecideReviews("reject")}
                            disabled={bulkBusy}
                            className="focus-ring rounded-md bg-coral px-3 py-1 text-sm font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
                          >
                            {bulkBusy ? t("batch.rejecting") : t("batch.rejectConfirmYes")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingBulkReject(false)}
                            disabled={bulkBusy}
                            className="focus-ring rounded-md px-2 py-1 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
                          >
                            {t("batch.rejectCancel")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingBulkReject(true)}
                          disabled={bulkBusy}
                          className="focus-ring rounded-md border border-coral/40 bg-white px-3 py-1 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
                        >
                          {t("batch.reject", { count: selectedReviews.length })}
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visibleAiReviews.map((e) => {
                  const eligible = e.approvalKind !== "offer_review";
                  return (
                    <div key={e.id} data-sim-entry={e.id} className={leavingWrapClass(e)}>
                      <AiReviewCard
                        entry={e}
                        onAccept={(ttlDays) => act(e, "accept", undefined, ttlDays)}
                        onReject={() => act(e, "reject")}
                        selectMode={selectMode}
                        selected={selectedReviewIds.has(e.id)}
                        onToggleSelect={eligible ? () => toggleReviewSelect(e) : undefined}
                        onInspect={() => setSummaryEntry(e)}
                        staleSince={staleSinceOf(e)}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section>
            <h3 className="text-meta uppercase tracking-wide text-steel">
              {t("keyDecisions")} <span className="text-coral">· {visibleGroups.length}</span>
            </h3>
            <p className="mt-1 text-sm text-steel">{t("keyDecisionsHelp")}</p>
            <div className="mt-3 space-y-3">
              {visibleGroups.map((g) => (
                <RoleDecisionRow
                  key={g.roleKey}
                  roleTitle={g.roleTitle}
                  entries={g.entries}
                  evaluated={Boolean(evaluated[g.roleKey])}
                  busy={evalTaskId !== null && evalRole?.roleKey === g.roleKey}
                  onCandidate={setSummaryEntry}
                  onGroupEval={(selection) => openGroupEval(g, false, selection)}
                  onScreenWave={g.jobId ? () => setWaveRole({ jobId: g.jobId as string, title: g.roleTitle }) : undefined}
                  // The pre-armed selection lands only on the deep-linked role's row;
                  // the row consumes it once at mount (a later remount re-seeds from
                  // the same session-captured intent, never from the stripped URL).
                  initialSelection={armIds && armJobId && g.jobId === armJobId ? armIds : undefined}
                />
              ))}
              {visibleGroups.length === 0 ? <Empty>{t("noKeyDecisions")}</Empty> : null}
            </div>
          </section>
        </div>
      )}

      {/* idea-e43fa801 — the safety valve over irreversible auto-rejection. Always
          available (even when caught up), collapsed by default so it doesn't
          compete with the live decision queue. */}
      {reconsider.length > 0 ? (
        <details
          ref={reconsiderRef}
          open={reconsiderOpen}
          onToggle={(ev) => setReconsiderOpen(ev.currentTarget.open)}
          className="rounded-lg border border-stone-200 bg-paper/40"
        >
          <summary className="focus-ring flex cursor-pointer items-center gap-1.5 px-4 py-2.5 text-meta uppercase tracking-wide text-steel">
            <RotateCcw size={13} className="text-coral" /> {t("reconsiderTitle", { count: reconsider.length })}
          </summary>
          <div className="space-y-2 px-4 pb-3">
            <p className="text-sm text-steel">{t("reconsiderHelp")}</p>
            <ul className="space-y-1.5">
              {reconsider.map((item) => {
                const reasonText = item.reason ? reconsiderReasonText(item.reason) : null;
                return (
                  <li
                    key={item.id}
                    className="rounded-md border border-stone-100 bg-white px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-ink">{item.candidateLabel}</span>
                      {item.jobTitle ? <span className="text-steel">· {item.jobTitle}</span> : null}
                      {/* SD-L2-001 — the safety valve must tell a never-measured candidate
                          apart from a genuine low scorer: an absent score is flagged
                          "unscored", never rendered blank (or worse, as 0). */}
                      {item.matchScore != null ? (
                        <span className="inline-flex items-center gap-1 text-stone-400">
                          · {t("reconsiderMatch", { score: item.matchScore })}
                          {/* Score provenance strip (REC-01) — same label as the queue. */}
                          <ScoreProvenanceLabel provenance={item.scoreProvenance} className="text-meta text-stone-400" />
                        </span>
                      ) : (
                        <span className="text-stone-400">· {t("reconsiderUnscored")}</span>
                      )}
                      {item.rejectedAt ? (
                        <span className="text-stone-400">· {t("reconsiderRejected", { date: fmtDate(item.rejectedAt) })}</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void reinstate(item)}
                        disabled={reinstating.has(item.id)}
                        className="focus-ring ml-auto rounded-md border border-coral/40 bg-white px-2.5 py-1 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
                      >
                        {reinstating.has(item.id) ? t("reinstating") : t("reinstate")}
                      </button>
                    </div>
                    {/* reconsider-earns-keep — the machine reject reason, read back
                        from the sealed decision record. An auto-reject audit is no
                        longer a bare list: the recruiter sees WHY it fell out. */}
                    {reasonText ? (
                      <p className="mt-1 text-meta text-steel">
                        <span className="font-semibold uppercase tracking-wide text-stone-400">{t("reconsiderReasonLabel")}</span>{" "}
                        {reasonText}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </details>
      ) : null}

      {summaryEntry ? (
        <AnalysisSummaryModal
          entry={summaryEntry}
          onClose={() => setSummaryEntry(null)}
          onAccept={(reason) => decide(summaryEntry, "accept", reason)}
          onReject={(reason) => decide(summaryEntry, "reject", reason)}
        />
      ) : null}

      {evalRole ? (
        <GroupEvalModal
          roleTitle={evalRole.roleTitle}
          evaluation={evalData}
          loading={evalTaskId !== null}
          error={evalError}
          createdAt={evalCreatedAt}
          poolDrift={evalDrift}
          onClose={() => {
            setEvalRole(null);
            setEvalData(null);
            setEvalCreatedAt(null);
            setEvalTaskId(null);
            setEvalError(null);
          }}
          onRerun={() => evalGroup && openGroupEval(evalGroup, true)}
          onDecide={(identity, action) => {
            // Resolve the eval candidate back to the live pipeline entry by stable id
            // (candIdentity = entry id, label fallback), then reuse act() — same
            // expectedStage CAS + comms as the queue. Resolving by id prevents an
            // irreversible advance/reject from landing on the wrong same-named candidate;
            // the label fallback keeps evals saved before entryId existed working. Acts
            // only on still-pending entries (a candidate decided elsewhere has left
            // evalGroup.entries).
            const e =
              evalGroup?.entries.find((x) => x.id === identity) ??
              evalGroup?.entries.find((x) => x.candidateLabel === identity);
            // Report back whether we found a live entry: a candidate who already left
            // the pool returns false so the modal won't show a fake "Advanced/Rejected".
            if (!e) return false;
            void act(e, action);
            return true;
          }}
        />
      ) : null}

      {rulesOpen ? <DecisionRulesModal onClose={() => setRulesOpen(false)} /> : null}

      {waveRole ? (
        <ScreenWaveModal
          jobId={waveRole.jobId}
          roleTitle={waveRole.title}
          onClose={() => setWaveRole(null)}
          onCommitted={(summary) => {
            load();
            if (summary && summary.commsFailures > 0) {
              // One group PER committed wave — the banner groups + caps names rather
              // than appending an ever-growing flat list. Named labels may be fewer
              // than the count (some failures are anonymous); count carries the total.
              setWaveCommsFailed((prev) => [...prev, { count: summary.commsFailures, labels: summary.failedLabels }]);
            }
          }}
        />
      ) : null}
    </div>
  );
}
